#!/usr/bin/env node
/**
 * MAM npm publish preflight
 *
 * Verifies everything that can go wrong before any package leaves the
 * machine. Publishes nothing. Safe to run as often as you like.
 *
 *   node tools/scripts/preflight-publish.mjs
 *   pnpm preflight:publish
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPE = '@mam';

const failures = [];
const warnings = [];

function ok(msg) {
  console.log(`  ok    ${msg}`);
}
function warn(msg) {
  warnings.push(msg);
  console.log(`  warn  ${msg}`);
}
function fail(msg) {
  failures.push(msg);
  console.log(`  FAIL  ${msg}`);
}

function run(cmd, args, opts = {}) {
  try {
    return {
      code: 0,
      out: execFileSync(cmd, args, {
        cwd: opts.cwd ?? root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      }),
    };
  } catch (err) {
    return {
      code: err.status ?? 1,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
}

function collectPackages() {
  const globs = fs
    .readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf-8')
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('- '))
    .map((l) => l.trim().replace(/^- /, '').replace(/^["']|["']$/g, ''));

  const dirs = new Set();
  for (const g of globs) {
    if (g.includes('*')) {
      const parent = g.replace(/\/\*$/, '');
      if (!fs.existsSync(path.join(root, parent))) continue;
      for (const d of fs.readdirSync(path.join(root, parent), { withFileTypes: true })) {
        if (d.isDirectory() && fs.existsSync(path.join(root, parent, d.name, 'package.json'))) {
          dirs.add(path.join(parent, d.name));
        }
      }
    } else if (fs.existsSync(path.join(root, g, 'package.json'))) {
      dirs.add(g);
    }
  }

  return [...dirs].sort();
}

// ---------------------------------------------------------------------------
console.log('\nMAM npm publish preflight\n');

// 1. Repository state
console.log('repository');
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
if (branch !== 'main') {
  warn(`on branch '${branch}', not 'main'`);
} else {
  ok('on main');
}

const dirty = run('git', ['status', '--porcelain']).out.trim();
if (dirty) {
  fail('working tree has uncommitted changes');
} else {
  ok('working tree clean');
}

const behind = run('git', ['rev-list', '--count', 'HEAD..origin/main']).out.trim();
if (behind && behind !== '0') {
  warn(`${behind} commit(s) behind origin/main, run: git pull --rebase`);
} else {
  ok('up to date with origin/main');
}

// 2. Authentication
console.log('\nauthentication');
const whoami = run('npm', ['whoami']);
if (whoami.code !== 0) {
  fail('not logged in to npm - run: npm login  (or set NPM_TOKEN)');
} else {
  ok(`logged in as ${whoami.out.trim()}`);
}

// npm refuses publishing to an org that enforces 2FA unless the request
// carries a granular access token with bypass-2FA enabled. An interactive
// `npm login` session is not enough, and the failure only surfaces as a 403
// part way through a publish, so surface it here instead.
if (!process.env.NPM_TOKEN) {
  warn(
    'NPM_TOKEN is not set. If the @mam org enforces 2FA, publishing will fail with ' +
      'E403 "Two-factor authentication or granular access token with bypass 2fa enabled is required". ' +
      'Create a granular access token (read/write packages, scope @mam, bypass 2FA) and set NPM_TOKEN.'
  );
}

// 3. Scope ownership
console.log(`\nscope ${SCOPE}`);
if (whoami.code === 0) {
  const org = run('npm', ['org', 'ls', SCOPE.replace('@', '')]);
  if (org.code !== 0) {
    fail(`you are not a member of the ${SCOPE} org - create it at https://www.npmjs.com/org/create`);
  } else {
    ok(`member of ${SCOPE}`);
  }
}

// 4. Package contents
console.log('\npackage contents');
const packages = collectPackages();
const publishable = [];

for (const dir of packages) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, 'package.json'), 'utf-8'));
  if (pkg.private === true) continue;

  const label = `${pkg.name}@${pkg.version}`;

  if (!fs.existsSync(path.join(root, dir, 'dist'))) {
    fail(`${label}: no dist/ - run: pnpm build`);
    continue;
  }
  if (!fs.existsSync(path.join(root, dir, 'LICENSE'))) {
    warn(`${label}: no LICENSE file in the package`);
  }
  if (!pkg.publishConfig?.access) {
    warn(`${label}: no publishConfig.access`);
  }
  if (pkg.bin) {
    for (const [cmdName, target] of Object.entries(pkg.bin)) {
      if (!fs.existsSync(path.join(root, dir, target))) {
        fail(`${label}: bin '${cmdName}' points at missing file ${target}`);
      } else if (target.startsWith('./')) {
        fail(`${label}: bin '${cmdName}' starts with './', npm will drop it`);
      }
    }
  }

  publishable.push({ dir, pkg });
}
ok(`${publishable.length} publishable package(s) checked`);

// 5. Already published?
console.log('\nregistry state');
if (whoami.code === 0) {
  for (const { pkg } of publishable) {
    const view = run('npm', ['view', `${pkg.name}@${pkg.version}`, 'version']);
    if (view.code === 0 && view.out.trim()) {
      fail(`${pkg.name}@${pkg.version} is already on npm - bump the version first`);
    }
  }
  ok('no version collisions detected');
} else {
  warn('skipped registry lookups (not logged in)');
}

// ---------------------------------------------------------------------------
console.log(`\n${'-'.repeat(60)}`);
if (failures.length) {
  console.log(`PREFLIGHT FAILED - ${failures.length} blocking issue(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else if (warnings.length) {
  console.log(`PREFLIGHT PASSED with ${warnings.length} warning(s).`);
  for (const w of warnings) console.log(`  - ${w}`);
} else {
  console.log('PREFLIGHT PASSED - ready to publish.');
}
console.log('\nPublish with:  pnpm changeset publish\n');