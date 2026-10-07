# MAM Hub registry — production image.
#
# Multi-stage: build the workspace packages the server needs, then ship only
# the built output plus production node_modules. No devDeps, no tests.

FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app

# Workspace scaffolding first (layer cache: reinstall only when deps change)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY registry/server/package.json registry/server/
COPY registry/api/package.json registry/api/
COPY registry/client/package.json registry/client/
COPY parser/package.json parser/
COPY ast/package.json ast/
COPY package-manager/package.json package-manager/
RUN pnpm install --frozen-lockfile

# Sources for the build closure (server + its workspace deps)
COPY registry/server/src registry/server/src/
COPY registry/server/tsconfig.json registry/server/
COPY registry/api/src registry/api/src/
COPY registry/api/tsconfig.json registry/api/
COPY registry/api/graphql registry/api/graphql/
COPY registry/api/openapi.yaml registry/api/
COPY registry/client/src registry/client/src/
COPY registry/client/tsconfig.json registry/client/
COPY parser/src parser/src/
COPY parser/tsconfig.json parser/
COPY ast/src ast/src/
COPY ast/tsconfig.json ast/
COPY package-manager/src package-manager/src/
COPY package-manager/tsconfig.json package-manager/

# Build dependencies first, then the server (tsc per package)
RUN pnpm --filter @mam/ast --filter @mam/parser --filter @mam/package-manager --filter @mam/registry-api --filter @mam/registry-client --filter @mam/registry-server build

# --- runtime ---
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY registry/server/package.json registry/server/
COPY registry/api/package.json registry/api/
COPY registry/client/package.json registry/client/
COPY parser/package.json parser/
COPY ast/package.json ast/
COPY package-manager/package.json package-manager/
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY --from=build /app/registry/server/dist registry/server/dist/
COPY --from=build /app/registry/api/dist registry/api/dist/
COPY --from=build /app/registry/api/graphql registry/api/graphql/
COPY --from=build /app/registry/api/openapi.yaml registry/api/openapi.yaml/
COPY --from=build /app/registry/client/dist registry/client/dist/
COPY --from=build /app/parser/dist parser/dist/
COPY --from=build /app/ast/dist ast/dist/
COPY --from=build /app/package-manager/dist package-manager/dist/
COPY registry/server/launcher.mjs registry/server/
# Founding modules for self-seeding (verbatim copies, see seed/README.md).
COPY registry/server/seed/*.mam /app/seed/

ENV HOST=0.0.0.0 PORT=3000 MAM_DATA_DIR=/data MAM_SEED_DIR=/app/seed
EXPOSE 3000
VOLUME ["/data"]
WORKDIR /app/registry/server
CMD ["node", "launcher.mjs"]
