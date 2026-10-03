/**
 * MAM Registry GraphQL wiring
 *
 * Builds an executable schema from the SDL in `@mam/registry-api` and runs the
 * resolvers from that same package against the store the HTTP server is
 * already using.
 *
 * The import of the api package is deliberately a *runtime* resolution rather
 * than a static one. `@mam/registry-api` depends on `@mam/registry-server`, so
 * a static import here would make the two packages depend on each other, and
 * the build would need each package's `dist` to exist before the other's `tsc`
 * could typecheck. Resolving the specifier at runtime keeps the dependency
 * one-way (api -> server) and leaves GraphQL an optional capability: a
 * deployment without the api package gets a 501 from `/graphql` and every
 * other route keeps working.
 *
 * The schema itself is built with graphql-js (`buildSchema` / `graphql`).
 * Resolvers are attached by walking the built schema and setting `resolve` on
 * each field, which is the documented shape for a schema-first setup. No part
 * of the GraphQL language is parsed or interpreted here.
 */

import { buildSchema, graphql, GraphQLError, type ExecutionResult, type GraphQLSchema } from 'graphql';

import type { RegistryServer } from './server.js';

// ============================================================================
// Types
// ============================================================================

/** A resolver map keyed by type name, as `@mam/registry-api` exports. */
export interface ResolverMap {
  Query?: Record<string, unknown>;
  Mutation?: Record<string, unknown>;
  Module?: Record<string, unknown>;
  [typeName: string]: Record<string, unknown> | undefined;
}

/**
 * The pieces of a GraphQL surface, before it is bound to a server.
 *
 * Kept as data so the schema can be built once and executed many times, and so
 * a host can supply its own resolvers instead of the api package's.
 */
export interface GraphQLSource {
  /** SDL document. */
  sdl: string;
  /** Resolvers, keyed by type name. */
  resolvers: ResolverMap;
  /**
   * Builds the per-request context the resolvers receive.
   *
   * Receives the server's `ModuleStore` so the resolvers read the same data
   * the REST routes do, rather than a second store pointed somewhere else.
   */
  createContext?: (input: { store: unknown }) => unknown;
}

/** An executable GraphQL surface bound to a registry server. */
export interface GraphQLSpec {
  /** The SDL, for `GET /graphql` and for error messages. */
  readonly sdl: string;
  /** The built schema. */
  readonly schema: GraphQLSchema;
  /** Runs one operation. */
  execute(args: {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
    contextValue?: unknown;
  }): Promise<ExecutionResult>;
  /** Builds the context value for one request. */
  createContext(extra?: Record<string, unknown>): unknown;
}

/** Package specifier resolved at runtime; see the file header. */
const REGISTRY_API_SPECIFIER = '@mam/registry-api';

// ============================================================================
// Building
// ============================================================================

/**
 * Binds a resolver map onto a schema built by graphql-js.
 *
 * `buildSchema` produces a schema with no behaviour attached, so every field
 * would otherwise fall back to reading a property of its parent. That is
 * correct for the plain shapes the resolvers return and wrong for the fields
 * that need work — `Module.versions` has to go back to the store — so each
 * declared resolver is installed as that field's `resolve`.
 */
export function attachResolvers(schema: GraphQLSchema, resolvers: ResolverMap): void {
  for (const [typeName, fields] of Object.entries(resolvers)) {
    if (!fields || typeof fields !== 'object') continue;
    const type = schema.getType(typeName);
    if (!type || typeof (type as { getFields?: unknown }).getFields !== 'function') continue;

    const typeFields = (type as { getFields: () => Record<string, { resolve?: unknown }> }).getFields();
    for (const [fieldName, resolver] of Object.entries(fields)) {
      if (typeof resolver !== 'function') continue;
      const field = typeFields[fieldName];
      // A resolver for a field the schema does not declare is a programming
      // error, and silently skipping it would leave a field resolving to null.
      // Surfaced rather than swallowed.
      if (!field) {
        throw new Error(`Resolver ${typeName}.${fieldName} has no matching field in the schema`);
      }
      field.resolve = resolver as (source: unknown, args: unknown, context: unknown, info: unknown) => unknown;
    }
  }
}

/**
 * Gives the declared `JSON` scalar a working implementation.
 *
 * SDL alone cannot describe one, and the default is identity — which happens
 * to be right for output and wrong for input, where a literal object would
 * otherwise be rejected. These three functions make the scalar mean "any JSON
 * value" in both directions, matching what the resolvers put in it.
 */
export function installJsonScalar(schema: GraphQLSchema): void {
  const json = schema.getType('JSON');
  if (!json) return;
  const scalar = json as unknown as {
    serialize?: (value: unknown) => unknown;
    parseValue?: (value: unknown) => unknown;
    parseLiteral?: (node: unknown) => unknown;
  };

  // `parseLiteral` used to return the raw string, so `files: """{"a":"a"}"""`
  // arrived at `publishModule` as a 13-character string and
  // `Object.entries` exploded it into thirteen single-character "files".
  // A JSON scalar that does not parse is a string scalar with a nicer name.
  const parseJson = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      throw new GraphQLError('JSON must be valid JSON');
    }
  };

  scalar.serialize = (value: unknown) => value;
  scalar.parseValue = (value: unknown) => parseJson(value);
  scalar.parseLiteral = (node: unknown) => {
    const value = (node as { value?: unknown })?.value;
    return parseJson(value);
  };
}

/** Builds an executable spec from a source and a registry server. */
export function buildGraphQL(source: GraphQLSource, server: RegistryServer): GraphQLSpec {
  const schema = buildSchema(source.sdl);
  installJsonScalar(schema);
  attachResolvers(schema, source.resolvers);

  return {
    sdl: source.sdl,
    schema,
    async execute({ query, variables, operationName, contextValue }) {
      return graphql({
        schema,
        source: query,
        ...(variables ? { variableValues: variables } : {}),
        ...(operationName ? { operationName } : {}),
        contextValue: contextValue ?? {},
      });
    },
    createContext(extra) {
      // The resolvers are written against `ResolverContext { store }`, so the
      // server's own store is handed to them: one registry, one data directory,
      // and a mutation through GraphQL is visible to the REST routes that read
      // the same store.
      const base = source.createContext
        ? source.createContext({ store: server.moduleStore })
        : { store: server.moduleStore };
      return { ...(base as Record<string, unknown>), ...(extra ?? {}) };
    },
  };
}

// ============================================================================
// Loading the api package
// ============================================================================

/**
 * The shape this module needs from `@mam/registry-api`.
 *
 * Declared locally rather than imported, because importing the package for its
 * types is exactly the static dependency the file header avoids.
 */
interface RegistryApiModule {
  readGraphQLSchema?: () => string;
  resolvers?: ResolverMap;
  createResolverContext?: (options: { store: unknown }) => unknown;
}

/**
 * Loads the SDL and resolvers from `@mam/registry-api`.
 *
 * Resolved through a variable specifier on purpose: a literal `import('@mam/registry-api')`
 * would be typechecked at build time, which reintroduces the package cycle this
 * module exists to avoid. Throws when the package is absent; the caller turns
 * that into a 501.
 */
export async function loadRegistryGraphQL(specifier: string = REGISTRY_API_SPECIFIER): Promise<GraphQLSource> {
  const target = specifier;
  const loaded = (await import(target)) as RegistryApiModule;

  if (typeof loaded.readGraphQLSchema !== 'function') {
    throw new Error(`${specifier} does not export readGraphQLSchema()`);
  }
  if (!loaded.resolvers || typeof loaded.resolvers !== 'object') {
    throw new Error(`${specifier} does not export resolvers`);
  }

  const createResolverContext = loaded.createResolverContext;
  return {
    sdl: loaded.readGraphQLSchema(),
    resolvers: loaded.resolvers,
    // `createResolverContext` resolves its store lazily and caches one; passing
    // the server's store in is what keeps GraphQL and REST on a single data
    // directory instead of two that can disagree.
    createContext: createResolverContext
      ? ({ store }) => createResolverContext({ store: store as never })
      : undefined,
  };
}
