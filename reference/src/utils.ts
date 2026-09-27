/**
 * MAM Reference Implementation — Utilities
 *
 * Small helpers used across the CLI, compiler, package manager, and registry.
 */

import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir, access } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

// ============================================================================
// File System Helpers
// ============================================================================

/**
 * Read a file and return its contents as a UTF-8 string.
 */
export async function readFile(path: string): Promise<string> {
  return fsReadFile(resolve(path), 'utf-8');
}

/**
 * Write content to a file, creating parent directories as needed.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const dir = resolve(path, '..');
  await ensureDir(dir);
  await fsWriteFile(resolve(path), content, 'utf-8');
}

/**
 * Ensure a directory exists, creating it (recursively) if it doesn't.
 */
export async function ensureDir(path: string): Promise<void> {
  await mkdir(resolve(path), { recursive: true });
}

/**
 * Check whether a file or directory exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(resolve(path));
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Target Helpers
// ============================================================================

/** Map of compilation targets to their typical file extensions. */
const TARGET_EXTENSIONS: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  go: 'go',
  rust: 'rs',
  json: 'json',
  yaml: 'yaml',
  openai: 'py',
  langgraph: 'py',
  crewai: 'py',
  csharp: 'cs',
  java: 'java',
  wasm: 'wasm',
  gemini: 'py',
  autogen: 'py',
  kubernetes: 'yaml',
  terraform: 'tf',
};

/**
 * Return the file extension for a given compilation target.
 */
export function getExtension(target: string): string {
  return TARGET_EXTENSIONS[target] ?? 'txt';
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a byte count into a human-readable string (B, KB, MB, GB).
 */
export function formatSize(bytes: number): string {
  if (bytes < 0) return `${bytes} B`;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  for (const unit of units) {
    value /= 1024;
    if (value < 1024) return `${value.toFixed(1)} ${unit}`;
  }
  return `${value.toFixed(1)} PB`;
}

/**
 * Format a duration in milliseconds into a human-readable string.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) return `${ms.toFixed(0)}ms`;
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

// ============================================================================
// String Helpers
// ============================================================================

/**
 * Convert a string into a URL-safe slug (lowercase, hyphens, no special chars).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Truncate a string to `maxLength` characters, appending "…" if truncated.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}

/**
 * Indent every line of `text` by `spaces` spaces.
 */
export function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? pad + line : line))
    .join('\n');
}

/**
 * Remove the common leading whitespace from every line (dedent).
 * Inspired by Python's `textwrap.dedent`.
 */
export function dedent(text: string): string {
  const lines = text.split('\n');

  // Ignore leading / trailing blank lines for the common-prefix calculation
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return text;

  const common = nonEmpty.reduce((prefix, line) => {
    let i = 0;
    while (i < prefix.length && i < line.length && prefix[i] === line[i]) {
      i++;
    }
    return prefix.slice(0, i);
  });

  if (common.length === 0) return text;

  return lines
    .map((line) => (line.startsWith(common) ? line.slice(common.length) : line))
    .join('\n');
}

// ============================================================================
// Object Helpers
// ============================================================================

/**
 * Pick only the specified keys from an object.
 */
export function pick<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit the specified keys from an object.
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: K[],
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

// ============================================================================
// Misc Helpers
// ============================================================================

/**
 * Sleep for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random hex string of `bytes` length (default 8 → 16 hex chars).
 */
export function randomHex(bytes: number = 8): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Return a timestamp string suitable for log prefixes: "HH:MM:SS.mmm".
 */
export function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export function capitalize(text: string): string {
  if (text.length === 0) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  if (plural !== undefined) return plural;
  return `${singular}s`;
}

export function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const head = items.slice(0, -1).join(', ');
  return `${head}, and ${items[items.length - 1]}`;
}

export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) return [];
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export function unique<T>(array: T[]): T[] {
  return Array.from(new Set(array));
}

export function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of array) {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key]!.push(item);
  }
  return groups;
}

export function parseKeyValue(line: string): { key: string; value: string } | null {
  const idx = line.indexOf('=');
  if (idx < 0) return null;
  const key = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (key.length === 0) return null;
  return { key, value };
}
