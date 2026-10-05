/**
 * MAM Hub production launcher.
 *
 * Reads every secret from the environment — nothing sensitive lives here.
 * See DEPLOY.md for the full production guide.
 *
 * Required: MAM_ADMIN_PASSWORD
 * Optional: PORT, HOST, MAM_DATA_DIR, MAM_CORS, MAM_RATE_LIMIT
 */
import { RegistryServer, RegistryHttpServer } from './dist/index.js';

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
  authRequired: true,
  rateLimit: Number(process.env.MAM_RATE_LIMIT ?? 100),
  rateLimitWindowMs: 60_000,
  maxUploadSize: 5 * 1024 * 1024,
  corsOrigins: (process.env.MAM_CORS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  auth: {
    bootstrapAdmin: {
      username: process.env.MAM_ADMIN_USER ?? 'admin',
      email: process.env.MAM_ADMIN_EMAIL ?? 'admin@example.com',
      password,
    },
  },
  logger: console,
});

await server.start();
const http = new RegistryHttpServer({ server, port, host });
await http.listen();
console.log(`MAM Hub listening on http://${host}:${port}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`Received ${sig}, draining...`);
    await http.close();
    await server.stop();
    process.exit(0);
  });
}
