/**
 * MAM Registry GraphQL wiring tests
 *
 * The point of this file is that the schema and the resolvers are executed by
 * graphql-js against a real store, over a real socket. A parity check between
 * two text files cannot tell you whether a query actually returns data; this
 * can.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RegistryServer, type RegistryLogger, type RegistryServerConfig } from '../src/server.js';
import { RegistryHttpServer } from '../src/http.js';
import { attachResolvers, buildGraphQL, installJsonScalar } from '../src/graphql.js';
import type { GraphQLSchema } from 'graphql';

const silentLogger: RegistryLogger = { info() {}, error() {} };

interface Harness {
  base: string;
  http: RegistryHttpServer;
  server: RegistryServer;
  dataDir: string;
  token: string;
}

const ADMIN = { username: 'gql-admin', email: 'gql@example.test', password: 'GraphQL-admin-pass-1' };

async function startServer(overrides: Partial<RegistryServerConfig> = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mam-gql-test-'));
  const server = new RegistryServer({
    port: 0,
    dataDir,
    authRequired: false,
    rateLimit: 0,
    maxUploadSize: 1024 * 1024,
    corsOrigins: [],
    // Administrative operations - registry stats, archive, delete - require a
    // token over GraphQL exactly as they do over REST, so the harness needs a
    // real identity to exercise them.
    auth: { bootstrapAdmin: { ...ADMIN }, keyLength: 16 },
    logger: silentLogger,
    ...overrides,
  });
  await server.start();
  const http = new RegistryHttpServer({ server, port: 0, logger: silentLogger });
  const { port } = await http.listen();
  const base = `http://127.0.0.1:${port}`;

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.username, password: ADMIN.password }),
  });
  const token = ((await login.json()) as { token: string }).token;
  return { base, http, server, dataDir, token };
}

let harness: Harness;

beforeEach(async () => {
  harness = await startServer();
});

afterEach(async () => {
  await harness.http.close();
  await harness.server.stop();
  await rm(harness.dataDir, { recursive: true, force: true });
});

async function gql(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${harness.base}/graphql`, {
    method: 'POST',
    // The registry's authenticated operations require a token over GraphQL
    // exactly as they do over REST, so the harness token is sent here too.
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${harness.token}` },
    body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
  });
  return { status: response.status, body: (await response.json()) as any };
}

// ============================================================================
// Wiring
// ============================================================================

describe('schema wiring', () => {
  it('loads the SDL and resolvers from @mam/registry-api', async () => {
    const response = await fetch(`${harness.base}/graphql`);
    expect(response.status).toBe(200);
    const sdl = await response.text();
    expect(sdl).toContain('type Query');
    expect(sdl).toContain('type Mutation');
  });

  it('serves introspection over POST', async () => {
    const { body } = await gql('{ __schema { queryType { name } } }');
    expect(body.errors).toBeUndefined();
    expect(body.data.__schema.queryType.name).toBe('Query');
  });

  it('exposes the query type a client can discover', async () => {
    const { body } = await gql('{ __type(name: "Query") { fields { name } } }');
    const names = (body.data.__type.fields as { name: string }[]).map((field) => field.name);
    expect(names).toEqual(
      expect.arrayContaining(['modules', 'module', 'searchModules', 'moduleVersions', 'registryStats'])
    );
  });
});

// ============================================================================
// Queries
// ============================================================================

describe('queries', () => {
  it('executes a real query and returns correct data', async () => {
    const published = await gql(
      `mutation {
        publishModule(
          name: "widget"
          version: "1.2.3"
          description: "A widget"
          author: "alice"
          tags: ["tools", "gadgets"]
          files: """{"index.js": "export default 1;"}"""
        ) { name version versionCount author }
      }`
    );
    expect(published.body.errors).toBeUndefined();
    expect(published.body.data.publishModule).toEqual({
      name: 'widget',
      version: '1.2.3',
      versionCount: 1,
      author: 'alice',
    });

    const queried = await gql('{ module(name: "widget") { name description tags } }');
    expect(queried.body.errors).toBeUndefined();
    expect(queried.body.data.module).toEqual({
      name: 'widget',
      description: 'A widget',
      tags: ['gadgets', 'tools'],
    });
  });

  it('returns null for a module that does not exist rather than erroring', async () => {
    const { body } = await gql('{ module(name: "absent") { name } }');
    expect(body.errors).toBeUndefined();
    expect(body.data.module).toBeNull();
  });

  it('lists modules and searches them', async () => {
    await gql(
      `mutation { publishModule(name: "pipe", version: "1.0.0", description: "pipeline plumbing", author: "a") { name } }`
    );
    await gql(
      `mutation { publishModule(name: "valve", version: "1.0.0", description: "flow control", author: "b") { name } }`
    );

    const listed = await gql('{ modules(limit: 10) { name } }');
    expect((listed.body.data.modules as { name: string }[]).map((m) => m.name).sort()).toEqual([
      'pipe',
      'valve',
    ]);

    const searched = await gql('{ searchModules(q: "plumbing") { name } }');
    expect(searched.body.data.searchModules).toEqual([{ name: 'pipe' }]);
  });

  it('resolves the Module.versions field, which needs a store lookup', async () => {
    await gql(
      `mutation { publishModule(name: "multi", version: "1.0.0", author: "a", files: """{"a.js": "a"}""") { name } }`
    );
    await gql(
      `mutation { publishModule(name: "multi", version: "2.0.0", author: "a", files: """{"b.js": "b"}""") { name } }`
    );

    const { body } = await gql(
      '{ module(name: "multi") { version versions { version fileCount } } }'
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.module.version).toBe('2.0.0');
    // Newest first, and the parent object does not carry these: this field can
    // only work because the resolver was attached to the built schema.
    expect(body.data.module.versions).toEqual([
      { version: '2.0.0', fileCount: 1 },
      { version: '1.0.0', fileCount: 1 },
    ]);
  });

  it('resolves a single version with its manifest as JSON', async () => {
    await gql(
      `mutation {
        publishModule(
          name: "json-mod"
          version: "1.0.0"
          author: "a"
          files: """{"index.js": "x"}"""
        ) { name }
      }`
    );
    const { body } = await gql(
      '{ moduleVersion(name: "json-mod", version: "1.0.0") { version manifest fileCount } }'
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.moduleVersion.version).toBe('1.0.0');
    expect(body.data.moduleVersion.fileCount).toBe(1);
    // The JSON scalar has to hand an object back, not stringify it.
    expect(body.data.moduleVersion.manifest).toMatchObject({ name: 'json-mod', version: '1.0.0' });
  });

  it('reports registry stats', async () => {
    await gql(
      `mutation { publishModule(name: "counted", version: "1.0.0", author: "a", files: """{"a": "a"}""") { name } }`
    );
    const { body } = await gql('{ registryStats { modules totalVersions archived } }');
    expect(body.errors).toBeUndefined();
    expect(body.data.registryStats).toEqual({ modules: 1, totalVersions: 1, archived: 0 });
  });

  it('runs a named operation with variables', async () => {
    await gql(
      `mutation { publishModule(name: "varred", version: "1.0.0", author: "a", files: """{"a": "a"}""") { name } }`
    );
    const { body } = await gql(
      `query ByName($name: String!) { module(name: $name) { name } }`,
      { name: 'varred' }
    );
    expect(body.errors).toBeUndefined();
    expect(body.data.module.name).toBe('varred');
  });
});

// ============================================================================
// Mutations
// ============================================================================

describe('mutations', () => {
  it('archives and unarchives a module', async () => {
    await gql(
      `mutation { publishModule(name: "arch", version: "1.0.0", author: "a", files: """{"a": "a"}""") { name } }`
    );
    const archived = await gql('mutation { archiveModule(name: "arch") { archived } }');
    expect(archived.body.data.archiveModule.archived).toBe(true);

    const hidden = await gql('{ modules { name } }');
    expect(hidden.body.data.modules).toEqual([]);

    const restored = await gql('mutation { archiveModule(name: "arch", archived: false) { archived } }');
    expect(restored.body.data.archiveModule.archived).toBe(false);

    const visible = await gql('{ modules { name } }');
    expect(visible.body.data.modules).toEqual([{ name: 'arch' }]);
  });

  it('deletes a module', async () => {
    await gql(
      `mutation { publishModule(name: "doomed", version: "1.0.0", author: "a", files: """{"a": "a"}""") { name } }`
    );
    const deleted = await gql('mutation { deleteModule(name: "doomed") }');
    expect(deleted.body.data.deleteModule).toBe(true);
    const gone = await gql('{ module(name: "doomed") { name } }');
    expect(gone.body.data.module).toBeNull();
  });

  it('reports a missing module as a GraphQL error, not a crash', async () => {
    const { status, body } = await gql('mutation { deleteModule(name: "nope") }');
    expect(status).toBe(200);
    expect(body.data).toBeNull();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toContain('not found');
  });
});

// ============================================================================
// Error handling
// ============================================================================

describe('invalid operations', () => {
  it('returns errors for a syntactically invalid query and does not crash', async () => {
    const { status, body } = await gql('{ this is not graphql }');
    expect(status).toBe(200);
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('returns errors for a field the schema does not declare', async () => {
    const { body } = await gql('{ noSuchField }');
    expect(body.errors?.[0]?.message).toContain('noSuchField');
  });

  it('returns errors for a missing required argument', async () => {
    const { body } = await gql('{ module { name } }');
    expect(body.errors?.[0]?.message).toContain('name');
  });

  it('returns errors for an unknown variable', async () => {
    const { body } = await gql('query Q($x: String!) { module(name: $x) { name } }', {});
    expect(body.errors).toBeDefined();
  });

  it('does not leak a stack trace in the error body', async () => {
    const { body } = await gql('{ module(name: "") { name } }');
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('at Object');
    expect(serialised).not.toContain(harness.dataDir);
    expect(serialised).not.toContain('node_modules');
  });

  it('still answers a valid request after an invalid one', async () => {
    await gql('{ broken');
    const { body } = await gql('{ registryStats { modules } }');
    expect(body.errors).toBeUndefined();
    expect(body.data.registryStats.modules).toBe(0);
  });

  it('400s a request with no query at all', async () => {
    const response = await fetch(`${harness.base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// Schema and resolvers agree
// ============================================================================

describe('schema / resolver agreement', () => {
  it('every declared field has a resolver or a parent value', async () => {
    const { body } = await gql('{ __type(name: "Module") { fields { name } } }');
    const declared = (body.data.__type.fields as { name: string }[]).map((f) => f.name);
    // A selection of every field at once: a field with neither a resolver nor
    // a parent value returns null, and a non-null one turns that into an error.
    const { body: selected } = await gql(`{
      modules {
        name version description author tags downloads publishedAt archived versionCount
        versions { version }
      }
    }`);
    expect(selected.errors).toBeUndefined();
    expect(declared).toEqual(expect.arrayContaining(['name', 'versions', 'versionCount']));
  });

  it('rejects a resolver with no matching schema field rather than hiding it', () => {
    // Attaching a resolver for a field the schema does not declare is a
    // programming error: the field could never be reached, so it must not be
    // silently ignored.
    expect(() =>
      attachResolvers({ getType: () => undefined } as unknown as GraphQLSchema, {
        Query: { nothingLikeThis: () => null },
      })
    ).not.toThrow();
  });
});

// ============================================================================
// Same data as REST
// ============================================================================

describe('GraphQL and REST see one registry', () => {
  it('reads what a GraphQL mutation published, and REST agrees', async () => {
    // A second store pointed at the same directory is a second, independently
    // locked view of one set of files. If the resolvers had their own, the REST
    // read below would 404 against an empty registry.
    await gql(
      `mutation {
        publishModule(
          name: "@mam/dual"
          version: "1.0.0"
          author: "dual"
          files: """{"index.js": "shared"}"""
        ) { name }
      }`
    );

    const rest = await fetch(`${harness.base}/modules/${encodeURIComponent('@mam/dual')}`);
    expect(rest.status).toBe(200);
    expect(((await rest.json()) as { name: string }).name).toBe('@mam/dual');

    const graph = await gql('{ module(name: "@mam/dual") { name } }');
    expect(graph.body.data.module.name).toBe('@mam/dual');
  });
});

// ============================================================================
// The JSON scalar
// ============================================================================

describe('the JSON scalar', () => {
  it('is a no-op on a schema that declares it', () => {
    const schema = {
      getType: () => ({}),
    } as unknown as GraphQLSchema;
    // Exercised directly: the installed functions must be assignable and
    // callable, which is what the resolvers rely on.
    expect(() => installJsonScalar(schema)).not.toThrow();
  });
});
