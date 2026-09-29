# Production Dockerfile for MAM.
# The full monorepo is used as the build context so every workspace package
# (including the standalone engines and MCP) is available to the build.
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# --- build stage ---
FROM base AS builder

WORKDIR /app

# Copy the whole repo (respecting .dockerignore), then install + build.
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm run build

# --- production stage ---
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules

# Copy every package's build output.
COPY --from=builder /app/ast/dist ./ast/dist
COPY --from=builder /app/cli/dist ./cli/dist
COPY --from=builder /app/compiler/dist ./compiler/dist
COPY --from=builder /app/context-engine/dist ./context-engine/dist
COPY --from=builder /app/knowledge-engine/dist ./knowledge-engine/dist
COPY --from=builder /app/lsp/dist ./lsp/dist
COPY --from=builder /app/mcp/dist ./mcp/dist
COPY --from=builder /app/memory-engine/dist ./memory-engine/dist
COPY --from=builder /app/observability/dist ./observability/dist
COPY --from=builder /app/package-manager/dist ./package-manager/dist
COPY --from=builder /app/parser/dist ./parser/dist
COPY --from=builder /app/reference/dist ./reference/dist
COPY --from=builder /app/registry ./registry
COPY --from=builder /app/runtime/dist ./runtime/dist
COPY --from=builder /app/security/dist ./security/dist
COPY --from=builder /app/sdk ./sdk
COPY --from=builder /app/spec ./spec
COPY --from=builder /app/testing/dist ./testing/dist
COPY --from=builder /app/token-optimization/dist ./token-optimization/dist
COPY --from=builder /app/tool-engine/dist ./tool-engine/dist
COPY --from=builder /app/validator/dist ./validator/dist
COPY --from=builder /app/visualization/dist ./visualization/dist

WORKDIR /app/cli

EXPOSE 3000

CMD ["node", "dist/index.js"]