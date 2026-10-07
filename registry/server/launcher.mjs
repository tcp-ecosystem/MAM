/**
 * MAM Hub production launcher.
 *
 * Reads every secret from the environment — nothing sensitive lives here.
 * See DEPLOY.md for the full production guide.
 *
 * Required: MAM_ADMIN_PASSWORD
 * Optional: PORT, HOST, MAM_DATA_DIR, MAM_CORS, MAM_RATE_LIMIT,
 *   MAM_AUTH_REQUIRED, MAM_SEED_DIR
 *
 * Self-seeding: when MAM_SEED_DIR points at a directory of `.mam` files and
 * the store is empty, the founding modules are published on boot. Restarts
 * converge to the same registry, so ephemeral disks (free hosting) are safe:
 * wipe the data dir and the next boot rebuilds it from git.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { RegistryServer, RegistryHttpServer } from './dist/index.js';
import { parseMAM } from '@mam/parser';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const password = required('MAM_ADMIN_PASSWORD');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const server = new RegistryServer({
  port,
  dataDir: process.env.MAM_DATA_DIR ?? './data',
  // Public registries read open, write gated: anyone may search, fetch and
  // download; publishing, deleting and archiving always need a token (the
  // server enforces that regardless of this flag). Default stays closed.
  authRequired: (process.env.MAM_AUTH_REQUIRED ?? 'true') !== 'false',
  rateLimit: Number(process.env.MAM_RATE_LIMIT ?? 100),
  rateLimitWindowMs: 60_000,
  maxUploadSize: 5 * 1024 * 1024,
  corsOrigins: (process.env.MAM_CORS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  auth: {
    // dataDir turns on auth persistence (users + tokens in auth.json).
    // Without it every restart wipes all accounts and sessions.
    dataDir: process.env.MAM_DATA_DIR ?? './data',
    bootstrapAdmin: {
      username: process.env.MAM_ADMIN_USER ?? 'admin',
      email: process.env.MAM_ADMIN_EMAIL ?? 'admin@example.com',
      password,
    },
  },
  logger: console,
});

await server.start();
await seedIfEmpty(server);
const http = new RegistryHttpServer({ server, port, host });
await http.listen();
console.log(`MAM Hub listening on http://${host}:${port}`);

/**
 * Publishes every `.mam` file in MAM_SEED_DIR when the store is empty.
 *
 * Writes bypass HTTP and go straight to the store: this runs before any
 * client exists, and the content is our own git tree, not user input.
 * The search index is rebuilt once at the end instead of per publish.
 */
async function seedIfEmpty(server) {
  const seedDir = process.env.MAM_SEED_DIR;
  if (!seedDir || !existsSync(seedDir)) return;
  const stats = await server.moduleStore.getStats();
  if (stats.totalModules > 0) {
    console.log(`Seed skipped: store already holds ${stats.totalModules} modules.`);
    return;
  }
  const files = readdirSync(seedDir).filter((f) => f.endsWith('.mam')).sort();
  let seeded = 0;
  for (const file of files) {
    try {
      const content = readFileSync(join(seedDir, file), 'utf-8');
      const { ast, errors } = parseMAM(content, { source: file });
      if (errors.length > 0) throw new Error(`${errors.length} parse errors`);
      const fm = ast.frontmatter?.data;
      if (!fm?.id || !fm?.version) throw new Error('missing id/version');
      await server.moduleStore.publish(
        {
          name: fm.id,
          version: fm.version,
          description: fm.description ?? '',
          author: fm.author ?? 'MAM Team',
          tags: fm.tags ?? [],
        },
        new Map([[basename(file), content]]),
        'seed'
      );
      seeded++;
    } catch (error) {
      console.log(`Seed skipped ${file}: ${error.message}`);
    }
  }
  await server.reindexSearch();
  console.log(`Seeded ${seeded} founding modules from ${seedDir}.`);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`Received ${sig}, draining...`);
    await http.close();
    await server.stop();
    process.exit(0);
  });
}
