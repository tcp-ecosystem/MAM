/**
 * Seed the public MAM Hub with the founding modules.
 *
 * Reads every per-type example (modules/examples/<type>/<type>.mam), parses
 * its frontmatter with the repo's own parser, and publishes it via the
 * typed registry client. Idempotent: republishing the same version converges
 * (the store serializes per-module writes).
 *
 *   $env:REGISTRY_URL = "https://<your-tunnel>.trycloudflare.com"
 *   $env:MAM_ADMIN_USER = "admin"
 *   $env:MAM_ADMIN_PASSWORD = "<from password manager>"
 *   node registry/server/scripts/seed.mjs
 *
 * Run from the repo root. Requires built dists (pnpm -r build).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseMAM } = await import(pathToFileURL(join(root, 'parser', 'dist', 'index.js')).href);
const { RegistryClient } = await import(pathToFileURL(join(root, 'registry', 'client', 'dist', 'client.js')).href);

const baseUrl = process.env.REGISTRY_URL ?? required('REGISTRY_URL');
const username = process.env.MAM_ADMIN_USER ?? 'admin';
const password = process.env.MAM_ADMIN_PASSWORD ?? required('MAM_ADMIN_PASSWORD');

function required(name) {
  throw new Error(`${name} is required`);
}

const client = new RegistryClient({ baseUrl, timeout: 30000, retries: 1 });

// Login through the client's own auth surface, so this exercises the real path.
const loginRes = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
const { token } = await loginRes.json();
client.setAuthToken(token);

const examplesDir = join(root, 'modules', 'examples');
const types = readdirSync(examplesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => !['core', 'basic', 'advanced', 'plugins', 'security-system'].includes(n))
  .sort();

let published = 0;
let skipped = 0;
for (const type of types) {
  const file = join(examplesDir, type, `${type}.mam`);
  if (!existsSync(file)) {
    console.log(`skip ${type}: no ${type}.mam`);
    skipped++;
    continue;
  }
  const content = readFileSync(file, 'utf-8');
  // parseMAM returns { ast, errors, warnings, stats } — the module is .ast.
  const { ast, errors } = parseMAM(content, { source: file });
  if (errors.length > 0) {
    console.log(`skip ${type}: ${errors.length} parse error(s)`);
    skipped++;
    continue;
  }
  const fm = ast.frontmatter?.data;
  if (!fm?.id || !fm?.version) {
    console.log(`skip ${type}: missing id/version in frontmatter`);
    skipped++;
    continue;
  }
  try {
    const res = await client.publishModule({
      name: fm.id,
      version: fm.version,
      description: fm.description ?? '',
      author: fm.author ?? 'MAM Team',
      tags: fm.tags ?? [type, 'example'],
      files: { [`${type}.mam`]: content },
    });
    console.log(`ok ${res.name}@${res.version}`);
    published++;
  } catch (e) {
    console.log(`FAIL ${type}: ${e.message}`);
  }
}
console.log(`\ndone: ${published} published, ${skipped} skipped`);
