/**
 * MAM Registry GraphQL Resolvers
 */

export const resolvers = {
  Query: {
    modules: async (_parent: unknown, args: { query?: string }) => {
      return [];
    },
    module: async (_parent: unknown, args: { name: string }) => {
      return null;
    },
  },
  Mutation: {
    publishModule: async (_parent: unknown, args: { name: string; version: string; description?: string }) => {
      return { name: args.name, version: args.version, description: args.description };
    },
  },
};
