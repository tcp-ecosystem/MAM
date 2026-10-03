/**
 * MAM Registry API — contract tests
 *
 * The schema, the resolvers and the OpenAPI document are all written by hand.
 * This suite is the guard that keeps them describing the same surface, and it
 * also proves the parity check itself detects drift rather than always
 * reporting success.
 */

import { describe, it, expect } from 'vitest';
import { parse, buildSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { parseYAML } from '@mam/plugin-yaml';
import {
  readOpenAPI,
  readGraphQLSchema,
  getResolverOperations,
  getSchemaOperations,
  checkSchemaParity,
  describeApi,
  API_VERSION,
  resolvers,
  OPENAPI_PATH,
  GRAPHQL_SCHEMA_PATH,
  type SchemaParity,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type YamlDoc = Record<string, any>;

/**
 * Field names declared on a GraphQL type.
 *
 * Independent of `getSchemaOperations`, which only recognises fields that take
 * arguments. This reads the `:` form too, so the SDL assertions below are about
 * the schema rather than about one extractor's quirks.
 */
function sdlTypeFields(sdl: string, typeName: string): string[] {
  const match = sdl.match(new RegExp(`type ${typeName}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) return [];
  return [...match[1]!.matchAll(/^\s{2}(\w+)\s*[({:]/gm)].map((m) => m[1]!);
}

function loadOpenAPI(): YamlDoc {
  const result = parseYAML(readOpenAPI());
  expect(result.errors).toEqual([]);
  return result.data;
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const;

/** Every operation in the document, as `{ method, path, operationId }`. */
function operations(doc: YamlDoc): { method: string; path: string; operationId?: string }[] {
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const found: { method: string; path: string; operationId?: string }[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = item?.[method] as { operationId?: string } | undefined;
      if (op && typeof op === 'object') {
        found.push({ method, path, operationId: op.operationId });
      }
    }
  }
  return found;
}

function describeDrift(parity: SchemaParity): string {
  return [
    ...parity.unreachable.map((n) => `unreachable: ${n}`),
    ...parity.unimplemented.map((n) => `unimplemented: ${n}`),
  ].join(', ');
}

/**
 * Operations that `checkSchemaParity` cannot currently see.
 *
 * `getSchemaOperations` extracts fields with `/^\s{2}(\w+)\s*[({]/gm`, which
 * requires a `(` or `{` after the name. An argument-less field such as
 * `registryStats: RegistryStats!` is therefore never read out of the SDL, and
 * the resolver behind it is reported as unreachable even though the schema
 * declares it correctly. That is a real defect in the extractor, not drift in
 * the schema; the entry is the known false positive and should empty out once
 * the regex accepts a bare `:`.
 */
const KNOWN_PARITY_GAPS: string[] = [];

// ---------------------------------------------------------------------------
// Schema / resolver parity
// ---------------------------------------------------------------------------

describe('checkSchemaParity()', () => {
  it('reports no drift beyond the known extractor gap', () => {
    const parity = checkSchemaParity();
    const drift = [...parity.unreachable, ...parity.unimplemented]
      .filter((name) => !KNOWN_PARITY_GAPS.includes(name));
    expect(drift, `schema drifted from resolvers -> ${describeDrift(parity)}`).toEqual([]);
  });

  it('reports inSync as true', () => {
    const parity = checkSchemaParity();
    expect(parity.inSync).toBe(true);
    expect(parity.unreachable).toEqual([]);
    expect(parity.unimplemented).toEqual([]);
  });

  it('would report inSync if every declared operation were visible', () => {
    // Re-derives the comparison the check is meant to make, with a reader that
    // sees argument-less fields. This is what the check should report today.
    const sdl = readGraphQLSchema();
    const implemented = getResolverOperations();
    const declared = {
      Query: sdlTypeFields(sdl, 'Query'),
      Mutation: sdlTypeFields(sdl, 'Mutation'),
    };
    for (const root of ['Query', 'Mutation'] as const) {
      expect([...declared[root]].sort()).toEqual([...implemented[root]].sort());
    }
  });

  it('detects a Mutation type with an empty body', () => {
    const broken = readGraphQLSchema().replace(
      /type Mutation \{[\s\S]*?\n\}/,
      'type Mutation {\n}',
    );
    const parity = checkSchemaParity(broken);
    expect(parity.inSync).toBe(false);
    expect(parity.unreachable).toEqual(expect.arrayContaining([
      'Mutation.publishModule',
      'Mutation.deleteModule',
      'Mutation.archiveModule',
    ]));
  });

  it('detects a declared operation with no resolver', () => {
    const broken = readGraphQLSchema().replace(
      'type Query {',
      'type Query {\n  resurrectedOperation(seed: String): String',
    );
    const parity = checkSchemaParity(broken);
    expect(parity.inSync).toBe(false);
    expect(parity.unimplemented).toContain('Query.resurrectedOperation');
    // The real resolvers are all declared, so nothing became unreachable.
    expect(parity.unreachable).toEqual([]);
  });

  it('detects resolvers with no schema declaration', () => {
    const broken = readGraphQLSchema().replace(
      /type Query \{[\s\S]*?\n\}/,
      'type Query {\n}',
    );
    const parity = checkSchemaParity(broken);
    expect(parity.inSync).toBe(false);
    expect(parity.unreachable).toEqual(expect.arrayContaining([
      'Query.modules',
      'Query.module',
      'Query.searchModules',
      'Query.moduleVersions',
      'Query.moduleVersion',
      'Query.registryStats',
    ]));
  });

  it('detects a Module field resolver with no declaration', () => {
    // One-directional for Module fields: a resolver that is not declared cannot
    // be reached, but a declared field the parent object already provides is
    // satisfied by GraphQL's default resolver and must not be flagged.
    const broken = readGraphQLSchema().replace(/^\s*versions: \[Version!\]!$/m, '');
    expect(broken).not.toContain('versions: [Version!]!');

    const parity = checkSchemaParity(broken);
    expect(parity.inSync).toBe(false);
    expect(parity.unimplemented).toContain('Module.versions');
  });

  it('does not flag a declared Module field the parent provides', () => {
    const broken = readGraphQLSchema().replace(
      'type Module {',
      'type Module {\n  extraField: String',
    );
    const parity = checkSchemaParity(broken);
    expect(parity.unimplemented).not.toContain('Module.extraField');
  });

  it('reports nothing for an SDL that matches the resolvers exactly', () => {
    // Hand-built SDL the extractor reads in full, so the check has nothing to
    // complain about. Proves an empty report is reachable, not just a default.
    const exact = [
      'type Query {',
      '  modules(limit: Int): String',
      '  module(name: String): String',
      '  searchModules(q: String): String',
      '  moduleVersions(name: String): String',
      '  moduleVersion(name: String): String',
      '  registryStats(seed: Int): String',
      '}',
      'type Mutation {',
      '  publishModule(name: String): String',
      '  deleteModule(name: String): String',
      '  archiveModule(name: String): String',
      '}',
      'type Module {',
      '  versions(name: String): String',
      '}',
    ].join('\n');
    const parity = checkSchemaParity(exact);
    expect(parity.unreachable).toEqual([]);
    expect(parity.unimplemented).toEqual([]);
    expect(parity.inSync).toBe(true);
  });
});

describe('getResolverOperations()', () => {
  it('lists the Query resolvers', () => {
    expect(getResolverOperations().Query).toEqual(expect.arrayContaining([
      'modules', 'module', 'searchModules', 'moduleVersions', 'moduleVersion', 'registryStats',
    ]));
  });

  it('lists the Mutation resolvers', () => {
    expect(getResolverOperations().Mutation).toEqual(expect.arrayContaining([
      'publishModule', 'deleteModule', 'archiveModule',
    ]));
  });

  it('lists the Module field resolvers', () => {
    expect(getResolverOperations().Module).toEqual(['versions']);
  });
});

describe('getSchemaOperations()', () => {
  it('reads the argument-taking operations out of the SDL', () => {
    const declared = getSchemaOperations();
    expect(declared.Query).toEqual(expect.arrayContaining([
      'modules', 'module', 'searchModules', 'moduleVersions', 'moduleVersion',
    ]));
    expect(declared.Mutation).toEqual(expect.arrayContaining([
      'publishModule', 'deleteModule', 'archiveModule',
    ]));
  });

  it('reads argument-less fields, which it previously missed', () => {
    // The extractor used to require "(" or "{" after a field name, so every
    // argument-less field was invisible and the parity check reported false
    // drift on correctly declared operations.
    expect(getSchemaOperations().Query).toContain('registryStats');
    expect(sdlTypeFields(readGraphQLSchema(), 'Query')).toContain('registryStats');
  });

  it('reads argument-less Module fields', () => {
    expect(getSchemaOperations().Module).toContain('versions');
    expect(sdlTypeFields(readGraphQLSchema(), 'Module')).toContain('versions');
  });

  it('returns empty groups for an SDL with no such types', () => {
    expect(getSchemaOperations('scalar JSON')).toEqual({ Query: [], Mutation: [], Module: [] });
  });

  it('accepts an explicit SDL string', () => {
    const declared = getSchemaOperations('type Query {\n  onlyThis(seed: String): String\n}\n');
    expect(declared.Query).toEqual(['onlyThis']);
  });
});

describe('GraphQL schema declarations', () => {
  const sdl = readGraphQLSchema();

  it('declares the Version type', () => {
    expect(sdl).toMatch(/type Version\s*\{/);
    expect(sdlTypeFields(sdl, 'Version')).toEqual(expect.arrayContaining([
      'version', 'manifest', 'tarball', 'integrity', 'publishedAt', 'publishedBy', 'fileCount',
    ]));
  });

  it('declares the JSON scalar', () => {
    expect(sdl).toMatch(/^scalar JSON$/m);
  });

  it('declares every resolver group member', () => {
    const implemented = getResolverOperations();
    expect(sdlTypeFields(sdl, 'Query').sort()).toEqual([...implemented.Query].sort());
    expect(sdlTypeFields(sdl, 'Mutation').sort()).toEqual([...implemented.Mutation].sort());
  });

  it('declares the Module fields the resolvers return', () => {
    expect(sdlTypeFields(sdl, 'Module')).toEqual(expect.arrayContaining([
      'name', 'version', 'description', 'author', 'tags',
      'downloads', 'publishedAt', 'archived', 'versionCount', 'versions',
    ]));
  });

  it('declares the RegistryStats fields registryStats returns', () => {
    expect(sdlTypeFields(sdl, 'RegistryStats')).toEqual([
      'modules',
      'totalVersions',
      'archived',
      'totalDownloads',
      'lastUpdated',
    ]);
  });


  it('has a resolver function behind every declared Query and Mutation field', () => {
    for (const name of sdlTypeFields(sdl, 'Query')) {
      expect(typeof (resolvers.Query as Record<string, unknown>)[name]).toBe('function');
    }
    for (const name of sdlTypeFields(sdl, 'Mutation')) {
      expect(typeof (resolvers.Mutation as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// Spec files
// ---------------------------------------------------------------------------

describe('readOpenAPI() / readGraphQLSchema()', () => {
  it('returns non-empty content', () => {
    expect(readOpenAPI().trim().length).toBeGreaterThan(0);
    expect(readGraphQLSchema().trim().length).toBeGreaterThan(0);
  });

  it('matches the file on disk', () => {
    expect(readOpenAPI()).toBe(readFileSync(OPENAPI_PATH, 'utf-8'));
    expect(readGraphQLSchema()).toBe(readFileSync(GRAPHQL_SCHEMA_PATH, 'utf-8'));
  });

  it('points at the shipped spec files', () => {
    expect(OPENAPI_PATH.endsWith('openapi.yaml')).toBe(true);
    expect(GRAPHQL_SCHEMA_PATH.endsWith('schema.graphql')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI document
// ---------------------------------------------------------------------------

describe('openapi.yaml', () => {
  it('parses without errors', () => {
    expect(parseYAML(readOpenAPI()).errors).toEqual([]);
  });

  it('declares openapi 3.0.3 and an info.version', () => {
    const doc = loadOpenAPI();
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.version).toBe(API_VERSION);
    expect(typeof doc.info.title).toBe('string');
  });

  it('declares paths and a components.schemas block', () => {
    const doc = loadOpenAPI();
    expect(typeof doc.paths).toBe('object');
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
    expect(typeof doc.components.schemas).toBe('object');
  });

  it('declares the shared schemas', () => {
    const schemas = loadOpenAPI().components.schemas as Record<string, unknown>;
    for (const name of ['Module', 'Version', 'PublishRequest', 'RegistryStats', 'Error']) {
      expect(Object.keys(schemas)).toContain(name);
    }
  });

  it('declares an operation for each REST concept', () => {
    const ids = operations(loadOpenAPI()).map((o) => o.operationId);
    expect(ids).toEqual(expect.arrayContaining([
      'listModules',         // list
      'publishModule',       // publish
      'getModule',           // get
      'deleteModule',        // delete
      'archiveModule',       // archive
      'listModuleVersions',  // versions
      'getModuleVersion',    // one version
      'searchModules',       // search
      'getRegistryStats',    // stats
    ]));
  });

  it('gives every operation a distinct operationId', () => {
    const ids = operations(loadOpenAPI())
      .map((o) => o.operationId)
      .filter((id): id is string => typeof id === 'string');
    expect(ids.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every GraphQL operation with an operationId', () => {
    // The REST side renames the list and single-fetch operations, so the
    // mapping is spelled out rather than inferred: nothing here may be silent.
    const REST_NAMES: Record<string, string> = {
      modules: 'listModules',
      module: 'getModule',
      searchModules: 'searchModules',
      moduleVersions: 'listModuleVersions',
      moduleVersion: 'getModuleVersion',
      registryStats: 'getRegistryStats',
      publishModule: 'publishModule',
      deleteModule: 'deleteModule',
      archiveModule: 'archiveModule',
    };
    const ids = operations(loadOpenAPI()).map((o) => o.operationId);
    for (const name of [...getResolverOperations().Query, ...getResolverOperations().Mutation]) {
      expect(REST_NAMES[name], `no REST mapping declared for ${name}`).toBeDefined();
      expect(ids).toContain(REST_NAMES[name]);
    }
  });

  it('declares a 404 on every path that addresses one module or version', () => {
    const doc = loadOpenAPI();
    for (const op of operations(doc)) {
      if (!op.path.includes('{name}')) continue;
      const responses = (doc.paths[op.path] as Record<string, any>)[op.method].responses;
      expect(Object.keys(responses), `${op.method.toUpperCase()} ${op.path}`).toContain('404');
    }
  });

  it('backs every $ref with a declaration in components', () => {
    const doc = loadOpenAPI();
    const refs = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '$ref' && typeof value === 'string') refs.add(value);
        else walk(value);
      }
    };
    walk(doc.paths);
    walk(doc.components.schemas);
    expect(refs.size).toBeGreaterThan(0);
    for (const ref of refs) {
      const segments = ref.replace(/^#\//, '').split('/');
      let node: any = doc;
      for (const segment of segments) {
        expect(node, `dangling $ref ${ref}`).toBeDefined();
        node = node?.[segment];
      }
      expect(node, `dangling $ref ${ref}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// describeApi()
// ---------------------------------------------------------------------------

describe('describeApi()', () => {
  it('mentions the version and the operation counts', () => {
    const summary = describeApi();
    const ops = getResolverOperations();
    expect(summary).toContain(API_VERSION);
    expect(summary).toContain(`${ops.Query.length} queries`);
    expect(summary).toContain(`${ops.Mutation.length} mutations`);
    expect(summary).toContain(`${ops.Module.length} module fields`);
  });

  it('is a single line', () => {
    expect(describeApi().split('\n').length).toBe(1);
  });
});

/**
 * Real parser validation.
 *
 * Every other check in this file reads the SDL with regular expressions, which
 * is enough to compare names but not to know the document is *valid*. A header
 * written as a `"""` block instead of a `#` comment passed every regex check
 * here and then failed at runtime with a syntax error, so the whole GraphQL
 * surface answered 501. These tests parse with the reference implementation, so
 * a malformed document fails here instead of in production.
 */
describe('SDL validity', () => {
  it('parses with the reference graphql parser', () => {
    const sdl = readGraphQLSchema();
    expect(() => parse(sdl)).not.toThrow();
  });

  it('builds an executable schema', () => {
    expect(() => buildSchema(readGraphQLSchema())).not.toThrow();
  });

  it('declares the query and mutation roots the server routes to', () => {
    const schema = buildSchema(readGraphQLSchema());
    expect(schema.getQueryType()?.name).toBe('Query');
    expect(schema.getMutationType()?.name).toBe('Mutation');
  });

it('starts with comments, so the header is not mistaken for a description', () => {
    // A `"""` header silently becomes the description of the first type, which
    // is how two descriptions ended up on one definition. The parser now
    // rejects that, but naming the cause keeps the failure readable.
    expect(readGraphQLSchema().trimStart().startsWith('#')).toBe(true);
  });

  it('gives every type exactly the description it declares', () => {
    // A type may have one description; the parser rejects a second, so the
    // parse test above already covers the double-description case.
    const document = parse(readGraphQLSchema());
    const described = document.definitions
      .filter((d) => d.kind === 'ObjectTypeDefinition' || d.kind === 'InterfaceTypeDefinition')
      .filter((d) => d.description !== undefined)
      .map((d) => (d as { name: { value: string } }).name.value);
    expect(described).toContain('Module');
  });
});

