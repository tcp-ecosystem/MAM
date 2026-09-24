/**
 * MAM Semver Utilities
 *
 * Version parsing, comparison, coercion, and range matching helpers.
 */

// ============================================================================
// Types
// ============================================================================

export interface ParsedVersion {
  /** Major version number */
  major: number;
  /** Minor version number */
  minor: number;
  /** Patch version number */
  patch: number;
  /** Prerelease identifiers (e.g. "alpha.1") */
  prerelease?: string;
  /** Build metadata (e.g. "build.5") */
  build?: string;
}

interface RangeParts {
  major: number;
  minor?: number;
  patch?: number;
  prerelease?: string;
  build?: string;
}

// ============================================================================
// Constants
// ============================================================================

const VERSION_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const PARTIAL_RE =
  /^v?(\d+)(?:\.([xX*]|\d+))?(?:\.([xX*]|\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const OP_RE = /^(\^|~|>=|<=|>|<|=)?(.*)$/;

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a semver version string into its numeric and textual components.
 *
 * Accepts optional leading "v" (e.g. "v1.2.3"). Returns `null` when the value
 * is not a valid full semver (major.minor.patch). Use {@link coerceVersion} to
 * salvage partial versions.
 *
 * @param version - The version string to parse.
 * @returns A parsed version, or `null` if the string is not valid semver.
 */
export function parseVersion(version: string): ParsedVersion | null {
  if (typeof version !== 'string') {
    return null;
  }

  const m = VERSION_RE.exec(version.trim());

  if (!m) {
    return null;
  }

  const result: ParsedVersion = {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };

  if (m[4] !== undefined) {
    result.prerelease = m[4];
  }

  if (m[5] !== undefined) {
    result.build = m[5];
  }

  return result;
}

/**
 * Check whether a value is a valid full semver version string.
 *
 * @param version - The value to check.
 * @returns `true` when the value parses as a full semver version.
 */
export function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null;
}

/**
 * Compare two version strings using semver precedence rules.
 *
 * Returns a negative number when `a` sorts before `b`, zero when they are
 * equal, and a positive number when `a` sorts after `b`. Invalid versions
 * sort before all valid versions. Build metadata is ignored for precedence.
 *
 * @param a - First version string.
 * @param b - Second version string.
 * @returns The comparison result (-1, 0, or 1).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  if (!pa && !pb) {
    return 0;
  }

  if (!pa) {
    return -1;
  }

  if (!pb) {
    return 1;
  }

  if (pa.major !== pb.major) {
    return pa.major - pb.major;
  }

  if (pa.minor !== pb.minor) {
    return pa.minor - pb.minor;
  }

  if (pa.patch !== pb.patch) {
    return pa.patch - pb.patch;
  }

  // A release (no prerelease) sorts higher than a prerelease.
  if (pa.prerelease === undefined && pb.prerelease === undefined) {
    return 0;
  }

  if (pa.prerelease === undefined) {
    return 1;
  }

  if (pb.prerelease === undefined) {
    return -1;
  }

  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * Attempt to coerce a loose, partial, or prefixed value into a canonical
 * semver string. Missing minor/patch components default to zero.
 *
 * Examples: "1.2" -> "1.2.0", "v1.2.3.4" -> "1.2.3", "1" -> "1.0.0".
 *
 * @param value - The value to coerce.
 * @returns The coerced semver string, or `null` when no version can be found.
 */
export function coerceVersion(value: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const m =
    /^[v=\s]*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?/.exec(
      value.trim()
    );

  if (!m) {
    return null;
  }

  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  const patch = m[3] !== undefined ? Number(m[3]) : 0;

  let version = `${major}.${minor}.${patch}`;

  if (m[4]) {
    version += `-${m[4]}`;
  }

  if (m[5]) {
    version += `+${m[5]}`;
  }

  return version;
}

// ============================================================================
// Range Matching
// ============================================================================

/**
 * Check whether a version satisfies a semver range expression.
 *
 * Supports exact versions, caret (`^1.2.3`), tilde (`~1.2.3`), comparison
 * operators (`>=`, `<=`, `>`, `<`, `=`), x-ranges (`1.x`, `1.2.x`), `*`
 * wildcards, whitespace-separated AND constraints, and `||` OR groups.
 *
 * @param version - The version to test.
 * @param range - The range expression to test against.
 * @returns `true` when the version satisfies the range.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);

  if (!parsed) {
    return false;
  }

  const trimmed = (range ?? '').trim();

  if (trimmed === '' || trimmed === '*' || trimmed === 'x' || trimmed === 'X' || trimmed === 'latest') {
    return true;
  }

  const groups = trimmed.split(/\s*\|\|\s*/);

  for (const group of groups) {
    const tokens = group.trim().split(/[\s,]+/).filter(Boolean);
    let ok = true;

    for (const token of tokens) {
      if (!evalComparator(parsed, token)) {
        ok = false;
        break;
      }
    }

    if (ok) {
      return true;
    }
  }

  return false;
}

/**
 * Determine whether a value looks like a version range rather than a plain
 * version. Partial versions such as "1.2" or "1" are treated as ranges.
 *
 * @param value - The value to inspect.
 * @returns `true` when the value uses range syntax.
 */
export function isVersionRange(value: string): boolean {
  const trimmed = (value ?? '').trim();

  if (trimmed === '') {
    return false;
  }

  if (isValidVersion(trimmed)) {
    return false;
  }

  if (/^v?\d+$/.test(trimmed) || /^v?\d+\.\d+$/.test(trimmed)) {
    return true;
  }

  return /[\^~><=\*\s|,xX]/.test(trimmed);
}

/**
 * Validate the syntax of a version range expression without testing it against
 * a specific version.
 *
 * @param range - The range expression to validate.
 * @returns `true` when the range is syntactically valid.
 */
export function isValidRange(range: string): boolean {
  const trimmed = (range ?? '').trim();

  if (trimmed === '' || trimmed === '*') {
    return true;
  }

  const groups = trimmed.split(/\s*\|\|\s*/);

  for (const group of groups) {
    const tokens = group.trim().split(/[\s,]+/).filter(Boolean);

    if (tokens.length === 0) {
      continue;
    }

    for (const token of tokens) {
      if (!isValidComparator(token)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Find the highest version from a list that satisfies a given range.
 *
 * @param versions - List of version strings to consider.
 * @param range - The range expression to match against.
 * @returns The highest matching version, or `undefined` when none match.
 */
export function maxSatisfying(versions: string[], range: string): string | undefined {
  const matching = versions.filter(v => satisfiesRange(v, range));

  if (matching.length === 0) {
    return undefined;
  }

  matching.sort((a, b) => compareVersions(b, a));

  return matching[0];
}

// ============================================================================
// Internal Helpers
// ============================================================================

function comparePrerelease(a: string, b: string): number {
  const aParts = a.split('.');
  const bParts = b.split('.');
  const length = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < length; i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];

    if (aPart === undefined && bPart === undefined) {
      return 0;
    }

    if (aPart === undefined) {
      return -1;
    }

    if (bPart === undefined) {
      return 1;
    }

    const aNum = /^\d+$/.test(aPart) ? Number(aPart) : undefined;
    const bNum = /^\d+$/.test(bPart) ? Number(bPart) : undefined;

    if (aNum !== undefined && bNum !== undefined) {
      if (aNum !== bNum) {
        return aNum - bNum;
      }
    } else if (aNum !== undefined) {
      // Numeric identifiers always sort lower than alphanumeric ones.
      return -1;
    } else if (bNum !== undefined) {
      return 1;
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }

  return 0;
}

function parseRangeParts(value: string): RangeParts | null {
  const m = PARTIAL_RE.exec(value.trim());

  if (!m) {
    return null;
  }

  const toNum = (s: string | undefined): number | undefined => {
    if (s === undefined || s === 'x' || s === 'X' || s === '*') {
      return undefined;
    }

    return Number(s);
  };

  const result: RangeParts = {
    major: Number(m[1]),
    minor: toNum(m[2]),
    patch: toNum(m[3]),
  };

  if (m[4] !== undefined) {
    result.prerelease = m[4];
  }

  if (m[5] !== undefined) {
    result.build = m[5];
  }

  return result;
}

function partsToString(parts: RangeParts): string {
  const major = parts.major;
  const minor = parts.minor ?? 0;
  const patch = parts.patch ?? 0;

  let s = `${major}.${minor}.${patch}`;

  if (parts.prerelease) {
    s += `-${parts.prerelease}`;
  }

  if (parts.build) {
    s += `+${parts.build}`;
  }

  return s;
}

function pvToString(parsed: ParsedVersion): string {
  let s = `${parsed.major}.${parsed.minor}.${parsed.patch}`;

  if (parsed.prerelease) {
    s += `-${parsed.prerelease}`;
  }

  if (parsed.build) {
    s += `+${parsed.build}`;
  }

  return s;
}

function bump(parts: RangeParts): RangeParts {
  if (parts.minor !== undefined) {
    return { major: parts.major, minor: parts.minor + 1, patch: 0 };
  }

  return { major: parts.major + 1, minor: 0, patch: 0 };
}

function isValidComparator(token: string): boolean {
  const t = token.trim();

  if (t === '' || t === '*' || t === 'x' || t === 'X' || t === 'latest') {
    return true;
  }

  const m = OP_RE.exec(t);
  const rest = (m?.[2] ?? t).trim();

  return parseRangeParts(rest) !== null;
}

function evalComparator(parsed: ParsedVersion, token: string): boolean {
  const t = token.trim();

  if (t === '') {
    return true;
  }

  if (t === '*' || t === 'x' || t === 'X') {
    return true;
  }

  const m = OP_RE.exec(t);
  const op = m?.[1] ?? '';
  const rest = (m?.[2] ?? t).trim();
  const parts = parseRangeParts(rest);

  if (!parts) {
    return false;
  }

  // Prerelease gating: prerelease versions only match ranges that include a
  // prerelease on the same major.minor.patch base.
  if (parsed.prerelease !== undefined) {
    if (parts.prerelease === undefined) {
      return false;
    }

    if (
      parts.major !== parsed.major ||
      (parts.minor ?? parsed.minor) !== parsed.minor ||
      (parts.patch ?? parsed.patch) !== parsed.patch
    ) {
      return false;
    }
  }

  const versionStr = pvToString(parsed);
  const target = partsToString(parts);

  switch (op) {
    case '^': {
      let upper: RangeParts;

      if (parts.major > 0) {
        upper = { major: parts.major + 1, minor: 0, patch: 0 };
      } else if ((parts.minor ?? 0) > 0) {
        upper = { major: 0, minor: (parts.minor ?? 0) + 1, patch: 0 };
      } else {
        upper = { major: 0, minor: 0, patch: (parts.patch ?? 0) + 1 };
      }

      return (
        compareVersions(versionStr, target) >= 0 &&
        compareVersions(versionStr, partsToString(upper)) < 0
      );
    }

    case '~': {
      const upper: RangeParts =
        parts.minor !== undefined
          ? { major: parts.major, minor: parts.minor + 1, patch: 0 }
          : { major: parts.major + 1, minor: 0, patch: 0 };

      return (
        compareVersions(versionStr, target) >= 0 &&
        compareVersions(versionStr, partsToString(upper)) < 0
      );
    }

    case '>=':
      return compareVersions(versionStr, target) >= 0;

    case '>': {
      if (parts.minor !== undefined && parts.patch !== undefined) {
        return compareVersions(versionStr, target) > 0;
      }

      // npm semantics: ">1.2" behaves as ">=1.3.0".
      return compareVersions(versionStr, partsToString(bump(parts))) >= 0;
    }

    case '<=': {
      if (parts.minor !== undefined && parts.patch !== undefined) {
        return compareVersions(versionStr, target) <= 0;
      }

      // npm semantics: "<=1.2" behaves as "<1.3.0".
      return compareVersions(versionStr, partsToString(bump(parts))) < 0;
    }

    case '<':
      return compareVersions(versionStr, target) < 0;

    case '=':
    case '': {
      if (parts.minor === undefined || parts.patch === undefined) {
        // Bare x-ranges: "1.x" and "1.2.x" become floor-to-next ranges.
        const upper: RangeParts =
          parts.minor === undefined
            ? { major: parts.major + 1, minor: 0, patch: 0 }
            : { major: parts.major, minor: parts.minor + 1, patch: 0 };

        return (
          compareVersions(versionStr, target) >= 0 &&
          compareVersions(versionStr, partsToString(upper)) < 0
        );
      }

      return compareVersions(versionStr, target) === 0;
    }

    default:
      return false;
  }
}