import { basename } from 'node:path';

/**
 * Accepted MAM document extensions.
 *
 * Ordered longest-first so `.mam.md` is stripped before `.mam`, otherwise a
 * `foo.mam.md` file would keep a trailing `.md`.
 */
export const MAM_EXTENSIONS = ['.mam.md', '.mam'] as const;

/** True when the given path is a MAM document. */
export function isMamFile(path: string): boolean {
  return MAM_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** The file's basename with any MAM extension removed. */
export function stripMamExtension(path: string): string {
  const base = basename(path);
  for (const ext of MAM_EXTENSIONS) {
    if (base.endsWith(ext)) return base.slice(0, -ext.length);
  }
  return base;
}