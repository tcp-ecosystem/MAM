/**
 * MAM Test Fixture Management
 *
 * Provides utilities for creating, loading, and managing test fixtures
 * including temporary MAM modules and template-based generation.
 */

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Types
// ============================================================================

/** A generated fixture file entry */
export interface FixtureFile {
  /** Relative path within the fixture directory */
  path: string;
  /** File content */
  content: string;
}

/** Template for generating fixtures */
export interface FixtureTemplate {
  /** Template name */
  name: string;
  /** Frontmatter fields */
  frontmatter: Record<string, unknown>;
  /** Section definitions */
  sections: FixtureSection[];
}

/** Section within a fixture template */
export interface FixtureSection {
  /** Section name */
  name: string;
  /** Section level (1-6) */
  level: number;
  /** Section body content */
  content: string;
  /** Optional code blocks */
  codeBlocks?: Array<{ language: string; content: string }>;
}

/** Cache entry for generated fixtures */
export interface FixtureCacheEntry {
  /** Directory path */
  dir: string;
  /** Generation timestamp */
  createdAt: number;
  /** Whether cleanup has been called */
  cleaned: boolean;
}

// ============================================================================
// Fixture Manager
// ============================================================================

export class TestFixtureManager {
  private baseDir: string;
  private cache: Map<string, FixtureCacheEntry> = new Map();
  private createdDirs: string[] = [];

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? join(tmpdir(), 'mam-test-fixtures');
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize the base fixture directory
   */
  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Clean up all created fixture directories
   */
  async cleanupAll(): Promise<void> {
    for (const dir of this.createdDirs) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    this.createdDirs = [];
    this.cache.clear();
  }

  /**
   * Clean up a specific fixture directory
   */
  async cleanup(dir: string): Promise<void> {
    const entry = this.cache.get(dir);
    if (entry && !entry.cleaned) {
      try {
        await rm(dir, { recursive: true, force: true });
        entry.cleaned = true;
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // --------------------------------------------------------------------------
  // Creation
  // --------------------------------------------------------------------------

  /**
   * Create a fixture directory with multiple files
   */
  async create(name: string, files: FixtureFile[]): Promise<string> {
    const dir = join(this.baseDir, name);
    await mkdir(dir, { recursive: true });

    for (const file of files) {
      const filePath = join(dir, file.path);
      const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));

      if (fileDir !== dir) {
        await mkdir(fileDir, { recursive: true });
      }

      await writeFile(filePath, file.content, 'utf-8');
    }

    this.cache.set(dir, {
      dir,
      createdAt: Date.now(),
      cleaned: false,
    });
    this.createdDirs.push(dir);

    return dir;
  }

  /**
   * Create a single-file fixture
   */
  async createFile(name: string, content: string, extension = '.mam.md'): Promise<string> {
    const dir = join(this.baseDir, name);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, `module${extension}`);
    await writeFile(filePath, content, 'utf-8');

    this.cache.set(dir, {
      dir,
      createdAt: Date.now(),
      cleaned: false,
    });
    this.createdDirs.push(dir);

    return filePath;
  }

  /**
   * Create a temporary module with minimal content
   */
  async createTempModule(
    id: string,
    options?: { name?: string; version?: string; runtime?: string }
  ): Promise<string> {
    const name = options?.name ?? `test-${id}`;
    const version = options?.version ?? '1.0.0';
    const runtime = options?.runtime ?? 'default';

    const content = [
      '---',
      `id: ${id}`,
      `name: ${name}`,
      `version: ${version}`,
      `runtime: ${runtime}`,
      '---',
      '',
      '# Purpose',
      '',
      `Test module ${name}.`,
      '',
    ].join('\n');

    return this.createFile(id, content);
  }

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  /**
   * Load all files in a fixture directory
   */
  async load(dir: string): Promise<FixtureFile[]> {
    const files: FixtureFile[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const relativePath = entry.name;
          const fullPath = join(dir, relativePath);
          const content = await readFile(fullPath, 'utf-8');
          files.push({ path: relativePath, content });
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return files;
  }

  /**
   * Load a single fixture file
   */
  async loadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Generation
  // --------------------------------------------------------------------------

  /**
   * Generate a MAM module from a template
   */
  generateModule(template: FixtureTemplate): string {
    const lines: string[] = [];

    // Frontmatter
    lines.push('---');
    for (const [key, value] of Object.entries(template.frontmatter)) {
      lines.push(`${key}: ${this.formatYAMLValue(value)}`);
    }
    lines.push('---');
    lines.push('');

    // Sections
    for (const section of template.sections) {
      const prefix = '#'.repeat(section.level);
      lines.push(`${prefix} ${section.name}`);
      lines.push('');
      lines.push(section.content);
      lines.push('');

      if (section.codeBlocks) {
        for (const block of section.codeBlocks) {
          lines.push('```' + block.language);
          lines.push(block.content);
          lines.push('```');
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate a fixture from a template and write it to disk
   */
  async generate(name: string, template: FixtureTemplate): Promise<string> {
    const content = this.generateModule(template);
    return this.createFile(name, content);
  }

  /**
   * Generate multiple fixtures from templates
   */
  async generateAll(
    templates: Array<{ name: string; template: FixtureTemplate }>
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const { name, template } of templates) {
      paths.push(await this.generate(name, template));
    }
    return paths;
  }

  // --------------------------------------------------------------------------
  // Cache management
  // --------------------------------------------------------------------------

  /**
   * Get cache statistics
   */
  getCacheStats(): { total: number; active: number; cleaned: number } {
    const entries = Array.from(this.cache.values());
    return {
      total: entries.length,
      active: entries.filter((e) => !e.cleaned).length,
      cleaned: entries.filter((e) => e.cleaned).length,
    };
  }

  /**
   * Check if a directory is cached
   */
  isCached(dir: string): boolean {
    return this.cache.has(dir);
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Format a value for YAML output
   */
  private formatYAMLValue(value: unknown): string {
    if (typeof value === 'string') {
      // Quote strings that contain special characters
      if (/[:*#[\]{}&*!|>'"%@`]/.test(value) || value.includes(' ')) {
        return `"${value.replace(/"/g, '\\"')}"`;
      }
      return value;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      return `[${value.map((v) => this.formatYAMLValue(v)).join(', ')}]`;
    }

    if (value === null || value === undefined) return '""';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);

    return `"${String(value)}"`;
  }

  /**
   * Get the base directory path
   */
  getBaseDir(): string {
    return this.baseDir;
  }
}

// ============================================================================
// Predefined Templates
// ============================================================================

/**
 * A minimal valid MAM module template
 */
export const MINIMAL_TEMPLATE: FixtureTemplate = {
  name: 'minimal',
  frontmatter: {
    id: 'test-minimal',
    name: 'Minimal Test Module',
    version: '1.0.0',
  },
  sections: [
    {
      name: 'Purpose',
      level: 2,
      content: 'A minimal test module.',
    },
  ],
};

/**
 * A full-featured MAM module template
 */
export const FULL_TEMPLATE: FixtureTemplate = {
  name: 'full',
  frontmatter: {
    id: 'test-full',
    name: 'Full Test Module',
    version: '1.0.0',
    runtime: 'node',
    description: 'A full-featured test module',
    dependencies: ['lodash', 'express'],
    permissions: ['read', 'write'],
  },
  sections: [
    {
      name: 'Purpose',
      level: 2,
      content: 'This module demonstrates all MAM features.',
    },
    {
      name: 'Configuration',
      level: 2,
      content: 'Configuration section with code examples.',
      codeBlocks: [
        {
          language: 'json',
          content: '{\n  "key": "value"\n}',
        },
      ],
    },
    {
      name: 'Implementation',
      level: 2,
      content: 'Implementation details.',
      codeBlocks: [
        {
          language: 'typescript',
          content: 'export function run() {\n  return 42;\n}',
        },
      ],
    },
  ],
};

/**
 * A system template with multiple modules
 */
export const SYSTEM_TEMPLATE: FixtureTemplate = {
  name: 'system',
  frontmatter: {
    id: 'test-system',
    name: 'Test System',
    version: '1.0.0',
    type: 'system',
  },
  sections: [
    {
      name: 'Purpose',
      level: 2,
      content: 'A multi-module test system.',
    },
    {
      name: 'Architecture',
      level: 2,
      content: 'System architecture overview.',
      codeBlocks: [
        {
          language: 'text',
          content: 'Module A -> Module B -> Module C',
        },
      ],
    },
  ],
};
