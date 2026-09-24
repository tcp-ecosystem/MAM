/**
 * MAM Git Spec Helpers
 *
 * Detection and parsing of git-based package specifications.
 */

// ============================================================================
// Types
// ============================================================================

export interface GitUrlInfo {
  /** Repository URL or SSH path */
  repo: string;
  /** Git ref (branch, tag, or commit) */
  ref?: string;
  /** Sub-directory path within the repository */
  path?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Protocol schemes that identify a git URL. */
export const GIT_PROTOCOLS: readonly string[] = [
  'git',
  'ssh',
  'https',
  'http',
  'git+ssh',
  'git+https',
  'git+http',
  'git+file',
];

// ============================================================================
// Functions
// ============================================================================

/**
 * Check whether a value looks like a git URL.
 *
 * Recognizes `git:` / `git+<proto>:` prefixes, `ssh://` and `git://` URLs,
 * `git@host:path` SSH shorthand, and URLs ending in `.git`.
 *
 * @param value - The value to inspect.
 * @returns `true` when the value is a git URL.
 */
export function isGitUrl(value: string): boolean {
  const v = (value ?? '').trim();

  if (!v) {
    return false;
  }

  if (v.startsWith('git@')) {
    return true;
  }

  if (/^git(\+[a-z]+)?:(\/\/|)/.test(v)) {
    return true;
  }

  if (v.startsWith('ssh://') || v.startsWith('git://')) {
    return true;
  }

  if (/^https?:\/\//.test(v) && /\.git(\/|#|$)/.test(v)) {
    return true;
  }

  if (v.endsWith('.git')) {
    return true;
  }

  return false;
}

/**
 * Parse a git URL into its repository, ref, and sub-directory components.
 *
 * Handles `git:` / `git+<proto>:` prefixes, standard schemes, and SSH
 * shorthand. Ref and path are read from the `#` fragment using the forms
 * `#ref` and `#path:ref`.
 *
 * @param url - The git URL to parse.
 * @returns The parsed components, or `null` when the URL is not a git URL.
 */
export function parseGitUrl(url: string): GitUrlInfo | null {
  const v = (url ?? '').trim();

  if (!v) {
    return null;
  }

  const rest = v.replace(/^git\+/, '').replace(/^git:/, '');

  if (!/^(?:[a-z][a-z0-9+.-]*:\/\/|git@)/i.test(rest)) {
    return null;
  }

  const hashIdx = rest.indexOf('#');
  const repo = (hashIdx >= 0 ? rest.slice(0, hashIdx) : rest).replace(/\/+$/, '');
  const fragment = hashIdx >= 0 ? rest.slice(hashIdx + 1) : '';

  let ref: string | undefined;
  let path: string | undefined;

  if (fragment) {
    const colonIdx = fragment.indexOf(':');

    if (colonIdx >= 0) {
      path = fragment.slice(0, colonIdx) || undefined;
      ref = fragment.slice(colonIdx + 1) || undefined;
    } else {
      ref = fragment;
    }
  }

  return { repo, ref, path };
}

/**
 * Extract the git ref (branch, tag, or commit) from a git URL.
 *
 * @param url - The git URL to inspect.
 * @returns The ref specified after `#`, or `undefined` when none is present.
 */
export function gitRef(url: string): string | undefined {
  return parseGitUrl(url)?.ref;
}