/**
 * MAM Memory Command
 *
 * Production-grade management of the MAM working memory. This module wraps the
 * {@link @mam/memory-engine!ShortTermRuntimeAdapter} produced by
 * `createWorkingMemory` and exposes five sub-actions through a single
 * `memoryCommand` entry point:
 *
 * - `add`    — persist a new working-memory entry under a key (or a
 *   content-derived key) with an optional TTL and tags.
 * - `get`    — read a single entry by key, including its bookkeeping
 *   (age, access count, tags, TTL).
 * - `list`   — enumerate every live entry in the working set.
 * - `clear`  — wipe the working memory and report what was discarded.
 * - `search` — full-text, scored retrieval over the indexed working set.
 *
 * Entries inherit a sliding 24-hour TTL by default, so actively-read facts
 * stay alive while stale ones decay and are reclaimed by the automatic prune
 * lifecycle. All output is rendered with `chalk` for a human-readable report;
 * pass `--json` to emit a machine-readable payload instead.
 *
 * The command intentionally constructs the memory adapter directly (rather
 * than requiring a long-lived server) so it is safe to run as a one-shot CLI
 * invocation: entries live for the lifetime of the process and are useful for
 * scripting, sandboxed agent runs, and CI pipelines.
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { createWorkingMemory } from '@mam/memory-engine';
import type {
  ScoredEntry,
  SearchResult,
  ShortTermEntry,
  ShortTermRuntimeAdapter,
  ShortTermStats,
} from '@mam/memory-engine';

// ============================================================================
// Types
// ============================================================================

/**
 * The supported working-memory sub-actions.
 *
 * Each value maps to exactly one branch inside {@link memoryCommand}. The
 * type is intentionally a closed union so callers get exhaustive checking in
 * `switch` statements.
 */
export type MemoryAction = 'add' | 'get' | 'list' | 'clear' | 'search';

/**
 * Options accepted by {@link memoryCommand}.
 *
 * Most fields are optional because each sub-action uses a different subset:
 * `add` needs `content` (and optionally `key`/`ttlDays`/`tags`), `get` needs
 * `key`, and `search` needs `query`. `parseArgs` can produce a partial version
 * of this shape from a raw argument vector.
 */
export interface MemoryOptions {
  /** Which sub-action to execute. Required — the command refuses to guess. */
  action: MemoryAction;
  /** Content to store when `action` is `add`. Ignored otherwise. */
  content?: string;
  /** Key to read (`get`) or write (`add`) under. */
  key?: string;
  /** Full-text query used by the `search` action. */
  query?: string;
  /** TTL in days for newly added entries. Defaults to 1 day. */
  ttlDays?: number;
  /** Maximum number of entries/results rendered. Defaults to 50. */
  limit?: number;
  /** Emit JSON instead of a human-readable report. */
  json?: boolean;
  /** Comma-separated tags attached to an `add` entry. */
  tags?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default TTL applied to every new entry (24 hours). */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Default maximum number of entries the working set may hold. */
const DEFAULT_MAX_ENTRIES = 1000;

/** Cadence of the automatic prune lifecycle (milliseconds). */
const PRUNE_INTERVAL_MS = 30_000;

/** Default result cap used by `list` and `search` rendering. */
const DEFAULT_LIMIT = 50;

/** Longest inline value rendered before it is truncated. */
const MAX_INLINE_VALUE = 200;

// ============================================================================
// Argument Parsing
// ============================================================================

/**
 * Test whether an unknown string names a valid {@link MemoryAction}.
 *
 * Acts as a type guard so callers can narrow `string` to `MemoryAction`
 * without casting.
 *
 * @param value - the raw string to test
 * @returns `true` when `value` is one of the five known actions
 */
export function isMemoryAction(value: string): value is MemoryAction {
  return value === 'add' || value === 'get' || value === 'list' ||
    value === 'clear' || value === 'search';
}

/**
 * Apply a single `--flag=value` (or `--flag value`) pair to an options bag.
 *
 * Unknown flags are ignored silently so the parser stays tolerant of shared
 * CLI plumbing (help, version, etc.) that this command does not own.
 *
 * @param options - the partial options object being built
 * @param flag - the flag name without the leading dashes
 * @param value - the flag value, or `'true'` for bare boolean flags
 */
function applyFlag(
  options: Partial<MemoryOptions>,
  flag: string,
  value: string,
): void {
  switch (flag) {
    case 'action':
      if (isMemoryAction(value)) options.action = value;
      break;
    case 'content':
      options.content = value;
      break;
    case 'key':
      options.key = value;
      break;
    case 'query':
      options.query = value;
      break;
    case 'ttl-days':
    case 'ttl':
      options.ttlDays = Number(value);
      break;
    case 'limit':
      options.limit = Number(value);
      break;
    case 'json':
      options.json = value !== 'false';
      break;
    case 'tags':
      options.tags = value;
      break;
    default:
      break;
  }
}

/**
 * Parse a raw argument vector into a partial {@link MemoryOptions}.
 *
 * Accepts `--flag=value`, `--flag value`, and bare boolean flags. The first
 * positional argument is treated as the `action` when it names a known
 * action, and the second positional argument is treated as the `key`. This
 * makes invocation ergonomic both ways:
 *
 * ```text
 * mam memory --action add --content "hello" --key greeting
 * mam memory add --key greeting --content hello
 * mam memory list --json
 * ```
 *
 * @param argv - the argument vector (e.g. `process.argv.slice(2)`)
 * @returns a partial options object; every field is optional
 */
export function parseArgs(argv: string[]): Partial<MemoryOptions> {
  const options: Partial<MemoryOptions> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        applyFlag(options, body.slice(0, eq), body.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          applyFlag(options, body, next);
          i++;
        } else {
          applyFlag(options, body, 'true');
        }
      }
    } else {
      positional.push(arg);
    }
  }

  if (options.action === undefined && positional.length > 0) {
    const candidate = positional.shift() ?? '';
    if (isMemoryAction(candidate)) {
      options.action = candidate;
    }
  }

  if (options.key === undefined && positional.length > 0) {
    options.key = positional.shift();
  }

  return options;
}

// ============================================================================
// Option Helpers
// ============================================================================

/**
 * Convert a day-count TTL into milliseconds.
 *
 * Returns `undefined` when no (or an invalid) TTL is supplied, mirroring the
 * memory engine's convention that `undefined` means "no expiry".
 *
 * @param ttlDays - the TTL in days, or `undefined`
 * @returns the TTL in milliseconds, or `undefined` when unset or invalid
 */
export function resolveTtl(ttlDays?: number): number | undefined {
  if (ttlDays === undefined || !Number.isFinite(ttlDays) || ttlDays <= 0) {
    return undefined;
  }
  return Math.floor(ttlDays * 24 * 60 * 60 * 1000);
}

/**
 * Derive a stable-ish, human-readable key from content.
 *
 * Uses the first four words of the content slugified and suffixed with a
 * base-36 timestamp so repeated calls with the same content still produce
 * distinct keys.
 *
 * @param content - the content to derive a key from
 * @returns a key string safe for use as a store id
 */
export function keyForContent(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const slug = words.slice(0, 4).join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 48);
  const stamp = Date.now().toString(36);
  return slug ? `${slug}-${stamp}` : `note-${stamp}`;
}

/**
 * Split a comma-separated tag string into a trimmed, deduplicated array.
 *
 * @param raw - the raw comma-separated tags, or `undefined`
 * @returns a de-duplicated array of trimmed tags
 */
export function parseTags(raw?: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw.split(',')) {
    const trimmed = tag.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

// ============================================================================
// Rendering Helpers
// ============================================================================

/**
 * Serialise an arbitrary stored value to a displayable string.
 *
 * Objects and arrays are JSON-stringified; primitives are stringified
 * directly; un-serialisable values fall back to `String()`.
 *
 * @param value - the value to stringify
 * @returns a single-line string representation
 */
export function stringifyValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Truncate a string to `max` characters, appending an ellipsis.
 *
 * @param text - the text to truncate
 * @param max - maximum length before truncation (default 200)
 * @returns the (possibly truncated) text
 */
export function truncate(text: string, max: number = MAX_INLINE_VALUE): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Format a millisecond duration as a compact, human-readable age.
 *
 * Produces values like `42s`, `7m`, `3h`, or `2d`.
 *
 * @param ms - the duration in milliseconds
 * @returns a compact age string
 */
export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Format a byte count as a human-readable size.
 *
 * @param bytes - the byte count to format
 * @returns a size string such as `512 B`, `12.3 KB` or `1.4 MB`
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Render a single {@link ShortTermEntry} as a coloured, single-line summary.
 *
 * Shows the entry id (bold), a truncated preview of the value, the age, any
 * tags, and the access count. An optional 1-based index is prepended so the
 * output works well inside lists.
 *
 * @param entry - the entry to render
 * @param index - optional 1-based position in a list
 * @returns the rendered line
 */
export function formatEntry(entry: ShortTermEntry, index?: number): string {
  const prefix = index === undefined ? '' : chalk.gray(`${index}. `);
  const id = chalk.bold(entry.id);
  const value = truncate(stringifyValue(entry.value));
  const age = chalk.gray(`(age ${formatAge(Date.now() - entry.createdAt)})`);
  const tags =
    entry.tags && entry.tags.length > 0
      ? chalk.blue(`[${entry.tags.join(', ')}]`)
      : '';
  const access = chalk.gray(`· ${entry.accessCount}×`);
  return `${prefix}${id} ${chalk.white(value)} ${age} ${tags} ${access}`.replace(/\s+/g, ' ');
}

/**
 * Render a scored retrieval hit as a ranked line.
 *
 * Prepends the 1-based rank and the match score (as a percentage) to the
 * entry summary produced by {@link formatEntry}.
 *
 * @param scored - the scored entry to render
 * @param index - the 1-based rank
 * @returns the rendered line
 */
export function formatScoredEntry(scored: ScoredEntry, index: number): string {
  const rank = chalk.gray(`${String(index).padStart(2)}. `);
  const score = chalk.magenta(`${(scored.score * 100).toFixed(1).padStart(6)}%`);
  return `${rank}${score} ${formatEntry(scored.entry)}`;
}

/**
 * Render a list of entries as a human-readable report.
 *
 * @param entries - the entries to render, in display order
 * @returns the rendered report; a friendly message when empty
 */
export function renderMemoryList(entries: ShortTermEntry[]): string {
  if (entries.length === 0) {
    return chalk.yellow('No entries in working memory.');
  }
  const lines: string[] = [];
  entries.forEach((entry, i) => lines.push(formatEntry(entry, i + 1)));
  return lines.join('\n');
}

/**
 * Render a {@link SearchResult} as a human-readable report.
 *
 * Includes the normalised query, the total match count, and each ranked hit
 * via {@link formatScoredEntry}.
 *
 * @param result - the search result to render
 * @returns the rendered report
 */
export function renderSearchResult(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(
    chalk.cyan(`Search "${result.query}" — ${result.total} match(es)`),
  );
  result.results.forEach((scored, i) => {
    lines.push(formatScoredEntry(scored, i + 1));
  });
  if (result.results.length === 0) {
    lines.push(chalk.yellow('  No matches.'));
  }
  return lines.join('\n');
}

/**
 * Render store {@link ShortTermStats} as a human-readable report.
 *
 * @param stats - the statistics to render
 * @returns the rendered report
 */
export function renderStats(stats: ShortTermStats): string {
  const lines: string[] = [];
  lines.push(chalk.cyan('Working memory statistics'));
  lines.push(chalk.gray(`  Entries: ${stats.totalEntries}`));
  lines.push(chalk.gray(`  Estimated size: ${formatBytes(stats.totalBytesEstimate)}`));
  lines.push(chalk.gray(`  Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`));
  lines.push(chalk.gray(`  Evictions: ${stats.evictions}`));
  lines.push(chalk.gray(`  TTL expirations: ${stats.ttlExpirations}`));
  if (stats.oldestTs !== null) {
    lines.push(chalk.gray(`  Oldest: ${new Date(stats.oldestTs).toISOString()}`));
  }
  if (stats.newestTs !== null) {
    lines.push(chalk.gray(`  Newest: ${new Date(stats.newestTs).toISOString()}`));
  }
  return lines.join('\n');
}

/**
 * Print a payload as pretty-printed JSON.
 *
 * @param payload - the value to serialise
 */
function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Execute the `add` action.
 *
 * Stores `options.content` under `options.key` (or a content-derived key when
 * absent) with the resolved TTL and parsed tags, then prints the canonical
 * stored entry. JSON mode emits the entry object.
 *
 * @param memory - the working-memory adapter
 * @param options - the parsed command options
 * @param spinner - the active ora spinner used for progress feedback
 */
async function handleAdd(
  memory: ShortTermRuntimeAdapter,
  options: MemoryOptions,
  spinner: Ora,
): Promise<void> {
  const content = options.content?.trim() ?? '';
  if (!content) {
    spinner.fail('Nothing to store: pass --content.');
    process.exit(1);
  }

  const key = options.key?.trim() || keyForContent(content);
  const ttlMs = resolveTtl(options.ttlDays);
  const tags = parseTags(options.tags);

  spinner.text = `Storing "${truncate(content, 60)}"...`;
  await memory.set(key, content, { ttlMs, tags: tags.length > 0 ? tags : undefined });

  const entry = await memory.peek(key);
  if (!entry) {
    spinner.fail(`Entry "${key}" was not retained (possibly expired or evicted).`);
    process.exit(1);
  }

  spinner.succeed(`Stored ${chalk.bold(key)}`);
  if (options.json) {
    printJson({ key, entry });
    return;
  }
  console.log(formatEntry(entry));
  console.log(chalk.gray(`  TTL: ${ttlMs !== undefined ? formatAge(ttlMs) : 'none'}`));
}

/**
 * Execute the `get` action.
 *
 * Reads a single entry by key using a non-mutating `peek` so the lookup does
 * not refresh a sliding TTL. Prints the entry summary plus its value; JSON
 * mode emits the full entry record.
 *
 * @param memory - the working-memory adapter
 * @param options - the parsed command options
 * @param spinner - the active ora spinner used for progress feedback
 */
async function handleGet(
  memory: ShortTermRuntimeAdapter,
  options: MemoryOptions,
  spinner: Ora,
): Promise<void> {
  const key = options.key?.trim() ?? '';
  if (!key) {
    spinner.fail('get requires --key.');
    process.exit(1);
  }

  const entry = await memory.peek(key);
  if (!entry) {
    spinner.fail(`No entry found for key "${key}".`);
    process.exit(1);
  }

  spinner.succeed(`Entry "${key}"`);
  if (options.json) {
    printJson({ key, entry });
    return;
  }
  console.log(formatEntry(entry));
  console.log(chalk.white(`  Value: ${stringifyValue(entry.value)}`));
  if (entry.metadata) {
    console.log(chalk.gray(`  Metadata: ${JSON.stringify(entry.metadata)}`));
  }
}

/**
 * Execute the `list` action.
 *
 * Enumerates every live key, peeks each entry (non-mutating), and renders the
 * result newest-first. JSON mode emits the raw entry array.
 *
 * @param memory - the working-memory adapter
 * @param options - the parsed command options
 * @param spinner - the active ora spinner used for progress feedback
 */
async function handleList(
  memory: ShortTermRuntimeAdapter,
  options: MemoryOptions,
  spinner: Ora,
): Promise<void> {
  const keys = await memory.keys();
  const entries: ShortTermEntry[] = [];
  for (const key of keys) {
    const entry = await memory.peek(key);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => b.createdAt - a.createdAt);

  const limit = options.limit ?? DEFAULT_LIMIT;
  const visible = entries.slice(0, limit);

  spinner.succeed(`${entries.length} entrie(s) in working memory`);
  if (options.json) {
    printJson({ total: entries.length, entries: visible });
    return;
  }
  console.log(renderMemoryList(visible));
  if (entries.length > visible.length) {
    console.log(chalk.gray(`  … ${entries.length - visible.length} more (use --limit to show more)`));
  }
}

/**
 * Execute the `clear` action.
 *
 * Captures a pre-clear snapshot of statistics, wipes the store, and reports
 * how many entries were discarded. JSON mode emits the discarded count and
 * the before/after stats.
 *
 * @param memory - the working-memory adapter
 * @param options - the parsed command options
 * @param spinner - the active ora spinner used for progress feedback
 */
async function handleClear(
  memory: ShortTermRuntimeAdapter,
  options: MemoryOptions,
  spinner: Ora,
): Promise<void> {
  const before = await memory.stats();
  const discarded = before.totalEntries;
  await memory.clear();
  const after = await memory.stats();

  spinner.succeed(`Cleared ${discarded} entrie(s) from working memory`);
  if (options.json) {
    printJson({ discarded, before, after });
    return;
  }
  console.log(chalk.gray(`  Remaining: ${after.totalEntries}`));
}

/**
 * Execute the `search` action.
 *
 * Runs scored full-text retrieval over the indexed working set and renders
 * the ranked hits. JSON mode emits the raw {@link SearchResult}.
 *
 * @param memory - the working-memory adapter
 * @param options - the parsed command options
 * @param spinner - the active ora spinner used for progress feedback
 */
async function handleSearch(
  memory: ShortTermRuntimeAdapter,
  options: MemoryOptions,
  spinner: Ora,
): Promise<void> {
  const query = options.query?.trim() ?? '';
  if (!query) {
    spinner.fail('search requires --query.');
    process.exit(1);
  }

  const result = await memory.search(query, { limit: options.limit ?? DEFAULT_LIMIT });

  spinner.succeed(`Search "${query}"`);
  if (options.json) {
    printJson(result);
    return;
  }
  console.log(renderSearchResult(result));
}

// ============================================================================
// Command Entry Point
// ============================================================================

/**
 * Run the MAM working-memory command.
 *
 * Constructs a fresh, bounded working-memory adapter (24h sliding TTL, 1000
 * entry cap, 30s prune cadence) and dispatches to the action-specific handler
 * selected by `options.action`. Errors are surfaced through the spinner and
 * exit with a non-zero status.
 *
 * @param options - the parsed command options
 * @returns a promise that resolves when the command completes
 */
export async function memoryCommand(options: MemoryOptions): Promise<void> {
  const spinner = ora(`Memory: ${options.action}...`).start();

  try {
    const memory = createWorkingMemory(DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES, PRUNE_INTERVAL_MS);

    switch (options.action) {
      case 'add':
        await handleAdd(memory, options, spinner);
        break;
      case 'get':
        await handleGet(memory, options, spinner);
        break;
      case 'list':
        await handleList(memory, options, spinner);
        break;
      case 'clear':
        await handleClear(memory, options, spinner);
        break;
      case 'search':
        await handleSearch(memory, options, spinner);
        break;
      default:
        spinner.fail(`Unknown action: ${String(options.action)}`);
        process.exit(1);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}