/**
 * MAM Snapshot Test
 * 
 * Snapshot testing for MAM modules.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
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
      const snapshot = serializeToJSON(result.ast, 'json');

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
}