/**
 * MAM Registry GraphQL Resolvers
 *
 * Maps GraphQL operations onto the server-side ModuleStore.
 *
 * Imports `@mam/registry-server` as a package rather than reaching into its
 * source tree, so the API package stands on its own and keeps working when the
 * server is built or published.
 */

import {
  ModuleStore,
  type ModuleRecord,
  type VersionRecord,
} from '@mam/registry-server';

// ============================================================================
// Store
// ============================================================================

export interface ResolverStoreOptions {
  /** Data directory. Defaults to `$MAM_DATA_DIR`, then `.mam-data`. */
  dataDir?: string;
  /** Pre-built store, mostly for tests. */
  store?: ModuleStore;
}

let sharedStore: ModuleStore | null = null;

function getStore(options?: ResolverStoreOptions): ModuleStore {
  if (options?.store) return options.store;
  if (!sharedStore) {
    sharedStore = new ModuleStore(options?.dataDir ?? process.env.MAM_DATA_DIR ?? '.mam-data');
  }
  return sharedStore;
}

/** Drops the cached store. Used by tests and by long-lived hosts on reload. */
export function resetResolverStore(): void {
  sharedStore = null;
}

// ============================================================================
// Input validation
// ============================================================================

/** Raised when a resolver receives an argument it cannot use. */
export class ResolverInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'ResolverInputError';
    this.field = field;
  }
}

/** Raised when a named module does not exist. */
export class ModuleNotFoundError extends Error {
  readonly moduleName: string;
  constructor(moduleName: string) {
    super(`Module "${moduleName}" not found`);
    this.name = 'ModuleNotFoundError';
    this.moduleName = moduleName;
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ResolverInputError(field, `${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

/** Clamps a page size into a sane range so a caller cannot ask for everything. */
export function normalizeLimit(limit: number | undefined, fallback = 20, max = 100): number {
  if (limit === undefined || Number.isNaN(limit)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit), max));
}

/** Clamps an offset to a non-negative integer. */
export function normalizeOffset(offset: number | undefined): number {
  if (offset === undefined || Number.isNaN(offset) || offset < 0) return 0;
  return Math.floor(offset);
}

/** Normalises a tag list: trimmed, lowercased, de-duplicated, sorted. */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return [...new Set(
    tags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0),
  )].sort();
}

// ============================================================================
// Shapes returned to GraphQL
// ============================================================================

export interface ModuleShape {
  name: string;
  version: string;
  description: string | null;
  author: string;
  tags: string[];
  downloads: number;
  publishedAt: string;
  archived: boolean;
  versionCount: number;
}

export interface VersionShape {
  version: string;
  manifest: unknown;
  tarball: string;
  integrity: string;
  publishedAt: string;
  publishedBy: string;
  fileCount: number;
}

export function sanitizeModule(record: ModuleRecord): ModuleShape {
  return {
    name: record.name,
    version: record.latest,
    description: record.description || null,
    author: record.author,
    tags: [...record.tags],
    // The store does not track download counts yet, so this is a real zero
    // rather than a field that pretends to vary.
    downloads: 0,
    publishedAt: record.updatedAt,
    archived: record.archived === true,
    versionCount: Object.keys(record.versions).length,
  };
}

export function sanitizeVersion(v: VersionRecord): VersionShape {
  return {
    version: v.version,
    manifest: v.manifest,
    tarball: v.tarball,
    integrity: v.integrity,
    publishedAt: v.publishedAt,
    publishedBy: v.publishedBy,
    fileCount: Object.keys(v.files).length,
  };
}

// ============================================================================
// Field resolvers
// ============================================================================

export const moduleFields = {
  /** Every published version, newest semver first. */
  versions: async (parent: ModuleShape & { name: string }, _args: unknown, ctx: ResolverContext) => {
    const record = await ctx.store.getModule(parent.name);
    if (!record) return [];
    return Object.values(record.versions)
      .map(sanitizeVersion)
      .sort((a, b) => compareVersionsDesc(a.version, b.version));
  },
};

/** Orders two version strings newest first, falling back to a string compare. */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na;
    if (pa[i] !== pb[i]) return String(pb[i] ?? '').localeCompare(String(pa[i] ?? ''));
  }
  return 0;
}

// ============================================================================
// Resolvers
// ============================================================================

export interface ResolverContext {
  store: ModuleStore;
}

export interface ListArgs {
  query?: string;
  tag?: string;
  author?: string;
  limit?: number;
  offset?: number;
  /** Hide archived modules unless `includeArchived` is true. */
  includeArchived?: boolean;
}

function matches(record: ModuleRecord, args: ListArgs): boolean {
  if (record.archived === true && args.includeArchived !== true) return false;

  if (args.query) {
    const q = args.query.toLowerCase();
    const hit =
      record.name.toLowerCase().includes(q) ||
      record.description.toLowerCase().includes(q) ||
      record.tags.some((t) => t.toLowerCase().includes(q));
    if (!hit) return false;
  }
  if (args.tag) {
    const tag = args.tag.trim().toLowerCase();
    if (!record.tags.some((t) => t.toLowerCase() === tag)) return false;
  }
  if (args.author) {
    if (record.author.toLowerCase() !== args.author.trim().toLowerCase()) return false;
  }
  return true;
}

export const resolvers = {
  Module: moduleFields,

  Query: {
    /** modules(query, tag, author, limit, offset, includeArchived): [Module!]! */
    modules: async (_parent: unknown, args: ListArgs, ctx: ResolverContext) => {
      const all = await ctx.store.getAllModules();
      const filtered = all.filter((m) => matches(m, args));
      const offset = normalizeOffset(args.offset);
      const limit = normalizeLimit(args.limit);
      return filtered.slice(offset, offset + limit).map(sanitizeModule);
    },

    /** module(name: String!): Module */
    module: async (_parent: unknown, args: { name: string }, ctx: ResolverContext) => {
      const name = requireString(args.name, 'name');
      const record = await ctx.store.getModule(name);
      return record ? sanitizeModule(record) : null;
    },

    /** searchModules(q: String!, limit: Int): [Module!]! */
    searchModules: async (_parent: unknown, args: { q: string; limit?: number }, ctx: ResolverContext) => {
      const q = requireString(args.q, 'q');
      const all = await ctx.store.getAllModules();
      return all
        .filter((m) => m.archived !== true)
        .filter((m) => matches(m, { query: q }))
        .slice(0, normalizeLimit(args.limit))
        .map(sanitizeModule);
    },

    /** moduleVersions(name: String!): [Version!]! */
    moduleVersions: async (_parent: unknown, args: { name: string }, ctx: ResolverContext) => {
      const name = requireString(args.name, 'name');
      const record = await ctx.store.getModule(name);
      if (!record) throw new ModuleNotFoundError(name);
      return Object.values(record.versions)
        .map(sanitizeVersion)
        .sort((a, b) => compareVersionsDesc(a.version, b.version));
    },

    /** moduleVersion(name: String!, version: String!): Version */
    moduleVersion: async (
      _parent: unknown,
      args: { name: string; version: string },
      ctx: ResolverContext,
    ) => {
      const name = requireString(args.name, 'name');
      const version = requireString(args.version, 'version');
      const record = await ctx.store.getVersion(name, version);
      return record ? sanitizeVersion(record) : null;
    },

    /** registryStats: RegistryStats! */
    registryStats: async (_parent: unknown, _args: unknown, ctx: ResolverContext) => {
      const stats = await ctx.store.getStats();
      return {
        ...stats,
        // `ModuleStore` counts `totalModules`; the schema names the field
        // `modules`. Spreading alone left it undefined, and a non-null field
        // that resolves to null takes the whole query down with it.
        modules: stats.totalModules,
        archived: (await ctx.store.getAllModules()).filter((m) => m.archived === true).length,
      };
    },
  },

  Mutation: {
    /** publishModule(name!, version!, description, author, tags, files): Module! */
    publishModule: async (
      _parent: unknown,
      args: {
        name: string;
        version: string;
        description?: string;
        author?: string;
        tags?: string[];
        files?: Record<string, string>;
      },
      ctx: ResolverContext,
    ) => {
      const name = requireString(args.name, 'name');
      const version = requireString(args.version, 'version');
      const author = args.author?.trim() || 'anonymous';
      const description = args.description ?? '';
      const tags = normalizeTags(args.tags);
      const files = new Map(Object.entries(args.files ?? {}));

      await ctx.store.publish({ name, version, description, author, tags } as never, files, author);
      const record = await ctx.store.getModule(name);
      if (!record) throw new ModuleNotFoundError(name);
      return sanitizeModule(record);
    },

    /** deleteModule(name: String!): Boolean! */
    deleteModule: async (_parent: unknown, args: { name: string }, ctx: ResolverContext) => {
      const name = requireString(args.name, 'name');
      const existing = await ctx.store.getModule(name);
      if (!existing) throw new ModuleNotFoundError(name);
      await ctx.store.deleteModule(name);
      return true;
    },

    /** archiveModule(name: String!, archived: Boolean = true): Module! */
    archiveModule: async (
      _parent: unknown,
      args: { name: string; archived?: boolean },
      ctx: ResolverContext,
    ) => {
      const name = requireString(args.name, 'name');
      const archived = args.archived ?? true;
      // Delegates to the store so the flag reaches meta.json. Setting it on the
      // in-memory record alone reported success while archiving nothing.
      const record = await ctx.store.setArchived(name, archived);
      return sanitizeModule(record);
    },
  },
};

/**
 * Builds the context a server hands to the resolvers.
 *
 * The store is resolved lazily and cached, so a host does not have to build one
 * just to mount the schema.
 */
export function createResolverContext(options?: ResolverStoreOptions): ResolverContext {
  return { store: getStore(options) };
}

/** Invokes a resolver directly, for hosts without a GraphQL executor. */
export async function invoke(
  operation: 'modules' | 'module' | 'searchModules' | 'moduleVersions' | 'moduleVersion'
  | 'registryStats' | 'publishModule' | 'deleteModule' | 'archiveModule',
  args: Record<string, unknown> = {},
  context?: ResolverContext,
): Promise<unknown> {
  const ctx = context ?? createResolverContext();
  const group = operation === 'publishModule' || operation === 'deleteModule' || operation === 'archiveModule'
    ? resolvers.Mutation
    : resolvers.Query;
  const resolver = (group as Record<string, unknown>)[operation];
  if (typeof resolver !== 'function') {
    throw new Error(`Unknown resolver "${operation}"`);
  }
  return (resolver as (p: unknown, a: unknown, c: unknown) => Promise<unknown>)(null, args, ctx);
}
