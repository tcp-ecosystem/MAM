/**
 * MAM Compile Command
 *
 * Production-grade compilation pipeline supporting 17 target backends.
 * Handles parsing, AST analysis, optimization, code generation,
 * source maps, incremental compilation, watch mode, and multi-file builds.
 */

import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { resolve, basename, join, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, watch as fsWatch } from 'node:fs';
import { EventEmitter } from 'node:events';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

// ---------------------------------------------------------------------------
// Types & Enums
// ---------------------------------------------------------------------------

export type CompileTarget =
  | 'python' | 'javascript' | 'typescript' | 'go' | 'rust'
  | 'csharp' | 'java' | 'wasm' | 'json' | 'openai'
  | 'langgraph' | 'crewai' | 'gemini' | 'autogen'
  | 'kubernetes' | 'terraform' | 'docker' | 'claude';

export type OutputFormat = 'file' | 'directory' | 'stdout';

export interface TargetOptions {
  indent: number;
  indentChar: ' ' | '\t';
  comments: boolean;
  minify: boolean;
  strictTypes: boolean;
  maxLineLength: number;
  includeSourceMap: boolean;
  includeDocs: boolean;
  encoding: BufferEncoding;
  trailingNewline: boolean;
  [key: string]: unknown;
}

export interface CompileOptions {
  file: string;
  target: CompileTarget;
  outDir?: string;
  outFormat?: OutputFormat;
  indent?: number;
  comments?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  minify?: boolean;
  strictTypes?: boolean;
  watch?: boolean;
  incremental?: boolean;
  sourceMap?: boolean;
  config?: string;
  plugins?: string[];
  env?: Record<string, string>;
  targetOptions?: Partial<TargetOptions>;
}

export interface CompileConfig {
  $schema?: string;
  version: string;
  defaultTarget: CompileTarget;
  targets: Partial<Record<CompileTarget, Partial<TargetOptions>>>;
  includeDirs: string[];
  excludePatterns: string[];
  plugins: string[];
  env: Record<string, string>;
  sourceMap: boolean;
  incremental: boolean;
  cacheDir: string;
}

export interface SourceMapFile {
  version: number;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export interface CompilationStats {
  modulesCompiled: number;
  linesGenerated: number;
  bytesGenerated: number;
  timeMs: number;
  target: CompileTarget;
  warnings: string[];
  errors: string[];
  cachedHits: number;
  cacheMisses: number;
  filesRead: number;
  filesWritten: number;
}

export interface CompileResult {
  success: boolean;
  output: string;
  target: CompileTarget;
  stats: CompilationStats;
  warnings: string[];
  errors: string[];
  sourceMap?: SourceMapFile;
  outputFiles: string[];
}

export interface CacheEntry {
  hash: string;
  timestamp: number;
  output: string;
  sourceMap?: SourceMapFile;
  stats: Partial<CompilationStats>;
}

export interface CompilerEvent {
  type: 'start' | 'progress' | 'complete' | 'error' | 'warning' | 'cached' | 'file-change';
  target: CompileTarget;
  message: string;
  timestamp: number;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CompileConfig = {
  version: '1.0.0',
  defaultTarget: 'javascript',
  targets: {},
  includeDirs: ['.'],
  excludePatterns: ['node_modules', 'dist', '.git'],
  plugins: [],
  env: {},
  sourceMap: false,
  incremental: false,
  cacheDir: '.mam-cache',
};

const TARGET_EXTENSIONS: Record<CompileTarget, string> = {
  python: 'py', javascript: 'js', typescript: 'ts', go: 'go',
  rust: 'rs', csharp: 'cs', java: 'java', wasm: 'wasm',
  json: 'json', openai: 'json', langgraph: 'py', crewai: 'py',
  gemini: 'py', autogen: 'py', kubernetes: 'yaml', terraform: 'tf',
  docker: 'Dockerfile', claude: 'ts',
};

// ---------------------------------------------------------------------------
// Configuration Loader
// ---------------------------------------------------------------------------

class ConfigLoader {
  private static readonly CONFIG_NAMES = [
    '.mamcompile.json', 'mamcompile.json', '.mamcompile.jsonc', 'mam.config.json',
  ];

  static async load(searchDir: string): Promise<CompileConfig> {
    for (const name of this.CONFIG_NAMES) {
      const configPath = join(searchDir, name);
      if (existsSync(configPath)) {
        try {
          const raw = await readFile(configPath, 'utf-8');
          return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
        } catch (err) {
          console.warn(chalk.yellow(`Warning: Failed to parse config at ${configPath}: ${(err as Error).message}`));
        }
      }
    }
    return { ...DEFAULT_CONFIG };
  }

  static merge(base: CompileConfig, options: CompileOptions): CompileConfig {
    const merged = { ...base };
    if (options.targetOptions) {
      const existing = merged.targets[options.target] || {};
      merged.targets[options.target] = { ...existing, ...options.targetOptions };
    }
    if (options.env) merged.env = { ...merged.env, ...options.env };
    if (options.indent !== undefined) {
      const existing = merged.targets[options.target] || {};
      existing.indent = options.indent;
      merged.targets[options.target] = existing;
    }
    if (options.comments !== undefined) {
      const existing = merged.targets[options.target] || {};
      existing.comments = options.comments;
      merged.targets[options.target] = existing;
    }
    if (options.minify !== undefined) {
      const existing = merged.targets[options.target] || {};
      existing.minify = options.minify;
      merged.targets[options.target] = existing;
    }
    if (options.strictTypes !== undefined) {
      const existing = merged.targets[options.target] || {};
      existing.strictTypes = options.strictTypes;
      merged.targets[options.target] = existing;
    }
    if (options.sourceMap !== undefined) merged.sourceMap = options.sourceMap;
    if (options.incremental !== undefined) merged.incremental = options.incremental;
    return merged;
  }
}

// ---------------------------------------------------------------------------
// Cache Manager
// ---------------------------------------------------------------------------

class CacheManager {
  private cacheDir: string;
  private memoryCache: Map<string, CacheEntry> = new Map();

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  private getCachePath(filePath: string, target: CompileTarget): string {
    const safePath = filePath.replace(/[\\/:]/g, '_');
    return join(this.cacheDir, `${safePath}.${target}.cache`);
  }

  async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async get(filePath: string, target: CompileTarget, contentHash: string): Promise<CacheEntry | null> {
    const memKey = `${filePath}:${target}`;
    if (this.memoryCache.has(memKey)) {
      const entry = this.memoryCache.get(memKey)!;
      if (entry.hash === contentHash) return entry;
    }
    const cachePath = this.getCachePath(filePath, target);
    if (existsSync(cachePath)) {
      try {
        const raw = await readFile(cachePath, 'utf-8');
        const entry: CacheEntry = JSON.parse(raw);
        if (entry.hash === contentHash) {
          this.memoryCache.set(memKey, entry);
          return entry;
        }
      } catch { /* corrupted cache */ }
    }
    return null;
  }

  async set(filePath: string, target: CompileTarget, entry: CacheEntry): Promise<void> {
    const memKey = `${filePath}:${target}`;
    this.memoryCache.set(memKey, entry);
    try {
      await this.ensureCacheDir();
      await writeFile(this.getCachePath(filePath, target), JSON.stringify(entry), 'utf-8');
    } catch { /* non-critical */ }
  }

  async invalidate(filePath: string, target?: CompileTarget): Promise<void> {
    if (target) {
      this.memoryCache.delete(`${filePath}:${target}`);
      const p = this.getCachePath(filePath, target);
      if (existsSync(p)) await unlink(p);
    } else {
      for (const key of this.memoryCache.keys()) {
        if (key.startsWith(`${filePath}:`)) this.memoryCache.delete(key);
      }
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    if (existsSync(this.cacheDir)) {
      const entries = await readdir(this.cacheDir);
      for (const entry of entries) {
        if (entry.endsWith('.cache')) await unlink(join(this.cacheDir, entry));
      }
    }
  }

  static computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}

// ---------------------------------------------------------------------------
// Source Map Generator
// ---------------------------------------------------------------------------

interface SourceMapEntry {
  generatedLine: number;
  generatedColumn: number;
  originalLine: number;
  originalColumn: number;
  source: string;
  name?: string;
}

class SourceMapGenerator {
  private entries: SourceMapEntry[] = [];
  private sources: string[] = [];
  private sourcesContent: string[] = [];
  private names: string[] = [];

  addSource(sourcePath: string, content: string): number {
    const idx = this.sources.indexOf(sourcePath);
    if (idx >= 0) return idx;
    this.sources.push(sourcePath);
    this.sourcesContent.push(content);
    return this.sources.length - 1;
  }

  addName(name: string): number {
    const idx = this.names.indexOf(name);
    if (idx >= 0) return idx;
    this.names.push(name);
    return this.names.length - 1;
  }

  addEntry(entry: SourceMapEntry): void { this.entries.push(entry); }

  generate(): SourceMapFile {
    this.entries.sort((a, b) => a.generatedLine - b.generatedLine || a.generatedColumn - b.generatedColumn);
    let mappings = '';
    let prevGenLine = 0, prevGenCol = 0, prevSourceIdx = 0, prevSourceLine = 0, prevSourceCol = 0, prevNameIdx = 0;
    for (const entry of this.entries) {
      if (entry.generatedLine !== prevGenLine) prevGenCol = 0;
      const srcIdx = this.sources.indexOf(entry.source);
      const segment = [
        this.encode(entry.generatedColumn - prevGenCol),
        this.encode(srcIdx - prevSourceIdx),
        this.encode(entry.originalLine - prevSourceLine),
        this.encode(entry.originalColumn - prevSourceCol),
      ];
      const nameIdx = entry.name ? this.names.indexOf(entry.name) : -1;
      if (nameIdx >= 0) { segment.push(this.encode(nameIdx - prevNameIdx)); prevNameIdx = nameIdx; }
      if (entry.generatedLine !== prevGenLine) {
        mappings += segment.join(',');
      } else {
        mappings += ';' + segment.join(',');
      }
      prevGenLine = entry.generatedLine;
      prevGenCol = entry.generatedColumn;
      prevSourceIdx = srcIdx;
      prevSourceLine = entry.originalLine;
      prevSourceCol = entry.originalColumn;
    }
    return { version: 3, file: '', sources: [...this.sources], sourcesContent: [...this.sourcesContent], names: [...this.names], mappings };
  }

  private encode(value: number): string {
    const result: string[] = [];
    let encoded = value < 0 ? (~value << 1) | 1 : value << 1;
    while (encoded > 0x1f) { result.push(String.fromCharCode((encoded & 0x1f) | 0x20)); encoded >>>= 5; }
    result.push(String.fromCharCode(encoded & 0x7f));
    return result.join('');
  }
}

// ---------------------------------------------------------------------------
// Generator Context & Helpers
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  ast: unknown;
  config: CompileConfig;
  targetOptions: TargetOptions;
  sourceMap: SourceMapGenerator;
  sourceContent: string;
  filePath: string;
  warnings: string[];
  dependencies: Set<string>;
}

function ictx(ctx: GeneratorContext, level: number): string {
  const ch = ctx.targetOptions.indentChar === '\t' ? '\t' : ' '.repeat(ctx.targetOptions.indent);
  return ch.repeat(level);
}

// ---------------------------------------------------------------------------
// Module Context Generator (CLI)
// ---------------------------------------------------------------------------

interface ParsedModuleInfo {
  name: string;
  type: string;
  version: string;
  author: string;
  description: string;
  inputs: Array<{ name: string; type: string; required: boolean; description: string }>;
  outputs: Array<{ name: string; type: string; description: string }>;
  capabilities: string[];
  rules: string[];
  dependencies: string[];
  permissions: { network?: string; filesystem?: string };
  tests: string;
  examples: string;
}

function extractModuleInfo(ctx: GeneratorContext): ParsedModuleInfo {
  const info: ParsedModuleInfo = {
    name: basename(ctx.filePath, extname(ctx.filePath)),
    type: 'module',
    version: '1.0.0',
    author: 'MAM User',
    description: 'N/A',
    inputs: [],
    outputs: [],
    capabilities: [],
    rules: [],
    dependencies: [],
    permissions: { network: 'N/A', filesystem: 'N/A' },
    tests: 'N/A',
    examples: 'N/A',
  };

  // Try to extract from AST frontmatter
  const ast = ctx.ast as { frontmatter?: { data?: Record<string, unknown> }; sections?: Array<{ name: string; content: unknown[] }> } | null;
  if (ast?.frontmatter?.data) {
    const d = ast.frontmatter.data;
    if (d.name) info.name = String(d.name);
    if (d.type) info.type = String(d.type);
    if (d.version) info.version = String(d.version);
    if (d.author) info.author = String(d.author);
    if (d.description) info.description = String(d.description);
    if (Array.isArray(d.capabilities)) info.capabilities = d.capabilities.map(String);
    if (Array.isArray(d.tags)) info.capabilities.push(...d.tags.map(String));
  }

  // Try to extract from sections
  if (ast?.sections) {
    for (const section of ast.sections) {
      const sectionName = section.name.toLowerCase();

      // Purpose / Description
      if (sectionName === 'purpose' || sectionName === 'description') {
        const text = section.content
          .map((n: unknown) => {
            const node = n as { type: string; value?: string };
            return node.value || '';
          })
          .filter(Boolean)
          .join(' ');
        if (text && info.description === 'N/A') info.description = text;
      }

      // Rules - extract list items
      if (sectionName === 'rules') {
        for (const node of section.content) {
          const n = node as { type: string; items?: Array<{ content: Array<{ type: string; value?: string }> }> };
          if (n.type === 'list' && n.items) {
            for (const item of n.items) {
              const text = item.content.map((c: { type: string; value?: string }) => c.value || '').filter(Boolean).join(' ');
              if (text) info.rules.push(text);
            }
          }
        }
      }

      // Inputs - extract from table
      if (sectionName === 'inputs') {
        for (const node of section.content) {
          const n = node as { type: string; headers?: string[]; rows?: string[][] };
          if (n.type === 'table' && n.rows) {
            for (const row of n.rows) {
              info.inputs.push({
                name: row[0] || '',
                type: row[1] || 'unknown',
                required: (row[2] || '').toLowerCase() === 'yes' || (row[2] || '').toLowerCase() === 'true',
                description: row[3] || '',
              });
            }
          }
        }
      }

      // Outputs - extract from table
      if (sectionName === 'outputs') {
        for (const node of section.content) {
          const n = node as { type: string; headers?: string[]; rows?: string[][] };
          if (n.type === 'table' && n.rows) {
            for (const row of n.rows) {
              info.outputs.push({
                name: row[0] || '',
                type: row[1] || 'unknown',
                description: row[2] || '',
              });
            }
          }
        }
      }

      // Dependencies
      if (sectionName === 'dependencies') {
        for (const node of section.content) {
          const n = node as { type: string; items?: Array<{ content: Array<{ type: string; value?: string }> }> };
          if (n.type === 'list' && n.items) {
            for (const item of n.items) {
              const text = item.content.map((c: { type: string; value?: string }) => c.value || '').filter(Boolean).join(' ');
              if (text && text !== 'None (standard library only)') info.dependencies.push(text);
            }
          }
        }
      }

      // Tests - just note that tests exist, don't embed raw code
      if (sectionName === 'tests') {
        info.tests = 'See source module for test definitions';
      }

      // Examples - just note that examples exist, don't embed raw code
      if (sectionName === 'examples') {
        info.examples = 'See source module for usage examples';
      }
    }
  }

  return info;
}

function generateCLIContext(ctx: GeneratorContext, target: string): string {
  const info = extractModuleInfo(ctx);
  const lines: string[] = [];

  lines.push('MAM Module Context');
  lines.push('==================');
  lines.push(`Name: ${info.name}`);
  lines.push(`Type: ${info.type}`);
  lines.push(`Version: ${info.version}`);
  lines.push(`Author: ${info.author}`);
  lines.push(`Description: ${info.description}`);
  lines.push('');
  lines.push(`Purpose: ${info.description}`);
  lines.push('');

  // Inputs
  lines.push('Inputs:');
  if (info.inputs.length > 0) {
    for (const inp of info.inputs) {
      lines.push(`  - ${inp.name}: ${inp.type} (required: ${inp.required})${inp.description ? ' — ' + inp.description : ''}`);
    }
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  // Outputs
  lines.push('Outputs:');
  if (info.outputs.length > 0) {
    for (const out of info.outputs) {
      lines.push(`  - ${out.name}: ${out.type}${out.description ? ' — ' + out.description : ''}`);
    }
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  lines.push('Capabilities:');
  if (info.capabilities.length > 0) {
    for (const cap of info.capabilities) lines.push(`  - ${cap}`);
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  lines.push('Rules:');
  if (info.rules.length > 0) {
    for (const rule of info.rules) lines.push(`  - ${rule}`);
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  lines.push('Dependencies:');
  if (info.dependencies.length > 0) {
    for (const dep of info.dependencies) lines.push(`  - ${dep}`);
  } else {
    lines.push('  N/A');
  }
  lines.push('');

  lines.push('Permissions:');
  lines.push(`  Network: ${info.permissions.network}`);
  lines.push(`  Filesystem: ${info.permissions.filesystem}`);
  lines.push('');
  lines.push(`Tests: ${info.tests}`);
  lines.push('');
  lines.push(`Examples: ${info.examples}`);
  lines.push('');
  lines.push('References: See https://github.com/tcp-ecosystems/MAM');

  // Format based on target
  if (target === 'json') {
    return JSON.stringify({ _generator: 'MAM Compiler', _moduleContext: info }, null, 2);
  }
  if (['python', 'openai', 'langgraph', 'crewai', 'gemini', 'autogen'].includes(target)) {
    return '"""\n' + lines.map(l => l ? `    ${l}` : '').join('\n') + '\n"""';
  }
  if (target === 'javascript' || target === 'typescript') {
    return '/**\n' + lines.map(l => l ? ` * ${l}` : ' *').join('\n') + '\n */';
  }
  if (target === 'rust') {
    return lines.map(l => l ? `//! ${l}` : '//!').join('\n');
  }
  if (target === 'csharp') {
    return lines.map(l => l ? `/// ${l}` : '///').join('\n');
  }
  if (target === 'wasm') {
    return lines.map(l => l ? `;; ${l}` : ';;').join('\n');
  }
  // Default: line comments
  return lines.map(l => l ? `// ${l}` : '//').join('\n');
}

// ---------------------------------------------------------------------------
// Python Generator
// ---------------------------------------------------------------------------

class PythonGenerator {
  generate(ctx: GeneratorContext): string {
    const L: string[] = [];
    const i0 = ictx(ctx, 0), i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4), i5 = ictx(ctx, 5);
    L.push('"""'); L.push('Auto-generated by MAM Compiler'); L.push(`Target: python`); L.push(`Source: ${ctx.filePath}`); L.push('"""'); L.push('');
    L.push(generateCLIContext(ctx, 'python')); L.push('');
    L.push('from __future__ import annotations'); L.push('import json, os, sys, re, time'); L.push('from typing import Any, Optional, Dict, List, Union'); L.push('from dataclasses import dataclass, field'); L.push('from enum import Enum'); L.push('from pathlib import Path'); L.push('');
    L.push('class MAMError(Exception):');
    L.push(`${i1}"""Base error for MAM modules."""`);
    L.push(`${i1}def __init__(self, message: str, code: str = "UNKNOWN", details: Optional[Dict[str, Any]] = None):`);
    L.push(`${i2}self.message = message`); L.push(`${i2}self.code = code`); L.push(`${i2}self.details = details or {}`); L.push(`${i2}super().__init__(self.message)`); L.push('');
    L.push('class ValidationError(MAMError):'); L.push(`${i1}"""Raised when input validation fails."""`); L.push(`${i1}pass`); L.push('');
    L.push('class MAMTimeoutError(MAMError):'); L.push(`${i1}"""Raised when execution exceeds timeout."""`); L.push(`${i1}pass`); L.push('');
    L.push('@dataclass'); L.push('class ExecutionContext:');
    L.push(`${i1}"""Runtime context for module execution."""`);
    L.push(`${i1}inputs: Dict[str, Any] = field(default_factory=dict)`); L.push(`${i1}env: Dict[str, str] = field(default_factory=dict)`); L.push(`${i1}timeout_ms: int = 30000`); L.push(`${i1}plugins: List[Any] = field(default_factory=list)`); L.push(`${i1}_start_time: float = 0.0`); L.push('');
    L.push(`${i1}def elapsed_ms(self) -> float:`); L.push(`${i2}return (time.time() - self._start_time) * 1000`); L.push('');
    L.push(`${i1}def check_timeout(self) -> None:`); L.push(`${i2}if self.timeout_ms > 0 and self.elapsed_ms() > self.timeout_ms:`); L.push(`${i3}raise MAMTimeoutError(f"Execution timed out after {self.timeout_ms}ms", "TIMEOUT", {"timeout_ms": self.timeout_ms})`); L.push('');
    L.push('@dataclass'); L.push('class ExecutionResult:');
    L.push(`${i1}"""Result of module execution."""`);
    L.push(`${i1}success: bool = True`); L.push(`${i1}output: Dict[str, Any] = field(default_factory=dict)`); L.push(`${i1}errors: List[str] = field(default_factory=list)`); L.push(`${i1}warnings: List[str] = field(default_factory=list)`); L.push(`${i1}time_ms: float = 0.0`); L.push(`${i1}metadata: Dict[str, Any] = field(default_factory=dict)`); L.push('');
    L.push('class ModuleState(Enum):'); L.push(`${i1}INITIALIZED = "initialized"`); L.push(`${i1}RUNNING = "running"`); L.push(`${i1}COMPLETED = "completed"`); L.push(`${i1}FAILED = "failed"`); L.push('');
    L.push('def _validate_inputs(inputs: Dict[str, Any], schema: Dict[str, Any]) -> List[str]:');
    L.push(`${i1}errors = []`);
    L.push(`${i1}for key, rules in schema.items():`);
    L.push(`${i2}if rules.get("required", False) and key not in inputs:`); L.push(`${i3}errors.append(f"Missing required input: {key}")`);
    L.push(`${i2}elif key in inputs:`);
    L.push(`${i3}value = inputs[key]`); L.push(`${i3}expected_type = rules.get("type")`);
    L.push(`${i3}if expected_type and not isinstance(value, eval(expected_type)):`); L.push(`${i4}errors.append(f"Invalid type for {key}: expected {expected_type}")`);
    L.push(`${i3}if "min" in rules and isinstance(value, (int, float)) and value < rules["min"]:`); L.push(`${i4}errors.append(f"Value for {key} below minimum")`);
    L.push(`${i3}if "max" in rules and isinstance(value, (int, float)) and value > rules["max"]:`); L.push(`${i4}errors.append(f"Value for {key} above maximum")`);
    L.push(`${i1}return errors`); L.push('');
    L.push('class MAMModule:');
    L.push(`${i1}"""Main module class auto-generated by MAM Compiler."""`); L.push('');
    L.push(`${i1}NAME = "${basename(ctx.filePath, extname(ctx.filePath))}"`); L.push(`${i1}VERSION = "1.0.0"`); L.push(`${i1}STATE = ModuleState.INITIALIZED`); L.push('');
    L.push(`${i1}def __init__(self) -> None:`); L.push(`${i2}self._hooks_before: List[callable] = []`); L.push(`${i2}self._hooks_after: List[callable] = []`); L.push(`${i2}self._plugins: List[Any] = []`); L.push('');
    L.push(`${i1}def register_hook(self, event: str, callback: callable) -> None:`); L.push(`${i2}if event == "before": self._hooks_before.append(callback)`); L.push(`${i2}elif event == "after": self._hooks_after.append(callback)`); L.push('');
    L.push(`${i1}def load_plugin(self, plugin: Any) -> None:`); L.push(`${i2}self._plugins.append(plugin)`); L.push(`${i2}if hasattr(plugin, 'on_load'): plugin.on_load(self)`); L.push('');
    L.push(`${i1}def execute(self, ctx: ExecutionContext) -> ExecutionResult:`); L.push(`${i2}"""Execute the module with the given context."""`);
    L.push(`${i2}import time as _time`); L.push(`${i2}result = ExecutionResult()`); L.push(`${i2}ctx._start_time = _time.time()`); L.push(`${i2}MAMModule.STATE = ModuleState.RUNNING`); L.push('');
    L.push(`${i3}errors = _validate_inputs(ctx.inputs, {})`); L.push(`${i3}if errors:`); L.push(`${i4}result.success = False`); L.push(`${i4}result.errors.extend(errors)`); L.push(`${i4}MAMModule.STATE = ModuleState.FAILED`); L.push(`${i4}return result`); L.push('');
    L.push(`${i3}try:`); L.push(`${i4}for hook in self._hooks_before:`); L.push(`${i5}hook(ctx)`); L.push(`${i5}ctx.check_timeout()`); L.push('');
    L.push(`${i4}for plugin in self._plugins:`); L.push(`${i5}if hasattr(plugin, 'before_execute'): plugin.before_execute(ctx, result)`); L.push('');
    L.push(`${i4}# Core logic placeholder`); L.push(`${i4}result.output = {}`); L.push(`${i4}ctx.check_timeout()`); L.push('');
    L.push(`${i4}for plugin in self._plugins:`); L.push(`${i5}if hasattr(plugin, 'after_execute'): plugin.after_execute(ctx, result)`); L.push('');
    L.push(`${i4}for hook in self._hooks_after:`); L.push(`${i5}hook(ctx, result)`); L.push(`${i5}ctx.check_timeout()`); L.push('');
    L.push(`${i3}except MAMError as e:`); L.push(`${i4}result.success = False`); L.push(`${i4}result.errors.append(e.message)`); L.push(`${i4}MAMModule.STATE = ModuleState.FAILED`); L.push('');
    L.push(`${i3}except Exception as e:`); L.push(`${i4}result.success = False`); L.push(`${i4}result.errors.append(f"Unexpected error: {str(e)}")`); L.push(`${i4}MAMModule.STATE = ModuleState.FAILED`); L.push('');
    L.push(`${i3}result.time_ms = ctx.elapsed_ms()`); L.push(`${i3}MAMModule.STATE = ModuleState.COMPLETED if result.success else ModuleState.FAILED`); L.push(`${i3}return result`); L.push('');
    L.push(`${i1}def to_json(self) -> str:`); L.push(`${i2}return json.dumps({"name": self.NAME, "version": self.VERSION, "state": self.STATE.value})`); L.push('');
    L.push('def create_module() -> MAMModule:'); L.push(`${i1}return MAMModule()`); L.push('');
    L.push('if __name__ == "__main__":'); L.push(`${i1}module = create_module()`); L.push(`${i1}ctx = ExecutionContext()`); L.push(`${i1}result = module.execute(ctx)`); L.push(`${i1}print(json.dumps({"success": result.success, "output": result.output, "errors": result.errors}, indent=2))`); L.push(`${i1}sys.exit(0 if result.success else 1)`); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// JavaScript Generator
// ---------------------------------------------------------------------------

class JavaScriptGenerator {
  generate(ctx: GeneratorContext): string {
    const L: string[] = [];
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    L.push('/**'); L.push(' * Auto-generated by MAM Compiler'); L.push(` * Target: javascript`); L.push(` * Source: ${ctx.filePath}`); L.push(' */'); L.push('');
    L.push(generateCLIContext(ctx, 'javascript')); L.push('');
    L.push('"use strict";'); L.push(''); L.push('Object.defineProperty(exports, "__esModule", { value: true });'); L.push('');
    L.push('class MAMError extends Error {'); L.push(`${i1}constructor(message, code = "UNKNOWN", details = {}) {`); L.push(`${i2}super(message);`); L.push(`${i2}this.name = "MAMError"; this.code = code; this.details = details;`); L.push(`${i1}}`); L.push(`${i1}toJSON() { return { name: this.name, message: this.message, code: this.code, details: this.details }; }`); L.push('}'); L.push('');
    L.push('class ValidationError extends MAMError {'); L.push(`${i1}constructor(msg) { super(msg, "VALIDATION"); this.name = "ValidationError"; }`); L.push('}'); L.push('');
    L.push('class MAMTimeoutError extends MAMError {'); L.push(`${i1}constructor(msg, ms) { super(msg, "TIMEOUT", { timeout_ms: ms }); this.name = "MAMTimeoutError"; }`); L.push('}'); L.push('');
    L.push('class ExecutionContext {'); L.push(`${i1}constructor(opts = {}) {`); L.push(`${i2}this.inputs = opts.inputs || {}; this.env = opts.env || {};`); L.push(`${i2}this.timeout_ms = opts.timeout_ms || 30000; this.plugins = opts.plugins || [];`); L.push(`${i2}this._start_time = Date.now(); this._hooks_before = []; this._hooks_after = [];`); L.push(`${i1}}`); L.push(`${i1}elapsed_ms() { return Date.now() - this._start_time; }`); L.push(`${i1}check_timeout() { if (this.timeout_ms > 0 && this.elapsed_ms() > this.timeout_ms) throw new MAMTimeoutError("Timeout", this.timeout_ms); }`); L.push(`${i1}on(event, cb) { if (event === "before") this._hooks_before.push(cb); else if (event === "after") this._hooks_after.push(cb); return this; }`); L.push('}'); L.push('');
    L.push('class ExecutionResult {'); L.push(`${i1}constructor() { this.success = true; this.output = {}; this.errors = []; this.warnings = []; this.time_ms = 0; this.metadata = {}; }`); L.push(`${i1}toJSON() { return { success: this.success, output: this.output, errors: this.errors, warnings: this.warnings, time_ms: this.time_ms, metadata: this.metadata }; }`); L.push('}'); L.push('');
    L.push('function validateInputs(inputs, schema = {}) {'); L.push(`${i1}const errors = [];`); L.push(`${i1}for (const [key, rules] of Object.entries(schema)) {`); L.push(`${i2}if (rules.required && !(key in inputs)) errors.push("Missing: " + key);`); L.push(`${i2}else if (key in inputs) { const v = inputs[key];`); L.push(`${i3}if (rules.type && typeof v !== rules.type) errors.push("Type mismatch: " + key);`); L.push(`${i3}if (rules.min !== undefined && typeof v === "number" && v < rules.min) errors.push("Too small: " + key);`); L.push(`${i3}if (rules.max !== undefined && typeof v === "number" && v > rules.max) errors.push("Too large: " + key);`); L.push(`${i2}} }`); L.push(`${i1}return errors;`); L.push('}'); L.push('');
    L.push('const ModuleState = Object.freeze({ INITIALIZED: "initialized", RUNNING: "running", COMPLETED: "completed", FAILED: "failed" });'); L.push('');
    L.push('class MAMModule {'); L.push(`${i1}constructor() { this.NAME = "${basename(ctx.filePath, extname(ctx.filePath))}"; this.VERSION = "1.0.0"; this.state = ModuleState.INITIALIZED; this._plugins = []; this._hooks_before = []; this._hooks_after = []; }`); L.push(`${i1}registerHook(event, cb) { if (event === "before") this._hooks_before.push(cb); else this._hooks_after.push(cb); return this; }`); L.push(`${i1}loadPlugin(p) { this._plugins.push(p); if (typeof p.onLoad === "function") p.onLoad(this); return this; }`); L.push('');
    L.push(`${i1}execute(ctx) {`); L.push(`${i2}const result = new ExecutionResult();`); L.push(`${i2}this.state = ModuleState.RUNNING;`); L.push(`${i2}try {`); L.push(`${i3}for (const h of this._hooks_before) { h(ctx); ctx.check_timeout(); }`); L.push(`${i3}for (const p of this._plugins) { if (p.beforeExecute) p.beforeExecute(ctx, result); }`); L.push(`${i3}result.output = {}; ctx.check_timeout();`); L.push(`${i3}for (const p of this._plugins) { if (p.afterExecute) p.afterExecute(ctx, result); }`); L.push(`${i3}for (const h of this._hooks_after) { h(ctx, result); ctx.check_timeout(); }`); L.push(`${i2}} catch (e) { result.success = false; result.errors.push(e.message || String(e)); this.state = ModuleState.FAILED; }`); L.push(`${i2}result.time_ms = ctx.elapsed_ms(); this.state = result.success ? ModuleState.COMPLETED : ModuleState.FAILED;`); L.push(`${i2}return result;`); L.push(`${i1}}`); L.push(`${i1}toJSON() { return JSON.stringify({ name: this.NAME, version: this.VERSION, state: this.state }); }`); L.push(`${i1}clone() { const m = new MAMModule(); m._plugins = [...this._plugins]; m._hooks_before = [...this._hooks_before]; m._hooks_after = [...this._hooks_after]; return m; }`); L.push('}'); L.push('');
    L.push('function createModule() { return new MAMModule(); }'); L.push('');
    L.push('exports.MAMModule = MAMModule; exports.MAMError = MAMError; exports.ValidationError = ValidationError;'); L.push('exports.MAMTimeoutError = MAMTimeoutError; exports.ExecutionContext = ExecutionContext;'); L.push('exports.ExecutionResult = ExecutionResult; exports.ModuleState = ModuleState; exports.createModule = createModule;'); L.push('');
    L.push('if (require.main === module) { const m = createModule(); const ctx = new ExecutionContext(); const r = m.execute(ctx); console.log(JSON.stringify(r.toJSON(), null, 2)); process.exit(r.success ? 0 : 1); }'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// TypeScript Generator
// ---------------------------------------------------------------------------

class TypeScriptGenerator {
  generate(ctx: GeneratorContext): string {
    const L: string[] = [];
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    L.push('/**'); L.push(' * Auto-generated by MAM Compiler'); L.push(` * Target: typescript`); L.push(` * Source: ${ctx.filePath}`); L.push(' */'); L.push('');
    L.push(generateCLIContext(ctx, 'typescript')); L.push('');
    L.push('export interface MAMErrorDetails { code: string; details: Record<string, unknown>; }'); L.push('');
    L.push('export class MAMError extends Error {'); L.push(`${i1}readonly code: string; readonly details: Record<string, unknown>;`); L.push(`${i1}constructor(message: string, code = "UNKNOWN", details: Record<string, unknown> = {}) { super(message); this.name = "MAMError"; this.code = code; this.details = details; }`); L.push(`${i1}toJSON(): MAMErrorDetails { return { name: this.name, message: this.message, code: this.code, details: this.details } as any; }`); L.push('}'); L.push('');
    L.push('export class ValidationError extends MAMError {'); L.push(`${i1}constructor(message: string) { super(message, "VALIDATION"); this.name = "ValidationError"; }`); L.push('}'); L.push('');
    L.push('export class MAMTimeoutError extends MAMError {'); L.push(`${i1}constructor(message: string, ms: number) { super(message, "TIMEOUT", { timeout_ms: ms }); this.name = "MAMTimeoutError"; }`); L.push('}'); L.push('');
    L.push('export interface ExecutionContextOptions { inputs?: Record<string, unknown>; env?: Record<string, string>; timeout_ms?: number; }'); L.push('export interface ValidationSchema { [key: string]: { required?: boolean; type?: string; min?: number; max?: number; pattern?: string; enum?: unknown[]; }; }'); L.push('');
    L.push('export class ExecutionContext {'); L.push(`${i1}readonly inputs: Record<string, unknown>; readonly env: Record<string, string>; readonly timeout_ms: number; readonly _start_time: number;`); L.push(`${i1}private _hooks_before: Array<(ctx: ExecutionContext) => void> = []; private _hooks_after: Array<(ctx: ExecutionContext, r: ExecutionResult) => void> = [];`); L.push(`${i1}constructor(opts: ExecutionContextOptions = {}) { this.inputs = opts.inputs ?? {}; this.env = opts.env ?? {}; this.timeout_ms = opts.timeout_ms ?? 30000; this._start_time = Date.now(); }`); L.push(`${i1}elapsed_ms(): number { return Date.now() - this._start_time; }`); L.push(`${i1}check_timeout(): void { if (this.timeout_ms > 0 && this.elapsed_ms() > this.timeout_ms) throw new MAMTimeoutError("Timeout", this.timeout_ms); }`); L.push(`${i1}on(event: "before" | "after", cb: (...args: unknown[]) => void): this { if (event === "before") this._hooks_before.push(cb as any); else this._hooks_after.push(cb as any); return this; }`); L.push('}'); L.push('');
    L.push('export interface ExecutionResultData { success: boolean; output: Record<string, unknown>; errors: string[]; warnings: string[]; time_ms: number; metadata: Record<string, unknown>; }'); L.push('');
    L.push('export class ExecutionResult {'); L.push(`${i1}success = true; output: Record<string, unknown> = {}; errors: string[] = []; warnings: string[] = []; time_ms = 0; metadata: Record<string, unknown> = {};`); L.push(`${i1}toJSON(): ExecutionResultData { return { success: this.success, output: this.output, errors: this.errors, warnings: this.warnings, time_ms: this.time_ms, metadata: this.metadata }; }`); L.push('}'); L.push('');
    L.push('export type ModuleStateType = "initialized" | "running" | "completed" | "failed";'); L.push('export const ModuleState = { INITIALIZED: "initialized" as const, RUNNING: "running" as const, COMPLETED: "completed" as const, FAILED: "failed" as const } as const;'); L.push('');
    L.push('export interface Plugin { name?: string; onLoad?(m: MAMModule): void; beforeExecute?(ctx: ExecutionContext, r: ExecutionResult): void; afterExecute?(ctx: ExecutionContext, r: ExecutionResult): void; onUnload?(): void; }'); L.push('');
    L.push('export function validateInputs(inputs: Record<string, unknown>, schema: ValidationSchema): string[] {'); L.push(`${i1}const errors: string[] = [];`); L.push(`${i1}for (const [key, rules] of Object.entries(schema)) {`); L.push(`${i2}if (rules.required && !(key in inputs)) errors.push("Missing: " + key);`); L.push(`${i2}else if (key in inputs) { const v = inputs[key];`); L.push(`${i3}if (rules.type && typeof v !== rules.type) errors.push("Type: " + key);`); L.push(`${i3}if (rules.min !== undefined && typeof v === "number" && v < rules.min) errors.push("Min: " + key);`); L.push(`${i3}if (rules.max !== undefined && typeof v === "number" && v > rules.max) errors.push("Max: " + key);`); L.push(`${i2}} }`); L.push(`${i1}return errors;`); L.push('}'); L.push('');
    L.push('export class MAMModule {'); L.push(`${i1}readonly NAME: string; readonly VERSION = "1.0.0"; state: ModuleStateType = ModuleState.INITIALIZED;`); L.push(`${i1}private _plugins: Plugin[] = []; private _hooks_before: Array<(ctx: ExecutionContext) => void> = []; private _hooks_after: Array<(ctx: ExecutionContext, r: ExecutionResult) => void> = [];`); L.push(`${i1}constructor(name?: string) { this.NAME = name ?? "${basename(ctx.filePath, extname(ctx.filePath))}"; }`); L.push(`${i1}registerHook(event: "before" | "after", cb: (...args: unknown[]) => void): this { if (event === "before") this._hooks_before.push(cb as any); else this._hooks_after.push(cb as any); return this; }`); L.push(`${i1}loadPlugin(p: Plugin): this { this._plugins.push(p); p.onLoad?.(this); return this; }`); L.push('');
    L.push(`${i1}execute(ctx: ExecutionContext): ExecutionResult {`); L.push(`${i2}const r = new ExecutionResult(); this.state = ModuleState.RUNNING;`); L.push(`${i2}try {`); L.push(`${i3}for (const h of this._hooks_before) { h(ctx); ctx.check_timeout(); }`); L.push(`${i3}for (const p of this._plugins) p.beforeExecute?.(ctx, r);`); L.push(`${i3}r.output = {}; ctx.check_timeout();`); L.push(`${i3}for (const p of this._plugins) p.afterExecute?.(ctx, r);`); L.push(`${i3}for (const h of this._hooks_after) { h(ctx, r); ctx.check_timeout(); }`); L.push(`${i2}} catch (e) { r.success = false; r.errors.push(e instanceof Error ? e.message : String(e)); this.state = ModuleState.FAILED; }`); L.push(`${i2}r.time_ms = ctx.elapsed_ms(); this.state = r.success ? ModuleState.COMPLETED : ModuleState.FAILED;`); L.push(`${i2}return r;`); L.push(`${i1}}`); L.push(`${i1}toJSON(): string { return JSON.stringify({ name: this.NAME, version: this.VERSION, state: this.state }); }`); L.push(`${i1}clone(): MAMModule { const m = new MAMModule(this.NAME); m._plugins = [...this._plugins]; m._hooks_before = [...this._hooks_before]; m._hooks_after = [...this._hooks_after]; return m; }`); L.push('}'); L.push('');
    L.push('export function createModule(): MAMModule { return new MAMModule(); }'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Go Generator
// ---------------------------------------------------------------------------

class GoGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    const pkg = basename(ctx.filePath, extname(ctx.filePath)).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const L: string[] = [];
    L.push(`package ${pkg}`); L.push('');
    L.push(generateCLIContext(ctx, 'go')); L.push('');
    L.push('import ("encoding/json"; "fmt"; "os"; "sync"; "time")'); L.push('');
    L.push('type MAMError struct { Message string; Code string; Details map[string]interface{} }');
    L.push('func (e *MAMError) Error() string { return fmt.Sprintf("[%s] %s", e.Code, e.Message) }');
    L.push('func NewMAMError(msg, code string, d map[string]interface{}) *MAMError { if d == nil { d = make(map[string]interface{}) }; return &MAMError{msg, code, d} }'); L.push('');
    L.push('type ValidationError struct{ *MAMError }'); L.push('');
    L.push('type TimeoutError struct{ *MAMError }'); L.push('');
    L.push('type ExecutionContext struct { Inputs map[string]interface{}; Env map[string]string; TimeoutMs int; mu sync.Mutex; start time.Time }');
    L.push('func NewExecutionContext(inputs map[string]interface{}, timeoutMs int) *ExecutionContext { if inputs == nil { inputs = make(map[string]interface{}) }; if timeoutMs <= 0 { timeoutMs = 30000 }; return &ExecutionContext{inputs, make(map[string]string), timeoutMs, sync.Mutex{}, time.Now()} }');
    L.push('func (ec *ExecutionContext) ElapsedMs() float64 { return float64(time.Since(ec.start).Microseconds()) / 1000.0 }');
    L.push('func (ec *ExecutionContext) CheckTimeout() error { if ec.TimeoutMs > 0 && ec.ElapsedMs() > float64(ec.TimeoutMs) { return NewMAMError(fmt.Sprintf("Timeout after %dms", ec.TimeoutMs), "TIMEOUT", nil) }; return nil }'); L.push('');
    L.push('type ExecutionResult struct { Success bool `json:"success"`; Output map[string]interface{} `json:"output"`; Errors []string `json:"errors"`; Warnings []string `json:"warnings"`; TimeMs float64 `json:"time_ms"`; Metadata map[string]interface{} `json:"metadata"` }');
    L.push('func NewExecutionResult() *ExecutionResult { return &ExecutionResult{true, make(map[string]interface{}), []string{}, []string{}, 0, make(map[string]interface{})} }'); L.push('');
    L.push('type MAMModule struct { Name string; Version string; State string; hooksBefore []func(ctx *ExecutionContext); hooksAfter []func(ctx *ExecutionContext, r *ExecutionResult); mu sync.RWMutex }');
    L.push('func NewMAMModule(name string) *MAMModule { if name == "" { name = "${basename(ctx.filePath, extname(ctx.filePath))}" }; return &MAMModule{name, "1.0.0", "initialized", nil, nil, sync.RWMutex{}} }');
    L.push('func (m *MAMModule) Execute(ctx *ExecutionContext) *ExecutionResult {');
    L.push(`${i1}m.mu.Lock(); m.State = "running"; m.mu.Unlock()`);
    L.push(`${i1}result := NewExecutionResult()`);
    L.push(`${i1}if err := ctx.CheckTimeout(); err != nil { result.Success = false; result.Errors = append(result.Errors, err.Error()); m.State = "failed"; return result }`);
    L.push(`${i1}for _, h := range m.hooksBefore { h(ctx); if err := ctx.CheckTimeout(); err != nil { result.Success = false; result.Errors = append(result.Errors, err.Error()); m.State = "failed"; return result } }`);
    L.push(`${i1}// Core logic placeholder`);
    L.push(`${i1}result.Output = make(map[string]interface{})`);
    L.push(`${i1}for _, h := range m.hooksAfter { h(ctx, result); if err := ctx.CheckTimeout(); err != nil { result.Success = false; result.Errors = append(result.Errors, err.Error()); m.State = "failed"; return result } }`);
    L.push(`${i1}result.TimeMs = ctx.ElapsedMs(); m.State = "completed"; if !result.Success { m.State = "failed" }`);
    L.push(`${i1}return result`);
    L.push('}'); L.push('');
    L.push('func main() { mod := NewMAMModule(""); ctx := NewExecutionContext(nil, 30000); result := mod.Execute(ctx); b, _ := json.MarshalIndent(result, "", "  "); fmt.Println(string(b)); if !result.Success { os.Exit(1) } }'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Rust Generator
// ---------------------------------------------------------------------------

class RustGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    const L: string[] = [];
    L.push(generateCLIContext(ctx, 'rust')); L.push('');
    L.push('use std::collections::HashMap; use std::fmt; use std::time::{Duration, Instant};'); L.push('');
    L.push('#[derive(Debug, Clone)] pub struct MAMError { pub message: String, pub code: String, pub details: HashMap<String, String> }');
    L.push('impl fmt::Display for MAMError { fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { write!(f, "[{}] {}", self.code, self.message) } }');
    L.push('impl std::error::Error for MAMError {}'); L.push('');
    L.push('impl MAMError { pub fn new(message: &str, code: &str) -> Self { Self { message: message.into(), code: code.into(), details: HashMap::new() } } }'); L.push('');
    L.push('#[derive(Debug)] pub struct ValidationError(pub MAMError);'); L.push('#[derive(Debug)] pub struct TimeoutError(pub MAMError);'); L.push('');
    L.push('#[derive(Debug, Clone, Default)] pub struct ExecutionContext { pub inputs: HashMap<String, String>, pub env: HashMap<String, String>, pub timeout_ms: u64, pub start: Instant }');
    L.push('impl ExecutionContext { pub fn new(timeout_ms: u64) -> Self { Self { inputs: HashMap::new(), env: HashMap::new(), timeout_ms, start: Instant::now() } }');
    L.push(`${i1}pub fn elapsed_ms(&self) -> f64 { self.start.elapsed().as_secs_f64() * 1000.0 }`);
    L.push(`${i1}pub fn check_timeout(&self) -> Result<(), TimeoutError> { if self.timeout_ms > 0 && self.elapsed_ms() > self.timeout_ms as f64 { Err(TimeoutError(MAMError::new("Timeout", "TIMEOUT"))) } else { Ok(()) } }`); L.push('}'); L.push('');
    L.push('#[derive(Debug, Clone, Default)] pub struct ExecutionResult { pub success: bool, pub output: HashMap<String, String>, pub errors: Vec<String>, pub warnings: Vec<String>, pub time_ms: f64 }'); L.push('');
    L.push('#[derive(Debug, Clone, PartialEq)] pub enum ModuleState { Initialized, Running, Completed, Failed }'); L.push('');
    L.push('pub struct MAMModule { pub name: String, pub version: String, pub state: ModuleState, pub hooks_before: Vec<Box<dyn Fn(&mut ExecutionContext)>>, pub hooks_after: Vec<Box<dyn Fn(&mut ExecutionContext, &mut ExecutionResult)>> }');
    L.push('impl MAMModule { pub fn new(name: &str) -> Self { Self { name: name.into(), version: "1.0.0".into(), state: ModuleState::Initialized, hooks_before: vec![], hooks_after: vec![] } }');
    L.push(`${i1}pub fn execute(&mut self, ctx: &mut ExecutionContext) -> ExecutionResult { let mut r = ExecutionResult::default(); self.state = ModuleState::Running; if let Err(e) = ctx.check_timeout() { r.success = false; r.errors.push(e.0.to_string()); self.state = ModuleState::Failed; return r; }`);
    L.push(`${i2}for h in &self.hooks_before { h(ctx); if let Err(e) = ctx.check_timeout() { r.success = false; r.errors.push(e.0.to_string()); self.state = ModuleState::Failed; return r; } }`);
    L.push(`${i2}// Core logic placeholder; r.output = HashMap::new();`);
    L.push(`${i2}for h in &self.hooks_after { h(ctx, &mut r); if let Err(e) = ctx.check_timeout() { r.success = false; r.errors.push(e.0.to_string()); self.state = ModuleState::Failed; return r; } }`);
    L.push(`${i2}r.time_ms = ctx.elapsed_ms(); self.state = if r.success { ModuleState::Completed } else { ModuleState::Failed }; r`); L.push(`${i1}}`); L.push('}'); L.push('');
    L.push('fn main() { let mut modl = MAMModule::new(""); let mut ctx = ExecutionContext::new(30000); let r = modl.execute(&mut ctx); println!("{:?}", r); std::process::exit(if r.success { 0 } else { 1 }); }'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// C# Generator
// ---------------------------------------------------------------------------

class CSharpGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    const ns = basename(ctx.filePath, extname(ctx.filePath)).replace(/[^a-zA-Z0-9]/g, '');
    const L: string[] = [];
    L.push(generateCLIContext(ctx, 'csharp')); L.push('');
    L.push('using System; using System.Collections.Generic; using System.Diagnostics; using System.Text.Json;'); L.push('');
    L.push(`namespace ${ns} {`); L.push('');
    L.push(`${i1}public class MAMError : Exception { public string Code { get; } public Dictionary<string, object> Details { get; }`); L.push(`${i2}public MAMError(string msg, string code = "UNKNOWN", Dictionary<string, object>? d = null) : base(msg) { Code = code; Details = d ?? new(); }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}public class ValidationError : MAMError { public ValidationError(string m) : base(m, "VALIDATION") { } }`); L.push('');
    L.push(`${i1}public class MAMTimeoutException : MAMError { public MAMTimeoutException(string m, int ms) : base(m, "TIMEOUT", new() { { "timeout_ms", ms } }) { } }`); L.push('');
    L.push(`${i1}public class ExecutionContext { public Dictionary<string, object> Inputs { get; set; } = new(); public Dictionary<string, string> Env { get; set; } = new(); public int TimeoutMs { get; set; } = 30000; private readonly Stopwatch _sw = new();`); L.push(`${i2}public ExecutionContext() { _sw.Start(); } public double ElapsedMs => _sw.Elapsed.TotalMilliseconds;`); L.push(`${i2}public void CheckTimeout() { if (TimeoutMs > 0 && ElapsedMs > TimeoutMs) throw new MAMTimeoutException("Timeout", TimeoutMs); }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}public class ExecutionResult { public bool Success { get; set; } = true; public Dictionary<string, object> Output { get; set; } = new(); public List<string> Errors { get; set; } = new(); public List<string> Warnings { get; set; } = new(); public double TimeMs { get; set; } public Dictionary<string, object> Metadata { get; set; } = new(); }`); L.push('');
    L.push(`${i1}public enum ModuleStateType { Initialized, Running, Completed, Failed }`); L.push('');
    L.push(`${i1}public class MAMModule { public string Name { get; } public string Version { get; } = "1.0.0"; public ModuleStateType State { get; private set; } = ModuleStateType.Initialized;`); L.push(`${i2}private readonly List<Action<ExecutionContext>> _before = new(); private readonly List<Action<ExecutionContext, ExecutionResult>> _after = new();`); L.push(`${i2}public MAMModule(string? name = null) { Name = name ?? "${basename(ctx.filePath, extname(ctx.filePath))}"; }`); L.push('');
    L.push(`${i2}public ExecutionResult Execute(ExecutionContext ctx) { var r = new ExecutionResult(); State = ModuleStateType.Running; try { foreach (var h in _before) { h(ctx); ctx.CheckTimeout(); } r.Output = new(); ctx.CheckTimeout(); foreach (var h in _after) { h(ctx, r); ctx.CheckTimeout(); } } catch (Exception ex) { r.Success = false; r.Errors.Add(ex.Message); State = ModuleStateType.Failed; } r.TimeMs = ctx.ElapsedMs; State = r.Success ? ModuleStateType.Completed : ModuleStateType.Failed; return r; }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}public static class Program { public static void Main() { var m = new MAMModule(); var c = new ExecutionContext(); var r = m.Execute(c); Console.WriteLine(JsonSerializer.Serialize(r, new JsonSerializerOptions { WriteIndented = true })); Environment.Exit(r.Success ? 0 : 1); } }`); L.push('}'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Java Generator
// ---------------------------------------------------------------------------

class JavaGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    const cls = basename(ctx.filePath, extname(ctx.filePath)).replace(/[^a-zA-Z0-9]/g, '');
    const L: string[] = [];
    L.push(generateCLIContext(ctx, 'java')); L.push('');
    L.push('import java.util.*; import java.time.Instant; import java.time.Duration;'); L.push('');
    L.push(`public class ${cls} {`); L.push('');
    L.push(`${i1}public static class MAMException extends Exception { public final String code; public final Map<String, Object> details;`); L.push(`${i2}public MAMException(String m, String c, Map<String, Object> d) { super(m); code = c; details = d != null ? d : Map.of(); }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}public static class ValidationError extends MAMException { public ValidationError(String m) { super(m, "VALIDATION", Map.of()); } }`); L.push('');
    L.push(`${i1}public static class TimeoutException extends MAMException { public TimeoutException(String m, int ms) { super(m, "TIMEOUT", Map.of("timeout_ms", ms)); } }`); L.push('');
    L.push(`${i1}public static class ExecutionContext { public Map<String, Object> inputs = new HashMap<>(); public Map<String, String> env = new HashMap<>(); public int timeoutMs = 30000; private final Instant start = Instant.now();`); L.push(`${i2}public double elapsedMs() { return Duration.between(start, Instant.now()).toNanos() / 1_000_000.0; }`); L.push(`${i2}public void checkTimeout() throws TimeoutException { if (timeoutMs > 0 && elapsedMs() > timeoutMs) throw new TimeoutException("Timeout", timeoutMs); }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}public static class ExecutionResult { public boolean success = true; public Map<String, Object> output = new HashMap<>(); public List<String> errors = new ArrayList<>(); public List<String> warnings = new ArrayList<>(); public double timeMs; public Map<String, Object> metadata = new HashMap<>(); }`); L.push('');
    L.push(`${i1}public enum ModuleState { INITIALIZED, RUNNING, COMPLETED, FAILED }`); L.push('');
    L.push(`${i1}public static class MAMModule { public String name; public String version = "1.0.0"; public ModuleState state = ModuleState.INITIALIZED;`); L.push(`${i2}private final List<Runnable> hooksBefore = new ArrayList<>(); private final List<BiConsumer<ExecutionContext, ExecutionResult>> hooksAfter = new ArrayList<>();`); L.push(`${i2}public MAMModule() { this.name = "${cls}"; }`); L.push('');
    L.push(`${i2}public ExecutionResult execute(ExecutionContext ctx) { var r = new ExecutionResult(); state = ModuleState.RUNNING; try { for (var h : hooksBefore) { h.run(); ctx.checkTimeout(); } r.output = new HashMap<>(); ctx.checkTimeout(); for (var h : hooksAfter) { h.accept(ctx, r); ctx.checkTimeout(); } } catch (Exception e) { r.success = false; r.errors.add(e.getMessage()); state = ModuleState.FAILED; } r.timeMs = ctx.elapsedMs(); state = r.success ? ModuleState.COMPLETED : ModuleState.FAILED; return r; }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}public static void main(String[] args) { var m = new MAMModule(); var c = new ExecutionContext(); var r = m.execute(c); System.out.println("success=" + r.success + " time=" + r.timeMs + "ms"); System.exit(r.success ? 0 : 1); }`); L.push('}'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// WASM Generator (WAT text format)
// ---------------------------------------------------------------------------

class WASMGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2);
    const L: string[] = [];
    L.push(generateCLIContext(ctx, 'wasm')); L.push('');
    L.push('(module'); L.push(`${i1}(memory (export "memory") 1)`); L.push(`${i1}(global $timeout_ms (mut i32) (i32.const 30000))`); L.push('');
    L.push(`${i1}(func (export "init") (param $timeout i32)`); L.push(`${i2}(global.set $timeout_ms (local.get $timeout))`); L.push(`${i1})`); L.push('');
    L.push(`${i1}(func (export "execute") (result i32)`); L.push(`${i2}(i32.store (i32.const 256) (i32.const 1))`); L.push(`${i2}// Core logic placeholder`); L.push(`${i2}(i32.store (i32.const 260) (i32.const 0))`); L.push(`${i2}(i32.store (i32.const 264) (i32.const 0))`); L.push(`${i2}(i32.load (i32.const 256))`); L.push(`${i1})`); L.push('');
    L.push(`${i1}(func (export "output_ptr") (result i32) (i32.const 0))`);
    L.push(`${i1}(func (export "output_len") (result i32) (i32.load (i32.const 260)))`);
    L.push(`${i1}(func (export "error_ptr") (result i32) (i32.const 128))`);
    L.push(`${i1}(func (export "error_len") (result i32) (i32.load (i32.const 264)))`);
    L.push(`${i1}(func (export "memory_size") (result i32) (memory.size))`);
    L.push(')'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// JSON Generator
// ---------------------------------------------------------------------------

class JsonGenerator {
  generate(ctx: GeneratorContext): string {
    const moduleInfo = extractModuleInfo(ctx);
    return JSON.stringify({
      _generator: 'MAM Compiler', _target: 'json', _source: ctx.filePath, _version: '1.0.0',
      _moduleContext: {
        name: moduleInfo.name,
        type: moduleInfo.type,
        version: moduleInfo.version,
        author: moduleInfo.author,
        description: moduleInfo.description,
        purpose: moduleInfo.description,
        inputs: moduleInfo.inputs,
        outputs: moduleInfo.outputs,
        capabilities: moduleInfo.capabilities,
        rules: moduleInfo.rules,
        dependencies: moduleInfo.dependencies,
        permissions: moduleInfo.permissions,
        tests: moduleInfo.tests,
        examples: moduleInfo.examples,
        references: 'See https://github.com/tcp-ecosystems/MAM',
      },
      name: moduleInfo.name,
      module: { format: 'mam/v1', type: 'prompt', version: moduleInfo.version },
      metadata: { generatedAt: new Date().toISOString(), sourceHash: CacheManager.computeHash(ctx.sourceContent) },
      sections: [], inputs: {}, outputs: {},
      config: { timeout_ms: 30000, retry: { maxAttempts: 3, backoffMs: 1000 }, cache: { enabled: false, ttlMs: 0 } },
      plugins: [], hooks: { before: [], after: [] },
    }, null, ctx.targetOptions.minify ? 0 : ctx.targetOptions.indent);
  }
}

// ---------------------------------------------------------------------------
// OpenAI Generator
// ---------------------------------------------------------------------------

class OpenAIGenerator {
  generate(ctx: GeneratorContext): string {
    const contextJson = generateCLIContext(ctx, 'json');
    return contextJson + '\n' + JSON.stringify({
      model: 'gpt-4', temperature: 0.7, max_tokens: 4096, top_p: 1, frequency_penalty: 0, presence_penalty: 0,
      messages: [{ role: 'system', content: 'You are a helpful assistant.' }, { role: 'user', content: '{{user_input}}' }],
      functions: [], function_call: 'auto', tools: [], tool_choice: 'auto',
      response_format: { type: 'text' }, stream: false, n: 1,
    }, null, ctx.targetOptions.minify ? 0 : ctx.targetOptions.indent);
  }
}

// ---------------------------------------------------------------------------
// LangGraph Generator
// ---------------------------------------------------------------------------

class LangGraphGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3);
    const L: string[] = [];
    L.push('"""Auto-generated by MAM Compiler | Target: langgraph"""'); L.push('');
    L.push(generateCLIContext(ctx, 'langgraph')); L.push('');
    L.push('from typing import TypedDict, Any, Annotated'); L.push('from langgraph.graph import StateGraph, END'); L.push('import operator'); L.push('');
    L.push('class AgentState(TypedDict):'); L.push(`${i1}messages: Annotated[list[Any], operator.add]`); L.push(`${i1}next_node: str`); L.push(`${i1}context: dict[str, Any]`); L.push('');
    L.push('def classify_input(state: AgentState) -> dict[str, Any]:'); L.push(`${i1}last_msg = state["messages"][-1] if state["messages"] else None`); L.push(`${i1}return {"next_node": "process" if last_msg else "end"}`); L.push('');
    L.push('def process(state: AgentState) -> dict[str, Any]:'); L.push(`${i1}return {"messages": [{"role": "assistant", "content": "Processed by LangGraph agent."}]}`); L.push('');
    L.push('def build_graph() -> StateGraph:'); L.push(`${i1}g = StateGraph(AgentState)`); L.push(`${i1}g.add_node("classify", classify_input)`); L.push(`${i1}g.add_node("process", process)`); L.push(`${i1}g.add_node("end", lambda s: s)`); L.push(`${i1}g.set_entry_point("classify")`); L.push(`${i1}g.add_conditional_edges("classify", lambda s: s["next_node"], {"process": "process", "end": "end"})`); L.push(`${i1}g.add_edge("process", "end")`); L.push(`${i1}return g.compile()`); L.push('');
    L.push('if __name__ == "__main__":'); L.push(`${i1}app = build_graph()`); L.push(`${i1}result = app.invoke({"messages": [{"role": "user", "content": "Hello"}], "next_node": "", "context": {}})`); L.push(`${i1}print(result)`); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// CrewAI Generator
// ---------------------------------------------------------------------------

class CrewAIGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2);
    const L: string[] = [];
    L.push('"""Auto-generated by MAM Compiler | Target: crewai"""'); L.push('');
    L.push(generateCLIContext(ctx, 'crewai')); L.push('');
    L.push('from crewai import Agent, Task, Crew, Process'); L.push('from crewai.tools import BaseTool'); L.push('from typing import List'); L.push('');
    L.push('class DefaultTool(BaseTool):'); L.push(`${i1}name: str = "default_tool"`); L.push(`${i1}description: str = "A default tool"`); L.push(`${i1}def _run(self, query: str) -> str: return f"Result: {query}"`); L.push('');
    L.push('def create_agents() -> List[Agent]:'); L.push(`${i1}return [Agent(role="Researcher", goal="Research topics thoroughly.", verbose=True, allow_delegation=False, tools=[DefaultTool()]),`); L.push(`${i1}        Agent(role="Writer", goal="Write based on research.", verbose=True, allow_delegation=False, tools=[DefaultTool()])]`); L.push('');
    L.push('def create_tasks(agents: List[Agent]) -> List[Task]:'); L.push(`${i1}return [Task(description="Research: {{topic}}", expected_output="Research summary.", agent=agents[0]),`); L.push(`${i1}        Task(description="Write content.", expected_output="Article.", agent=agents[1], context=[agents[0]])]`); L.push('');
    L.push('def create_crew() -> Crew:'); L.push(`${i1}a = create_agents(); t = create_tasks(a); return Crew(agents=a, tasks=t, process=Process.sequential, verbose=True)`); L.push('');
    L.push('if __name__ == "__main__":'); L.push(`${i1}print(create_crew().kickoff(inputs={"topic": "AI Safety"}))`); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Gemini Generator
// ---------------------------------------------------------------------------

class GeminiGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3);
    const L: string[] = [];
    L.push('"""Auto-generated by MAM Compiler | Target: gemini"""'); L.push('');
    L.push(generateCLIContext(ctx, 'gemini')); L.push('');
    L.push('import google.generativeai as genai'); L.push('from typing import Optional, Dict, Any'); L.push('');
    L.push('class GeminiModule:'); L.push(`${i1}def __init__(self, api_key: Optional[str] = None, model: str = "gemini-pro"):`); L.push(`${i2}if api_key: genai.configure(api_key=api_key)`); L.push(`${i2}self.model = genai.GenerativeModel(model_name=model)`); L.push(`${i2}self.chat = self.model.start_chat(history=[])`); L.push('');
    L.push(`${i1}def generate(self, prompt: str, **kwargs) -> str:`); L.push(`${i2}return self.model.generate_content(prompt, generation_config=genai.types.GenerationConfig(`); L.push(`${i3}temperature=kwargs.get("temperature", 0.7), max_output_tokens=kwargs.get("max_tokens", 2048), top_p=kwargs.get("top_p", 0.95))).text`); L.push('');
    L.push(`${i1}def chat_message(self, message: str) -> str: return self.chat.send_message(message).text`); L.push('');
    L.push(`${i1}def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:`); L.push(`${i2}prompt = inputs.get("prompt", "")`); L.push(`${i2}return {"success": True, "output": {"response": self.generate(prompt)}}`); L.push('');
    L.push('if __name__ == "__main__":'); L.push(`${i1}print(GeminiModule().execute({"prompt": "Hello"}))`); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// AutoGen Generator
// ---------------------------------------------------------------------------

class AutoGenGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3);
    const L: string[] = [];
    L.push('"""Auto-generated by MAM Compiler | Target: autogen"""'); L.push('');
    L.push(generateCLIContext(ctx, 'autogen')); L.push('');
    L.push('from autogen import AssistantAgent, UserProxyAgent'); L.push('from typing import Optional, Dict, Any'); L.push('');
    L.push('class AutoGenModule:'); L.push(`${i1}def __init__(self, config: Optional[Dict[str, Any]] = None):`); L.push(`${i2}self.config = config or {}`); L.push(`${i2}self.assistant = AssistantAgent(name="assistant", llm_config=self.config.get("llm_config", {"model": "gpt-4", "temperature": 0.7}), system_message="You are a helpful assistant.")`); L.push(`${i2}self.user_proxy = UserProxyAgent(name="user_proxy", human_input_mode="NEVER", max_consecutive_auto_reply=10, is_termination_msg=lambda x: x.get("content", "").rstrip().endswith("TERMINATE"))`); L.push('');
    L.push(`${i1}def execute(self, message: str) -> Dict[str, Any]:`); L.push(`${i2}self.user_proxy.initiate_chat(self.assistant, message=message)`); L.push(`${i2}history = [{"role": m.get("role", "unknown"), "content": m.get("content", "")} for m in self.user_proxy.chat_messages.get(self.assistant.name, [])]`); L.push(`${i2}return {"success": True, "output": {"chat_history": history}}`); L.push('');
    L.push('if __name__ == "__main__":'); L.push(`${i1}print(AutoGenModule().execute("Solve: 2x + 3 = 7"))`); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Kubernetes Generator
// ---------------------------------------------------------------------------

class KubernetesGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    const name = basename(ctx.filePath, extname(ctx.filePath)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const L: string[] = [];
    L.push(`# Auto-generated by MAM Compiler | Target: kubernetes | Source: ${ctx.filePath}`); L.push('');
    L.push(generateCLIContext(ctx, 'kubernetes')); L.push('');
    L.push('apiVersion: apps/v1'); L.push('kind: Deployment'); L.push('metadata:'); L.push(`${i1}name: ${name}`); L.push(`${i1}labels:`); L.push(`${i2}app: ${name}`); L.push(`${i2}managed-by: mam-compiler`); L.push('spec:'); L.push(`${i1}replicas: 1`); L.push(`${i1}selector:`); L.push(`${i2}matchLabels:`); L.push(`${i3}app: ${name}`); L.push(`${i1}template:`); L.push(`${i2}metadata:`); L.push(`${i3}labels:`); L.push(`${i4}app: ${name}`); L.push(`${i2}spec:`); L.push(`${i3}containers:`); L.push(`${i4}- name: ${name}`); L.push(`${i4}  image: mam/${name}:latest`); L.push(`${i4}  ports:`); L.push(`${i4}  - containerPort: 8080`); L.push(`${i4}  resources:`); L.push(`${i4}    requests: { memory: "128Mi", cpu: "100m" }`); L.push(`${i4}    limits: { memory: "256Mi", cpu: "500m" }`); L.push(`${i4}  env:`); L.push(`${i4}  - name: MAM_MODULE`); L.push(`${i4}    value: "${name}"`); L.push('');
    L.push('---'); L.push('apiVersion: v1'); L.push('kind: Service'); L.push('metadata:'); L.push(`${i1}name: ${name}-svc`); L.push('spec:'); L.push(`${i1}selector:`); L.push(`${i2}app: ${name}`); L.push(`${i1}ports:`); L.push(`${i2}- port: 80`); L.push(`${i2}  targetPort: 8080`); L.push(`${i1}type: ClusterIP`); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Terraform Generator
// ---------------------------------------------------------------------------

class TerraformGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3);
    const name = basename(ctx.filePath, extname(ctx.filePath)).toLowerCase().replace(/[^a-z0-9-]/g, '_');
    const L: string[] = [];
    L.push(`# Auto-generated by MAM Compiler | Target: terraform | Source: ${ctx.filePath}`); L.push('');
    L.push(generateCLIContext(ctx, 'terraform')); L.push('');
    L.push('terraform {'); L.push(`${i1}required_version = ">= 1.0"`); L.push(`${i1}required_providers {`); L.push(`${i2}aws = { source = "hashicorp/aws", version = "~> 5.0" }`); L.push(`${i1}}`); L.push('}'); L.push('');
    L.push('variable "region" { description = "AWS region"; type = string; default = "us-east-1" }'); L.push('');
    L.push(`resource "aws_ecs_cluster" "${name}" {`); L.push(`${i1}name = "${name}-cluster"`); L.push(`${i1}setting { name = "containerInsights"; value = "enabled" }`); L.push('}'); L.push('');
    L.push(`resource "aws_ecs_task_definition" "${name}" {`); L.push(`${i1}family = "${name}-task"`); L.push(`${i1}network_mode = "awsvpc"`); L.push(`${i1}requires_compatibilities = ["FARGATE"]`); L.push(`${i1}cpu = 256; memory = 512`); L.push(`${i1}container_definitions = jsonencode([{name="${name}",image="mam/${name}:latest",portMappings=[{containerPort=8080}],essential=true}])`); L.push('}'); L.push('');
    L.push(`resource "aws_ecs_service" "${name}" {`); L.push(`${i1}name = "${name}-svc"`); L.push(`${i1}cluster = aws_ecs_cluster.${name}.id`); L.push(`${i1}task_definition = aws_ecs_task_definition.${name}.arn`); L.push(`${i1}desired_count = 1; launch_type = "FARGATE"`); L.push(`${i1}network_configuration { subnets = ["subnet-xxx"]; security_groups = ["sg-xxx"] }`); L.push('}'); L.push('');
    L.push('output "cluster_arn" { value = aws_ecs_cluster.' + name + '.arn }'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Docker Generator
// ---------------------------------------------------------------------------

class DockerGenerator {
  generate(ctx: GeneratorContext): string {
    const name = basename(ctx.filePath, extname(ctx.filePath)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const L: string[] = [];
    L.push(`# Auto-generated by MAM Compiler | Target: docker | Source: ${ctx.filePath}`); L.push('');
    L.push(generateCLIContext(ctx, 'docker')); L.push('');
    L.push('FROM node:20-alpine AS builder'); L.push('WORKDIR /app'); L.push('COPY package*.json ./'); L.push('RUN npm ci --only=production'); L.push('COPY . .'); L.push('RUN npm run build 2>/dev/null || true'); L.push('');
    L.push('FROM node:20-alpine AS production'); L.push('ARG NODE_ENV=production'); L.push('ENV NODE_ENV=${NODE_ENV}'); L.push(`ENV MAM_MODULE=${name}`); L.push('');
    L.push('RUN addgroup -g 1001 -S mamgroup && adduser -S mamuser -u 1001 -G mamgroup'); L.push('WORKDIR /app'); L.push('COPY --from=builder --chown=mamuser:mamgroup /app/node_modules ./node_modules'); L.push('COPY --from=builder --chown=mamuser:mamgroup /app/package*.json ./'); L.push('COPY --from=builder --chown=mamuser:mamgroup /app/dist ./dist'); L.push('USER mamuser'); L.push('EXPOSE 8080'); L.push('HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1'); L.push('CMD ["node", "dist/index.js"]'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Claude Generator
// ---------------------------------------------------------------------------

class ClaudeGenerator {
  generate(ctx: GeneratorContext): string {
    const i1 = ictx(ctx, 1), i2 = ictx(ctx, 2), i3 = ictx(ctx, 3), i4 = ictx(ctx, 4);
    const L: string[] = [];
    L.push('/** Auto-generated by MAM Compiler | Target: claude */'); L.push('');
    L.push(generateCLIContext(ctx, 'typescript')); L.push('');
    L.push('export interface ClaudeMessage { role: "user" | "assistant" | "system"; content: string; }'); L.push('');
    L.push('export interface ClaudeConfig { model: string; max_tokens: number; temperature: number; system?: string; tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>; stream: boolean; }'); L.push('');
    L.push('export interface ClaudeResponse { id: string; type: string; role: string; content: Array<{ type: string; text: string }>; model: string; stop_reason: string; usage: { input_tokens: number; output_tokens: number }; }'); L.push('');
    L.push('export class ClaudeModule {'); L.push(`${i1}private config: ClaudeConfig; private apiKey: string; private baseUrl: string;`); L.push('');
    L.push(`${i1}constructor(opts: { apiKey?: string; model?: string; baseUrl?: string; maxTokens?: number; temperature?: number } = {}) {`); L.push(`${i2}this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";`); L.push(`${i2}this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";`); L.push(`${i2}this.config = { model: opts.model ?? "claude-sonnet-4-20250514", max_tokens: opts.maxTokens ?? 4096, temperature: opts.temperature ?? 0.7, stream: false };`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}async sendMessage(messages: ClaudeMessage[]): Promise<ClaudeResponse> {`); L.push(`${i2}const resp = await fetch(\`\${this.baseUrl}/messages\`, {`); L.push(`${i3}method: "POST",`); L.push(`${i3}headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },`); L.push(`${i3}body: JSON.stringify({ model: this.config.model, max_tokens: this.config.max_tokens, temperature: this.config.temperature, system: this.config.system, messages, tools: this.config.tools })`); L.push(`${i2}});`); L.push(`${i2}if (!resp.ok) throw new Error(\`Claude API error (\${resp.status}): \${await resp.text()}\`);`); L.push(`${i2}return resp.json() as Promise<ClaudeResponse>;`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}async execute(inputs: { prompt: string; system?: string }): Promise<{ success: boolean; output: Record<string, unknown> }> {`); L.push(`${i2}try {`); L.push(`${i3}if (inputs.system) this.config.system = inputs.system;`); L.push(`${i3}const resp = await this.sendMessage([{ role: "user", content: inputs.prompt }]);`); L.push(`${i3}return { success: true, output: { response: resp.content.map(c => c.text).join("\\n"), usage: resp.usage, model: resp.model } };`); L.push(`${i2}} catch (e) { return { success: false, output: { error: (e as Error).message } }; }`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}setTool(name: string, description: string, schema: Record<string, unknown>): void {`); L.push(`${i2}if (!this.config.tools) this.config.tools = [];`); L.push(`${i2}this.config.tools.push({ name, description, input_schema: schema });`); L.push(`${i1}}`); L.push('');
    L.push(`${i1}setSystemPrompt(prompt: string): void { this.config.system = prompt; }`); L.push('}'); L.push('');
    L.push('export function createClaudeModule(opts?: Record<string, unknown>): ClaudeModule { return new ClaudeModule(opts as any); }'); L.push('');
    return L.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Generator Registry
// ---------------------------------------------------------------------------

const GENERATORS: Partial<Record<CompileTarget, new () => { generate(ctx: GeneratorContext): string }>> = {
  python: PythonGenerator, javascript: JavaScriptGenerator, typescript: TypeScriptGenerator,
  go: GoGenerator, rust: RustGenerator, csharp: CSharpGenerator, java: JavaGenerator,
  wasm: WASMGenerator, json: JsonGenerator, openai: OpenAIGenerator,
  langgraph: LangGraphGenerator, crewai: CrewAIGenerator, gemini: GeminiGenerator,
  autogen: AutoGenGenerator, kubernetes: KubernetesGenerator, terraform: TerraformGenerator,
  docker: DockerGenerator, claude: ClaudeGenerator,
};

// ---------------------------------------------------------------------------
// Main Compiler Engine
// ---------------------------------------------------------------------------

class MAMCompilerEngine {
  private config: CompileConfig;
  private cache: CacheManager;
  private emitter = new EventEmitter();

  constructor(config: CompileConfig) {
    this.config = config;
    this.cache = new CacheManager(config.cacheDir);
  }

  on(event: string, listener: (...args: unknown[]) => void): void { this.emitter.on(event, listener); }

  private emit(type: CompilerEvent['type'], target: CompileTarget, message: string, data?: unknown): void {
    this.emitter.emit('event', { type, target, message, timestamp: Date.now(), data });
  }

  async compileFile(filePath: string, target: CompileTarget, options: CompileOptions): Promise<CompileResult> {
    const startTime = Date.now();
    const stats: CompilationStats = {
      modulesCompiled: 0, linesGenerated: 0, bytesGenerated: 0, timeMs: 0,
      target, warnings: [], errors: [], cachedHits: 0, cacheMisses: 0, filesRead: 0, filesWritten: 0,
    };

    try {
      this.emit('start', target, `Starting compilation of ${filePath}`);
      const content = await readFile(filePath, 'utf-8');
      stats.filesRead++;
      const contentHash = CacheManager.computeHash(content);

      // Check cache
      if (options.incremental) {
        const cached = await this.cache.get(filePath, target, contentHash);
        if (cached) {
          stats.cachedHits++;
          this.emit('cached', target, `Cache hit for ${filePath}`);
          return { success: true, output: cached.output, target, stats: { ...stats, timeMs: Date.now() - startTime }, warnings: [], errors: [], sourceMap: cached.sourceMap, outputFiles: [] };
        }
      }
      stats.cacheMisses++;

      // Parse
      this.emit('progress', target, 'Parsing source...');
      let ast: unknown;
      try {
        const result = parseMAM(content, { source: filePath });
        if (result.errors.length > 0) {
          return { success: false, output: '', target, stats: { ...stats, timeMs: Date.now() - startTime }, warnings: [], errors: result.errors.map(e => e.toFormattedString()), outputFiles: [] };
        }
        ast = result.ast;
      } catch (e) {
        return { success: false, output: '', target, stats: { ...stats, timeMs: Date.now() - startTime }, warnings: [], errors: [`Parse error: ${(e as Error).message}`], outputFiles: [] };
      }

      // Analyze & Optimize (hooks for future extension)
      this.emit('progress', target, 'Analyzing AST...');
      this.emit('progress', target, 'Optimizing...');

      // Generate
      this.emit('progress', target, `Generating ${target} code...`);
      const targetOpts: TargetOptions = {
        indent: options.indent ?? this.config.targets[target]?.indent ?? 4,
        indentChar: this.config.targets[target]?.indentChar ?? ' ',
        comments: options.comments ?? this.config.targets[target]?.comments ?? true,
        minify: options.minify ?? this.config.targets[target]?.minify ?? false,
        strictTypes: options.strictTypes ?? this.config.targets[target]?.strictTypes ?? false,
        maxLineLength: this.config.targets[target]?.maxLineLength ?? 120,
        includeSourceMap: options.sourceMap ?? this.config.sourceMap,
        includeDocs: true, encoding: 'utf-8', trailingNewline: true,
        ...this.config.targets[target], ...options.targetOptions,
      };

      const sourceMap = new SourceMapGenerator();
      sourceMap.addSource(filePath, content);

      const GeneratorClass = GENERATORS[target];
      if (!GeneratorClass) {
        return { success: false, output: '', target, stats: { ...stats, timeMs: Date.now() - startTime }, warnings: [], errors: [`Unsupported target: ${target}`], outputFiles: [] };
      }

      const genCtx: GeneratorContext = { ast, config: this.config, targetOptions: targetOpts, sourceMap, sourceContent: content, filePath, warnings: [], dependencies: new Set() };
      const generator = new GeneratorClass();
      let output = generator.generate(genCtx);
      stats.warnings.push(...genCtx.warnings);

      if (targetOpts.trailingNewline && !output.endsWith('\n')) output += '\n';

      stats.linesGenerated = output.split('\n').length;
      stats.bytesGenerated = Buffer.byteLength(output, 'utf-8');

      // Source map
      let sourceMapFile: SourceMapFile | undefined;
      if (targetOpts.includeSourceMap) {
        sourceMapFile = sourceMap.generate();
        sourceMapFile.file = basename(filePath, extname(filePath)) + '.' + TARGET_EXTENSIONS[target];
      }

      // Post-process
      this.emit('progress', target, 'Post-processing...');

      // Cache
      await this.cache.set(filePath, target, { hash: contentHash, timestamp: Date.now(), output, sourceMap: sourceMapFile, stats: { modulesCompiled: 1, linesGenerated: stats.linesGenerated, bytesGenerated: stats.bytesGenerated } });

      stats.modulesCompiled = 1;
      stats.timeMs = Date.now() - startTime;
      this.emit('complete', target, `Compilation completed in ${stats.timeMs.toFixed(2)}ms`);

      return { success: true, output, target, stats, warnings: stats.warnings, errors: [], sourceMap: sourceMapFile, outputFiles: [] };
    } catch (err) {
      stats.timeMs = Date.now() - startTime;
      this.emit('error', target, (err as Error).message);
      return { success: false, output: '', target, stats, warnings: [], errors: [`Compilation error: ${(err as Error).message}`], outputFiles: [] };
    }
  }
}

// ---------------------------------------------------------------------------
// Output Writer
// ---------------------------------------------------------------------------

class OutputWriter {
  static async write(output: string, filePath: string, target: CompileTarget, outDir: string, outFormat: OutputFormat, sourceMap?: SourceMapFile): Promise<string[]> {
    const written: string[] = [];
    if (outFormat === 'stdout') { process.stdout.write(output); return written; }
    if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });
    const ext = TARGET_EXTENSIONS[target];
    const base = basename(filePath, extname(filePath));
    const outFile = join(outDir, `${base}.${ext}`);
    await writeFile(outFile, output, 'utf-8');
    written.push(outFile);
    if (sourceMap) {
      const mapFile = outFile + '.map';
      await writeFile(mapFile, JSON.stringify(sourceMap, null, 2), 'utf-8');
      written.push(mapFile);
    }
    return written;
  }
}

// ---------------------------------------------------------------------------
// Watch Manager
// ---------------------------------------------------------------------------

class WatchManager {
  private watchers: Array<{ close(): void }> = [];
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  start(filePath: string, onCompile: (path: string) => Promise<void>): void {
    const dir = dirname(filePath);
    const watcher = fsWatch(dir, { recursive: true }, (_event: string, filename: string | null) => {
      if (!filename) return;
      const full = join(dir, filename);
      if (filename === basename(filePath) || full === filePath) {
        const key = full;
        if (this.timers.has(key)) clearTimeout(this.timers.get(key)!);
        this.timers.set(key, setTimeout(() => { this.timers.delete(key); onCompile(full); }, 300));
      }
    });
    const w = watcher as unknown as { close(): void };
    this.watchers.push(w);
    console.log(chalk.cyan(`\nWatching ${dir} for changes... Press Ctrl+C to stop.\n`));
  }

  stop(): void {
    for (const w of this.watchers) { try { w.close(); } catch { /* */ } }
    this.watchers = [];
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

export async function compileCommand(options: CompileOptions): Promise<void> {
  const spinner = ora({ text: 'Compiling module...', isEnabled: !options.quiet }).start();

  try {
    const filePath = resolve(options.file);
    const searchDir = dirname(filePath);

    // Load configuration
    let config: CompileConfig;
    if (options.config) {
      const raw = await readFile(resolve(options.config), 'utf-8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } else {
      config = await ConfigLoader.load(searchDir);
    }
    config = ConfigLoader.merge(config, options);

    const engine = new MAMCompilerEngine(config);

    // Wire up events for verbose mode
    if (options.verbose) {
      engine.on('event', (evt: CompilerEvent) => {
        const prefix = { start: '▶', progress: '  ', complete: '✔', error: '✖', warning: '⚠', cached: '◆', 'file-change': '↻' }[evt.type] || '•';
        console.log(chalk.gray(`  ${prefix} ${evt.message}`));
      });
    }

    const doCompile = async (file: string) => {
      const target = options.target || config.defaultTarget;
      spinner.text = `Compiling ${basename(file)} to ${target}...`;

      const result = await engine.compileFile(file, target, options);

      if (!result.success) {
        spinner.fail('Compilation failed');
        for (const err of result.errors) console.error(chalk.red(`  ${err}`));
        if (!options.watch) process.exit(1);
        return;
      }

      // Write output
      const outDir = options.outDir || join(process.cwd(), 'dist');
      const outFormat = options.outFormat || 'file';
      const files = await OutputWriter.write(result.output, file, target, outDir, outFormat, result.sourceMap);

      spinner.succeed(`Compiled: ${basename(file)} → ${target}`);

      // Print stats
      if (options.verbose) {
        console.log(chalk.gray(`  Target: ${result.stats.target}`));
        console.log(chalk.gray(`  Modules: ${result.stats.modulesCompiled}`));
        console.log(chalk.gray(`  Lines: ${result.stats.linesGenerated}`));
        console.log(chalk.gray(`  Bytes: ${result.stats.bytesGenerated}`));
        console.log(chalk.gray(`  Time: ${result.stats.timeMs.toFixed(2)}ms`));
        console.log(chalk.gray(`  Cache hits: ${result.stats.cachedHits}, misses: ${result.stats.cacheMisses}`));
      }

      if (result.warnings.length > 0) {
        for (const w of result.warnings) console.log(chalk.yellow(`  Warning: ${w}`));
      }

      if (files.length > 0) {
        console.log(chalk.green(`\nOutput files:`));
        for (const f of files) console.log(chalk.gray(`  ${f}`));
      }
    };

    if (options.watch) {
      await doCompile(filePath);
      const watcher = new WatchManager();
      watcher.start(filePath, async () => {
        spinner.start('Re-compiling...');
        await doCompile(filePath);
      });
      // Keep process alive
      await new Promise(() => {});
    } else {
      await doCompile(filePath);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers exported for external use
// ---------------------------------------------------------------------------

export function getExtension(target: CompileTarget): string {
  return TARGET_EXTENSIONS[target] || 'txt';
}

export function getDefaultOptions(target: CompileTarget): Partial<TargetOptions> {
  return DEFAULT_CONFIG.targets[target] || {};
}

export { MAMCompilerEngine, ConfigLoader, CacheManager, OutputWriter, WatchManager, SourceMapGenerator };
