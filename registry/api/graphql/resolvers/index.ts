/**
 * MAM Registry GraphQL Resolvers
 *
 * Maps GraphQL operations to the server-side ModuleStore.
 */

import { ModuleStore, type ModuleRecord, type VersionRecord } from '../../../server/src/store.js';

// ============================================================================
// Store singleton (lazy init)
// ============================================================================

let store: ModuleStore | null = null;

function getStore(): ModuleStore {
  if (!store) {
    store = new ModuleStore(process.env.MAM_DATA_DIR ?? '.mam-data');
  }
  return store;
}

// ============================================================================
// Input validation helpers
// ============================================================================

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

function sanitizeModule(record: ModuleRecord) {
  return {
    name: record.name,
    version: record.latest,
    description: record.description,
    author: record.author,
    tags: record.tags,
    downloads: 0,
    publishedAt: record.updatedAt,
  };
}

function sanitizeVersion(v: VersionRecord) {
  return {
    version: v.version,
    manifest: v.manifest,
    tarball: v.tarball,
    integrity: v.integrity,
    publishedAt: v.publishedAt,
    publishedBy: v.publishedBy,
  };
}

// ============================================================================
// Resolvers
// ============================================================================

export const resolvers = {
  Query: {
    /**
     * modules(query: String, tag: String, author: String, limit: Int, offset: Int): [Module]
     *
     * List modules with optional filtering and pagination.
     */
    modules: async (
      _parent: unknown,
      args: {
        query?: string;
        tag?: string;
        author?: string;
        limit?: number;
        offset?: number;
      },
    ) => {
      const s = getStore();
      let modules = await s.getAllModules();

      // text search
      if (args.query) {
        const q = args.query.toLowerCase();
        modules = modules.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.description.toLowerCase().includes(q) ||
            m.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }

      // tag filter
      if (args.tag) {
        const tag = args.tag.toLowerCase();
        modules = modules.filter((m) => m.tags.some((t) => t.toLowerCase() === tag));
      }

      // author filter
      if (args.author) {
        const author = args.author.toLowerCase();
        modules = modules.filter((m) => m.author.toLowerCase() === author);
      }

      // pagination
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 20;
      return modules.slice(offset, offset + limit).map(sanitizeModule);
    },

    /**
     * module(name: String!): Module
     *
     * Fetch a single module by name.
     */
    module: async (_parent: unknown, args: { name: string }) => {
      const name = requireString(args.name, 'name');
      const s = getStore();
      const record = await s.getModule(name);
      if (!record) return null;
      return sanitizeModule(record);
    },

    /**
     * searchModules(q: String!, limit: Int): [Module]
     *
     * Full-text search across name, description and tags.
     */
    searchModules: async (
      _parent: unknown,
      args: { q: string; limit?: number },
    ) => {
      const q = requireString(args.q, 'q');
      const s = getStore();
      const modules = await s.getAllModules();
      const limit = args.limit ?? 20;

      const results = modules
        .filter((m) => {
          const lower = q.toLowerCase();
          return (
            m.name.toLowerCase().includes(lower) ||
            m.description.toLowerCase().includes(lower) ||
            m.tags.some((t) => t.toLowerCase().includes(lower))
          );
        })
        .slice(0, limit);

      return results.map(sanitizeModule);
    },

    /**
     * moduleVersions(name: String!): [Version]
     *
     * List all versions for a module.
     */
    moduleVersions: async (_parent: unknown, args: { name: string }) => {
      const name = requireString(args.name, 'name');
      const s = getStore();
      const record = await s.getModule(name);
      if (!record) throw new Error(`Module "${name}" not found`);
      return Object.values(record.versions).map(sanitizeVersion);
    },

    /**
     * registryStats: RegistryStats
     *
     * Return aggregate registry statistics.
     */
    registryStats: async () => {
      const s = getStore();
      return s.getStats();
    },
  },

  Mutation: {
    /**
     * publishModule(name!, version!, description, author, tags, files): Module
     *
     * Publish a new module or a new version of an existing module.
     */
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
    ) => {
      const name = requireString(args.name, 'name');
      const version = requireString(args.version, 'version');
      const author = args.author ?? 'anonymous';
      const description = args.description ?? '';
      const tags = args.tags ?? [];
      const files = new Map(Object.entries(args.files ?? {}));

      const manifest = { name, version, description, author, tags } as any;
      const s = getStore();
      await s.publish(manifest, files, author);

      const record = await s.getModule(name);
      return sanitizeModule(record!);
    },

    /**
     * deleteModule(name!): Boolean
     *
     * Remove a module from the registry.
     */
    deleteModule: async (_parent: unknown, args: { name: string }) => {
      const name = requireString(args.name, 'name');
      const s = getStore();
      const existing = await s.getModule(name);
      if (!existing) throw new Error(`Module "${name}" not found`);
      await s.deleteModule(name);
      return true;
    },

    /**
     * archiveModule(name!): Module
     *
     * Mark a module as archived (sets a flag in the record).
     */
    archiveModule: async (_parent: unknown, args: { name: string }) => {
      const name = requireString(args.name, 'name');
      const s = getStore();
      const record = await s.getModule(name);
      if (!record) throw new Error(`Module "${name}" not found`);

      // store doesn't have a native archive flag – write metadata to indicate it
      (record as any).archived = true;
      record.updatedAt = new Date().toISOString();

      // re-persist via a publish of the latest version (no file change)
      const latest = record.versions[record.latest];
      if (latest) {
        const filesMap = new Map(Object.entries(latest.files));
        await s.publish(latest.manifest, filesMap, latest.publishedBy);
      }

      return sanitizeModule(record);
    },
  },
};
