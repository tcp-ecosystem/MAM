#!/usr/bin/env node
/**
 * Copy the canonical `.mam.md` templates into `dist/` after `tsc`.
 *
 * `tsc` only emits JavaScript, so runtime assets have to be copied explicitly.
 * The CLI reads templates relative to `import.meta.url`, which resolves to
 * `src/` under vitest and `dist/` in a published package. Keeping both layouts
 * identical means `mam init` behaves the same in tests and in production.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const source = join(root, 'src', 'templates');
const target = join(root, 'dist', 'templates');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`templates copied to ${target}`);
