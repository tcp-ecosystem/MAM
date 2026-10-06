/**
 * MAM Version Constants
 *
 * Single source of truth for the MAM language version.
 *
 * Every package that stamps a default version onto a module, manifest, project
 * or generated artefact imports `MAM_VERSION` from here instead of hardcoding a
 * literal. That keeps `mam version`, the parser default, the CLI scaffolding and
 * the compiler output in agreement.
 *
 * MAM is currently at **2.0.0**. v1 modules are still readable — use
 * {@link isLegacyMamVersion} to detect them so `mam migrate` can upgrade them.
 *
 * @module constants/version
 */

/**
 * The current MAM language version.
 *
 * Used as the default for `version` / `mam_version` in frontmatter, project
 * manifests and compiler-emitted code.
 */
export const MAM_VERSION = '2.0.0';

/**
 * The previous (v1) MAM language version, kept for migration tooling.
 */
export const MAM_LEGACY_VERSION = '1.0.0';

/** Major version of the current MAM release. */
export const MAM_MAJOR_VERSION = 2;

/**
 * Schema version written into serialised MAM payloads.
 *
 * Distinct from {@link MAM_VERSION}: this tracks the serialisation envelope,
 * not the language itself.
 */
export const MAM_SCHEMA_VERSION = '2';

/**
 * A semantic-version range meaning "any MAM 2.x module".
 *
 * Useful in generated manifests that must accept patch-level variations.
 */
export const MAM_VERSION_RANGE = '>=2.0.0';

/**
 * Whether a version string predates the current major version.
 *
 * @param version - a dotted version string, with or without a leading `v`.
 * @returns `true` for v1 (or older) versions, `false` for current/newer.
 *
 * @example
 * ```ts
 * isLegacyMamVersion('1.4.0'); // true
 * isLegacyMamVersion('2.0.0'); // false
 * ```
 */
export function isLegacyMamVersion(version: string | undefined | null): boolean {
  if (!version) return false;
  const normalized = version.trim().replace(/^v/i, '');
  const major = Number.parseInt(normalized.split('.')[0] ?? '', 10);
  if (!Number.isFinite(major)) return false;
  return major < MAM_MAJOR_VERSION;
}

/**
 * Whether a version string belongs to the current MAM major version.
 *
 * @param version - a dotted version string, with or without a leading `v`.
 * @returns `true` when the major component matches {@link MAM_MAJOR_VERSION}.
 */
export function isCurrentMamVersion(version: string | undefined | null): boolean {
  if (!version) return false;
  const normalized = version.trim().replace(/^v/i, '');
  const major = Number.parseInt(normalized.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major === MAM_MAJOR_VERSION;
}

/**
 * Normalise a user-supplied version into a bare dotted string.
 *
 * Strips a leading `v` and surrounding whitespace; returns {@link MAM_VERSION}
 * when the input is empty.
 *
 * @param version - raw version input.
 * @returns a normalised dotted version.
 */
export function normalizeMamVersion(version: string | undefined | null): string {
  const normalized = (version ?? '').trim().replace(/^v/i, '');
  return normalized.length > 0 ? normalized : MAM_VERSION;
}
