/**
 * MAM Snapshot Test
 * 
 * Snapshot testing for MAM modules.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseMAM } from '@mam/parser';
import { serializeToJSON } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface SnapshotConfig {
  /** Snapshot directory */
  snapshotDir: string;
  /** Update snapshots */
  update?: boolean;
  /** Serialization format for stored snapshots */
  format?: 'json' | 'compact';
  /** Custom serializer for snapshot values */
  serialize?: (value: unknown) => string;
  /** Custom deserializer for stored snapshot values */
  deserialize?: (text: string) => unknown;
}

export interface SnapshotResult {
  /** Test name */
  name: string;
  /** Test success */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Whether snapshot was updated */
  updated?: boolean;
  /** Whether a brand new snapshot was created */
  created?: boolean;
}

// ============================================================================
// Snapshot Test
// ============================================================================

export class SnapshotTest {
  private config: SnapshotConfig;

  constructor(config: SnapshotConfig) {
    this.config = config;
  }

  /**
   * Test module against snapshot
   */
  async test(name: string, file: string): Promise<SnapshotResult> {
    try {
      const content = await readFile(file, 'utf-8');
      const result = parseMAM(content, { source: file });
      const snapshot = serializeToJSON(result.ast as any, 'json');

      const snapshotFile = join(this.config.snapshotDir, `${name}.snapshot.json`);

      // Check if snapshot exists
      let existingSnapshot: string | null = null;
      try {
        existingSnapshot = await readFile(snapshotFile, 'utf-8');
      } catch {
        // Snapshot doesn't exist
      }

      // Compare or create
      if (existingSnapshot === null) {
        // Create new snapshot
        await this.config.snapshotDir && await import('node:fs/promises').then(fs => 
          fs.mkdir(this.config.snapshotDir, { recursive: true })
        );
        await writeFile(snapshotFile, snapshot, 'utf-8');
        return { name, success: true, updated: true };
      }

      if (snapshot === existingSnapshot) {
        return { name, success: true };
      }

      // Update if configured
      if (this.config.update) {
        await writeFile(snapshotFile, snapshot, 'utf-8');
        return { name, success: true, updated: true };
      }

      return {
        name,
        success: false,
        error: 'Snapshot mismatch',
      };
    } catch (error) {
      return {
        name,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Test multiple snapshots
   */
  async testAll(tests: Array<{ name: string; file: string }>): Promise<SnapshotResult[]> {
    const results: SnapshotResult[] = [];
    for (const test of tests) {
      results.push(await this.test(test.name, test.file));
    }
    return results;
  }

  /**
   * Update all snapshots
   */
  async updateAll(tests: Array<{ name: string; file: string }>): Promise<SnapshotResult[]> {
    const originalUpdate = this.config.update;
    this.config.update = true;
    
    const results = await this.testAll(tests);
    
    this.config.update = originalUpdate;
    return results;
  }

  // ==========================================================================
  // Named Snapshots
  // ==========================================================================

  /**
   * Test a module against a named snapshot, enabling multiple snapshots per
   * test. Stored at `<snapshotDir>/<name>.<snapshotName>.snapshot.json`.
   */
  async testNamed(name: string, snapshotName: string, file: string): Promise<SnapshotResult> {
    return this.runNamed(name, `${name}.${snapshotName}`, file);
  }

  /**
   * Test an arbitrary serializable value against a stored snapshot rather than
   * a MAM module AST.
   */
  async snapshot(name: string, value: unknown): Promise<SnapshotResult> {
    const text = this.serializeValue(value);
    return this.compareStored(name, name, text);
  }

  /**
   * Force update mode for a single call, restoring the previous setting after
   * the call completes.
   */
  async update(name: string, file: string): Promise<SnapshotResult> {
    const previous = this.config.update;
    this.config.update = true;
    try {
      return await this.test(name, file);
    } finally {
      this.config.update = previous;
    }
  }

  /**
   * List existing snapshot file names for a test, e.g.
   * `my-module.snapshot.json`, `my-module.edge.snapshot.json`.
   */
  async listSnapshots(name: string): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const prefix = `${name}.`;
    try {
      const entries = await readdir(this.config.snapshotDir);
      return entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.snapshot.json'));
    } catch {
      return [];
    }
  }

  /**
   * Remove stored snapshots for a test that are no longer listed in
   * `activeSnapshotNames`. Returns the removed file names.
   */
  async prune(name: string, activeSnapshotNames: string[]): Promise<string[]> {
    const { rm } = await import('node:fs/promises');
    const active = new Set(activeSnapshotNames.map((n) => `${n}.snapshot.json`));
    const removed: string[] = [];
    for (const entry of await this.listSnapshots(name)) {
      if (!active.has(entry)) {
        try {
          await rm(join(this.config.snapshotDir, entry), { force: true });
          removed.push(entry);
        } catch {
          // Ignore removal failures
        }
      }
    }
    return removed;
  }

  /**
   * Serialize a value according to the configured serializer, falling back to
   * `serializeToJSON` with the configured format.
   */
  private serializeValue(value: unknown): string {
    if (this.config.serialize) return this.config.serialize(value);
    return serializeToJSON(value as any, this.config.format ?? 'json');
  }

  /**
   * Compare actual text against a stored snapshot at `<key>.snapshot.json`,
   * creating the file when it does not exist and rewriting it in update mode.
   */
  private async compareStored(name: string, key: string, actualText: string): Promise<SnapshotResult> {
    const snapshotFile = join(this.config.snapshotDir, `${key}.snapshot.json`);
    let existingSnapshot: string | null = null;
    try {
      existingSnapshot = await readFile(snapshotFile, 'utf-8');
    } catch {
      // Snapshot doesn't exist yet
    }

    if (existingSnapshot === null) {
      await mkdir(this.config.snapshotDir, { recursive: true });
      await writeFile(snapshotFile, actualText, 'utf-8');
      return { name, success: true, updated: true, created: true };
    }

    if (actualText === existingSnapshot) {
      return { name, success: true };
    }

    if (this.config.update) {
      await writeFile(snapshotFile, actualText, 'utf-8');
      return { name, success: true, updated: true };
    }

    const diff = SnapshotDiffer.diff(existingSnapshot, actualText);
    return {
      name,
      success: false,
      updated: false,
      error: `Snapshot mismatch for "${key}"\n${diff}`,
    };
  }

  /**
   * Parse a MAM module file and compare its serialized AST against a stored
   * snapshot key.
   */
  private async runNamed(name: string, key: string, file: string): Promise<SnapshotResult> {
    try {
      const content = await readFile(file, 'utf-8');
      const result = parseMAM(content, { source: file });
      const snapshot = this.serializeValue(result.ast);
      return this.compareStored(name, key, snapshot);
    } catch (error) {
      return { name, success: false, updated: false, error: (error as Error).message };
    }
  }
}

// ============================================================================
// Snapshot Differ
// ============================================================================

/**
 * Computes unified-style diffs and similarity scores between stored and actual
 * snapshot text. Pure line/text algorithms with no dependencies.
 */
export class SnapshotDiffer {
  /**
   * Produce a unified-style diff between stored and actual snapshot text.
   */
  static diff(stored: string, actual: string): string {
    const lines = SnapshotDiffer.diffLines(stored.split('\n'), actual.split('\n'));
    return ['--- stored', '+++ actual', ...lines].join('\n');
  }

  /**
   * Compute a line-level diff using a longest common subsequence algorithm.
   * Lines prefixed with `-` were removed, `+` were added, and `  ` are common.
   */
  static diffLines(a: string[], b: string[]): string[] {
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }

    const result: string[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        result.push(`  ${a[i]}`);
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        result.push(`- ${a[i]}`);
        i++;
      } else {
        result.push(`+ ${b[j]}`);
        j++;
      }
    }
    while (i < n) {
      result.push(`- ${a[i]}`);
      i++;
    }
    while (j < m) {
      result.push(`+ ${b[j]}`);
      j++;
    }
    return result;
  }

  /**
   * Levenshtein-style similarity score in the range 0..1 where 1 means the
   * strings are identical.
   */
  static similarity(stored: string, actual: string): number {
    if (stored === actual) return 1;
    if (stored.length === 0 || actual.length === 0) return 0;

    const dp: number[][] = Array.from({ length: stored.length + 1 }, () => new Array<number>(actual.length + 1).fill(0));
    for (let i = 1; i <= stored.length; i++) {
      for (let j = 1; j <= actual.length; j++) {
        dp[i]![j] = stored[i - 1] === actual[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
    return dp[stored.length]![actual.length]! / Math.max(stored.length, actual.length);
  }
}

// ============================================================================
// Inline Snapshots
// ============================================================================

export interface InlineSnapshotResult {
  /** Snapshot name */
  name: string;
  /** Whether the value matches the stored snapshot */
  passed: boolean;
  /** The actual value under test */
  actual: unknown;
  /** The previously stored value */
  stored?: unknown;
  /** Whether the snapshot was written/updated */
  updated: boolean;
  /** Human readable error when the snapshot mismatched */
  error?: string;
}

/**
 * In-memory store for inline snapshots. Values are compared structurally via
 * JSON serialization and can be refreshed by enabling update mode.
 */
export class InlineSnapshot {
  private readonly store: Map<string, unknown> = new Map();
  private readonly update: boolean;

  constructor(options: { update?: boolean; initial?: Record<string, unknown> } = {}) {
    this.update = options.update ?? false;
    if (options.initial) {
      for (const [key, value] of Object.entries(options.initial)) {
        this.store.set(key, value);
      }
    }
  }

  /** Compare (or record) a value against the named inline snapshot */
  match(name: string, value: unknown): InlineSnapshotResult {
    const hasStored = this.store.has(name);
    if (!hasStored || this.update) {
      this.store.set(name, value);
      return { name, passed: true, actual: value, stored: hasStored ? this.store.get(name) : undefined, updated: true };
    }
    const existing = this.store.get(name);
    const equal = JSON.stringify(existing) === JSON.stringify(value);
    return {
      name,
      passed: equal,
      actual: value,
      stored: existing,
      updated: false,
      error: equal ? undefined : `Inline snapshot "${name}" does not match the stored value`,
    };
  }

  /** Read a stored value */
  get(name: string): unknown {
    return this.store.get(name);
  }

  /** Explicitly set a stored value */
  set(name: string, value: unknown): void {
    this.store.set(name, value);
  }

  /** Whether a value is stored for the given name */
  has(name: string): boolean {
    return this.store.has(name);
  }

  /** All stored entries */
  entries(): Array<[string, unknown]> {
    return Array.from(this.store.entries());
  }

  /** Number of stored snapshots */
  count(): number {
    return this.store.size;
  }
}

/**
 * Convenience wrapper around `InlineSnapshot.match` that uses a shared store,
 * a fixed name, or a transient store.
 */
export function inlineSnapshot(
  value: unknown,
  options: { snapshot?: InlineSnapshot; name?: string; update?: boolean } = {}
): InlineSnapshotResult {
  const store = options.snapshot ?? new InlineSnapshot({ update: options.update });
  return store.match(options.name ?? 'inline', value);
}

// ============================================================================
// Snapshot Summary
// ============================================================================

export interface SnapshotSummary {
  /** Total snapshots examined */
  total: number;
  /** Matching snapshots */
  passed: number;
  /** Mismatched snapshots */
  failed: number;
  /** Snapshots rewritten */
  updated: number;
  /** Snapshots created for the first time */
  created: number;
  /** Snapshots pruned */
  pruned: number;
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Aggregate snapshot results into a summary.
 */
export function snapshotSummary(results: SnapshotResult[], options: { pruned?: number; durationMs?: number } = {}): SnapshotSummary {
  const summary: SnapshotSummary = {
    total: results.length,
    passed: 0,
    failed: 0,
    updated: 0,
    created: 0,
    pruned: options.pruned ?? 0,
    durationMs: options.durationMs ?? 0,
  };
  for (const result of results) {
    if (result.success) summary.passed++;
    else summary.failed++;
    if (result.updated) summary.updated++;
    if (result.created) summary.created++;
  }
  return summary;
}

/**
 * Incrementally accumulates snapshot results into a `SnapshotSummary`.
 */
export class SnapshotSummaryBuilder {
  private total = 0;
  private passed = 0;
  private failed = 0;
  private updated = 0;
  private created = 0;
  private pruned = 0;

  /** Record a single snapshot result */
  add(result: SnapshotResult): this {
    this.total++;
    if (result.success) this.passed++;
    else this.failed++;
    if (result.updated) this.updated++;
    if (result.created) this.created++;
    return this;
  }

  /** Record pruned snapshot files */
  addPruned(count: number): this {
    this.pruned += count;
    return this;
  }

  /** Build the final summary */
  build(durationMs?: number): SnapshotSummary {
    return {
      total: this.total,
      passed: this.passed,
      failed: this.failed,
      updated: this.updated,
      created: this.created,
      pruned: this.pruned,
      durationMs: durationMs ?? 0,
    };
  }

  /** Reset all counters */
  reset(): this {
    this.total = 0;
    this.passed = 0;
    this.failed = 0;
    this.updated = 0;
    this.created = 0;
    this.pruned = 0;
    return this;
  }
}

// ============================================================================
// Convenience Helpers
// ============================================================================

/** Factory shorthand for building a snapshot tester */
export function createSnapshotTest(config: SnapshotConfig): SnapshotTest {
  return new SnapshotTest(config);
}

export interface NamedSnapshotTest {
  /** Test name used in results */
  name: string;
  /** Snapshot name used as a key suffix */
  snapshotName: string;
  /** Module file under test */
  file: string;
}

/** Run many named snapshots across one or more module files */
export async function runNamedSnapshots(test: SnapshotTest, tests: NamedSnapshotTest[]): Promise<SnapshotResult[]> {
  const results: SnapshotResult[] = [];
  for (const item of tests) {
    results.push(await test.testNamed(item.name, item.snapshotName, item.file));
  }
  return results;
}