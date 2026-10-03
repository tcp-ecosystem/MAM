/**
 * MAM Registry API
 *
 * The public contract for the MAM module registry: a GraphQL schema with
 * working resolvers, and an OpenAPI document for REST clients.
 *
 * This package holds no storage of its own. It maps the schema onto
 * `@mam/registry-server`, so the API and the server cannot drift into
 * describing different registries.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  resolvers,
  moduleFields,
  invoke,
  createResolverContext,
  resetResolverStore,
  sanitizeModule,
  sanitizeVersion,
  requireString,
  normalizeLimit,
  normalizeOffset,
  normalizeTags,
  compareVersionsDesc,
  ResolverInputError,
  ModuleNotFoundError,
  type ResolverContext,
  type ResolverStoreOptions,
  type ModuleShape,
  type VersionShape,
  type ListArgs,
} from './resolvers.js';

import { resolvers, type ResolverContext } from './resolvers.js';

// ============================================================================
// Spec files
// ============================================================================

/** Absolute path of this package's root, resolved from the compiled module. */
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const OPENAPI_PATH = join(PACKAGE_ROOT, 'openapi.yaml');
export const GRAPHQL_SCHEMA_PATH = join(PACKAGE_ROOT, 'graphql', 'schema.graphql');

/** Reads the OpenAPI document as raw YAML. */
export function readOpenAPI(): string {
  return readFileSync(OPENAPI_PATH, 'utf-8');
}

/** Reads the GraphQL schema as SDL. */
export function readGraphQLSchema(): string {
  return readFileSync(GRAPHQL_SCHEMA_PATH, 'utf-8');
}

// ============================================================================
// Introspection helpers
// ============================================================================

/** Operation names implemented by the resolvers, grouped by GraphQL root. */
export function getResolverOperations(): { Query: string[]; Mutation: string[]; Module: string[] } {
  const keys = (group: Record<string, unknown>): string[] =>
    Object.keys(group).filter((k) => typeof group[k] === 'function');
  return {
    Query: keys(resolvers.Query as unknown as Record<string, unknown>),
    Mutation: keys(resolvers.Mutation as unknown as Record<string, unknown>),
    Module: keys(resolvers.Module as unknown as Record<string, unknown>),
  };
}

/** Operation names declared in the GraphQL schema, grouped by root. */
export function getSchemaOperations(sdl: string = readGraphQLSchema()): { Query: string[]; Mutation: string[]; Module: string[] } {
  const block = (name: string): string[] => {
    // Scans to the matching brace rather than stopping at the first "\n}",
    // so a field whose arguments or default value contain "}" cannot truncate
    // the body early.
    const header = new RegExp(`^type\\s+${name}\\s*\\{`, 'm').exec(sdl);
    if (!header) return [];

    const open = sdl.indexOf('{', header.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < sdl.length; i++) {
      const char = sdl[i];
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    const body = sdl.slice(open + 1, end);
    // A field is followed by "(" when it takes arguments, ":" when it does not,
    // or "{" for a type with a body. A reader that only accepts "(" silently
    // misses every argument-less field, which is most of them.
    return [...body.matchAll(/^\s{2}(\w+)\s*(?=[({:])/gm)].map((m) => m[1]!);
  };
  return { Query: block('Query'), Mutation: block('Mutation'), Module: block('Module') };
}

export interface SchemaParity {
  inSync: boolean;
  /** Implemented in a resolver but absent from the schema, so unreachable. */
  unreachable: string[];
  /** Declared in the schema but never implemented. */
  unimplemented: string[];
}

/**
 * Compares the schema against the resolvers.
 *
 * The two are written by hand, so this is the cheapest way to catch the drift
 * where a resolver is written but never added to the schema and so cannot be
 * reached by a client.
 */
export function checkSchemaParity(sdl: string = readGraphQLSchema()): SchemaParity {
  const implemented = getResolverOperations();
  const declared = getSchemaOperations(sdl);
  const unreachable: string[] = [];
  const unimplemented: string[] = [];

  for (const root of ['Query', 'Mutation'] as const) {
    for (const name of implemented[root]) {
      if (!declared[root].includes(name)) unreachable.push(`${root}.${name}`);
    }
    for (const name of declared[root]) {
      if (!implemented[root].includes(name)) unimplemented.push(`${root}.${name}`);
    }
  }
  // Module fields are only compared in one direction. A field with a resolver
  // must be declared, or it cannot be reached. A declared field with no
  // resolver is fine when it is a plain property, because GraphQL's default
  // resolver reads it straight off the parent object.
  for (const name of implemented.Module) {
    if (!declared.Module.includes(name)) unimplemented.push(`Module.${name}`);
  }

  return { inSync: unreachable.length === 0 && unimplemented.length === 0, unreachable, unimplemented };
}

export const API_VERSION = '0.1.0';

/** One-line summary of the surface, for diagnostics. */
export function describeApi(): string {
  const ops = getResolverOperations();
  return `MAM Registry API v${API_VERSION} — ${ops.Query.length} queries, ` +
    `${ops.Mutation.length} mutations, ${ops.Module.length} module fields`;
}
