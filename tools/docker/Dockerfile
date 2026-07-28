# Production Dockerfile for MAM
FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@8.14.0 --activate

# --- build stage ---
FROM base AS builder

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY turbo.json ./
COPY tsconfig.json ./

# Copy workspace packages
COPY parser/ parser/
COPY ast/ ast/
COPY compiler/ compiler/
COPY runtime/ runtime/
COPY validator/ validator/
COPY cli/ cli/
COPY sdk/ sdk/
COPY plugins/ plugins/
COPY spec/ spec/
COPY visualization/ visualization/
COPY lsp/ lsp/

RUN pnpm install --frozen-lockfile
RUN pnpm run build

# --- production stage ---
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules

# Copy built packages
COPY --from=builder /app/cli/dist ./cli/dist
COPY --from=builder /app/runtime/dist ./runtime/dist
COPY --from=builder /app/compiler/dist ./compiler/dist
COPY --from=builder /app/parser/dist ./parser/dist
COPY --from=builder /app/ast/dist ./ast/dist
COPY --from=builder /app/validator/dist ./validator/dist

WORKDIR /app/cli

EXPOSE 3000

CMD ["node", "dist/index.js"]
