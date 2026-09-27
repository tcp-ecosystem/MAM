/**
 * MAM Reference Implementation — Configuration
 *
 * Loading, saving, merging, and validating mam.config.json (or .yaml / .mamrc).
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import type { MAMConfig, BuildConfig, PluginConfig } from './types.js';
import { ConfigError } from './errors.js';

// ============================================================================
// Constants
// ============================================================================

/** Default configuration applied when no user config is found. */
export const DEFAULT_CONFIG: MAMConfig = {
  version: '1',
  project: {
    name: 'my-mam-project',
    version: '0.1.0',
    description: '',
    runtime: 'python',
  },
  build: {
    target: 'python',
    output: './dist',
    sourceMap: false,
    minify: false,
    optimize: true,
    includeComments: true,
    indent: 2,
  },
  registry: {
    url: 'https://registry.mam.dev',
  },
  plugins: [],
};

/** Configuration file names searched in order. */
const CONFIG_FILENAMES = [
  'mam.config.json',
  'mam.config.yaml',
  'mam.config.yml',
  '.mamrc',
];

// ============================================================================
// Load
// ============================================================================

/**
 * Load configuration from the nearest config file.
 *
 * Search order (stopping at first hit):
 * 1. Explicit `path` argument (if provided)
 * 2. `mam.config.json` / `mam.config.yaml` / `.mamrc` in `basePath`
 * 3. `mam` field in `package.json` in `basePath`
 * 4. Walk up parent directories until a config file is found or root is reached
 *
 * @param basePath  Directory to start searching from (defaults to cwd).
 * @param configPath  Optional explicit path to a config file.
 * @returns Merged configuration (defaults ← file).
 */
export async function loadConfig(
  basePath?: string,
  configPath?: string,
): Promise<MAMConfig> {
  const dir = basePath ?? process.cwd();

  if (configPath) {
    return readConfigFile(resolve(dir, configPath));
  }

  // Search well-known filenames in the base directory
  for (const name of CONFIG_FILENAMES) {
    const candidate = join(dir, name);
    if (await fileExists(candidate)) {
      return readConfigFile(candidate);
    }
  }

  // Try the `mam` field in package.json
  const pkgPath = join(dir, 'package.json');
  if (await fileExists(pkgPath)) {
    const raw = await readFile(pkgPath, 'utf-8');
    try {
      const pkg = JSON.parse(raw);
      if (pkg.mam && typeof pkg.mam === 'object') {
        return mergeConfigs(DEFAULT_CONFIG, pkg.mam as Partial<MAMConfig>);
      }
    } catch {
      // Ignore malformed package.json
    }
  }

  // Walk up to parent directory
  const parent = dirname(dir);
  if (parent !== dir) {
    return loadConfig(parent, configPath);
  }

  // No config found — return defaults
  return structuredClone(DEFAULT_CONFIG);
}

/**
 * Read and parse a single config file (JSON or YAML).
 */
async function readConfigFile(filePath: string): Promise<MAMConfig> {
  const raw = await readFile(filePath, 'utf-8');
  const ext = filePath.split('.').pop()?.toLowerCase();

  let parsed: unknown;
  if (ext === 'json' || ext === 'mamrc') {
    parsed = JSON.parse(raw);
  } else if (ext === 'yaml' || ext === 'yml') {
    // Lazy-load yaml so we don't force it as a dependency
    try {
      const yaml = await import('yaml');
      parsed = yaml.parse(raw);
    } catch {
      throw new ConfigError(
        'YAML config file requires the "yaml" package to be installed.',
        { path: filePath },
      );
    }
  } else {
    throw new ConfigError(`Unsupported config format: ${ext}`, {
      path: filePath,
    });
  }

  if (parsed && typeof parsed === 'object') {
    return mergeConfigs(DEFAULT_CONFIG, parsed as Partial<MAMConfig>);
  }

  throw new ConfigError('Config file is empty or invalid.', {
    path: filePath,
  });
}

// ============================================================================
// Save
// ============================================================================

/**
 * Persist configuration to disk as JSON.
 *
 * @param config  Configuration to save.
 * @param path    Destination file path.
 */
export async function saveConfig(
  config: MAMConfig,
  path: string,
): Promise<void> {
  const dir = dirname(path);
  await ensureDir(dir);
  const content = JSON.stringify(config, null, 2) + '\n';
  await writeFile(path, content, 'utf-8');
}

// ============================================================================
// Merge
// ============================================================================

/**
 * Deep-merge `override` onto `base`.  Arrays are replaced, not concatenated.
 * Returns a new object — neither input is mutated.
 */
export function mergeConfigs(
  base: MAMConfig,
  override: Partial<MAMConfig>,
): MAMConfig {
  const result = structuredClone(base);

  if (override.version !== undefined) result.version = override.version;

  if (override.project) {
    result.project = { ...result.project, ...override.project };
  }

  if (override.build) {
    result.build = { ...result.build, ...override.build };
  }

  if (override.registry) {
    result.registry = { ...result.registry, ...override.registry };
  }

  if (override.plugins !== undefined) {
    result.plugins = structuredClone(override.plugins);
  }

  if (override.targets !== undefined) {
    result.targets = structuredClone(override.targets);
  }

  return result;
}

// ============================================================================
// Validate
// ============================================================================

/**
 * Validate a configuration object.
 *
 * @returns An array of human-readable error messages.  Empty if valid.
 */
export function validateConfig(config: MAMConfig): string[] {
  const errors: string[] = [];

  if (!config.version) {
    errors.push('config.version is required');
  }

  if (config.project) {
    if (!config.project.name) {
      errors.push('config.project.name is required');
    }
    if (config.project.version && !/^\d+\.\d+\.\d+/.test(config.project.version)) {
      errors.push(
        `config.project.version must be semver, got "${config.project.version}"`,
      );
    }
  }

  if (config.build) {
    const validTargets = [
      'python', 'javascript', 'typescript', 'go', 'rust', 'json', 'yaml',
      'openai', 'langgraph', 'crewai', 'csharp', 'java', 'wasm',
      'gemini', 'autogen', 'kubernetes', 'terraform',
    ];
    if (config.build.target && !validTargets.includes(config.build.target)) {
      errors.push(
        `config.build.target "${config.build.target}" is not a supported target`,
      );
    }
  }

  if (config.registry?.url) {
    try {
      new URL(config.registry.url);
    } catch {
      errors.push(`config.registry.url is not a valid URL: "${config.registry.url}"`);
    }
  }

  if (config.plugins) {
    for (const [i, plugin] of config.plugins.entries()) {
      if (!plugin.name) {
        errors.push(`config.plugins[${i}].name is required`);
      }
    }
  }

  return errors;
}

// ============================================================================
// Resolve
// ============================================================================

/**
 * Resolve a config file path relative to `basePath`.
 *
 * @param basePath    Base directory (e.g. cwd).
 * @param configPath  Optional explicit config path.  If absolute it is returned as-is.
 * @returns Resolved absolute path.
 */
export function resolveConfigPath(
  basePath: string,
  configPath?: string,
): string {
  if (configPath) {
    return resolve(basePath, configPath);
  }

  // Default — look for well-known filename in base
  return resolve(basePath, 'mam.config.json');
}

// ============================================================================
// Target-Specific Overrides
// ============================================================================

/**
 * Return the effective configuration for a specific target, applying any
 * target-specific overrides defined in `config.targets`.
 */
export function getConfigForTarget(
  config: MAMConfig,
  target: string,
): MAMConfig {
  const override = config.targets?.[target];
  if (!override) return config;

  return {
    ...config,
    build: { ...config.build, ...override },
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await writeFile(dirPath, '', { flag: 'a' }).catch(() => {});
  // Use recursive mkdir to handle nested paths
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirPath, { recursive: true }).catch(() => {});
}

export function cloneConfig(config: MAMConfig): MAMConfig {
  return structuredClone(config);
}

export function getConfigValue(config: MAMConfig, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = config;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setConfigValue(config: MAMConfig, path: string, value: unknown): MAMConfig {
  const result = structuredClone(config);
  const parts = path.split('.');
  let current: Record<string, unknown> = result as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = current[part];
    if (typeof next !== 'object' || next === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
  return result;
}

export function listConfiguredTargets(config: MAMConfig): string[] {
  return Object.keys(config.targets ?? {});
}

export function hasTarget(config: MAMConfig, target: string): boolean {
  return listConfiguredTargets(config).includes(target);
}

export function diffConfigKeys(a: MAMConfig, b: MAMConfig): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diff: string[] = [];
  for (const key of keys) {
    const left = JSON.stringify((a as unknown as Record<string, unknown>)[key]);
    const right = JSON.stringify((b as unknown as Record<string, unknown>)[key]);
    if (left !== right) {
      diff.push(key);
    }
  }
  return diff;
}

export function isDefaultConfig(config: MAMConfig): boolean {
  return JSON.stringify(config) === JSON.stringify(DEFAULT_CONFIG);
}
