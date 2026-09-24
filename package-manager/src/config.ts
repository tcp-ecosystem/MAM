/**
 * MAM Configuration
 *
 * Manages .mamprc configuration files with merging and validation.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface MAMPConfigData {
  /** Registry URL */
  registry?: string;
  /** Authentication token for registry */
  token?: string;
  /** Cache directory */
  cacheDir?: string;
  /** Packages directory */
  packagesDir?: string;
  /** Lock file enabled */
  lockfile?: boolean;
  /** Strict mode - fail on warnings */
  strict?: boolean;
  /** Log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Custom registries */
  registries?: Record<string, RegistryEntry>;
  /** Per-scope registry overrides */
  scopeRegistries?: Record<string, string>;
  /** Install strategy */
  installStrategy?: 'hoist' | 'nested' | 'linked';
  /** Enable telemetry */
  telemetry?: boolean;
  /** Maximum concurrent downloads */
  maxConcurrency?: number;
}

export interface RegistryEntry {
  /** Registry URL */
  url: string;
  /** Authentication token */
  token?: string;
  /** Whether this is the default registry */
  default?: boolean;
}

export interface ConfigValidationResult {
  /** Whether config is valid */
  valid: boolean;
  /** Validation errors */
  errors: ConfigError[];
  /** Validation warnings */
  warnings: ConfigWarning[];
}

export interface ConfigError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Config field that caused error */
  field?: string;
}

export interface ConfigWarning {
  /** Warning code */
  code: string;
  /** Warning message */
  message: string;
  /** Config field that caused warning */
  field?: string;
}

// ============================================================================
// MAMP Config Manager
// ============================================================================

export class MAMPConfig {
  private rootDir: string;
  private configPath: string;
  private data: MAMPConfigData = {};
  private loaded = false;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.configPath = join(rootDir, '.mamprc');
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<MAMPConfigData> {
    try {
      const content = await readFile(this.configPath, 'utf-8');
      this.data = this.parseConfig(content);
      this.loaded = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No config file, use defaults
        this.data = this.getDefaults();
        this.loaded = true;
      } else {
        throw error;
      }
    }

    return this.data;
  }

  /**
   * Save configuration to file
   */
  async save(): Promise<void> {
    const content = JSON.stringify(this.data, null, 2);
    await writeFile(this.configPath, content, 'utf-8');
  }

  /**
   * Merge configuration with overrides
   */
  merge(overrides: Partial<MAMPConfigData>): MAMPConfigData {
    this.data = {
      ...this.data,
      ...overrides,
    };

    // Deep merge registries
    if (overrides.registries) {
      this.data.registries = {
        ...this.data.registries,
        ...overrides.registries,
      };
    }

    // Deep merge scope registries
    if (overrides.scopeRegistries) {
      this.data.scopeRegistries = {
        ...this.data.scopeRegistries,
        ...overrides.scopeRegistries,
      };
    }

    return this.data;
  }

  /**
   * Validate configuration
   */
  validate(): ConfigValidationResult {
    const errors: ConfigError[] = [];
    const warnings: ConfigWarning[] = [];

    // Validate registry URL
    if (this.data.registry) {
      try {
        new URL(this.data.registry);
      } catch {
        errors.push({
          code: 'INVALID_REGISTRY_URL',
          message: `Invalid registry URL: ${this.data.registry}`,
          field: 'registry',
        });
      }
    }

    // Validate cache directory is writable
    if (this.data.cacheDir) {
      if (!this.isValidPath(this.data.cacheDir)) {
        warnings.push({
          code: 'INVALID_CACHE_DIR',
          message: `Cache directory path may be invalid: ${this.data.cacheDir}`,
          field: 'cacheDir',
        });
      }
    }

    // Validate log level
    const validLogLevels = ['debug', 'info', 'warn', 'error'];

    if (this.data.logLevel && !validLogLevels.includes(this.data.logLevel)) {
      errors.push({
        code: 'INVALID_LOG_LEVEL',
        message: `Invalid log level: ${this.data.logLevel}`,
        field: 'logLevel',
      });
    }

    // Validate max concurrency
    if (this.data.maxConcurrency !== undefined) {
      if (this.data.maxConcurrency < 1 || this.data.maxConcurrency > 32) {
        errors.push({
          code: 'INVALID_CONCURRENCY',
          message: 'Max concurrency must be between 1 and 32',
          field: 'maxConcurrency',
        });
      }
    }

    // Validate install strategy
    const validStrategies = ['hoist', 'nested', 'linked'];

    if (this.data.installStrategy && !validStrategies.includes(this.data.installStrategy)) {
      errors.push({
        code: 'INVALID_STRATEGY',
        message: `Invalid install strategy: ${this.data.installStrategy}`,
        field: 'installStrategy',
      });
    }

    // Validate custom registries
    if (this.data.registries) {
      for (const [name, entry] of Object.entries(this.data.registries)) {
        try {
          new URL(entry.url);
        } catch {
          errors.push({
            code: 'INVALID_REGISTRY_URL',
            message: `Invalid registry URL for "${name}": ${entry.url}`,
            field: `registries.${name}.url`,
          });
        }
      }
    }

    // Warn about missing token
    if (this.data.registry && !this.data.token) {
      warnings.push({
        code: 'MISSING_TOKEN',
        message: 'No authentication token set for registry',
        field: 'token',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get a config value
   */
  get<K extends keyof MAMPConfigData>(key: K): MAMPConfigData[K] | undefined {
    return this.data[key];
  }

  /**
   * Set a config value
   */
  set<K extends keyof MAMPConfigData>(key: K, value: MAMPConfigData[K]): void {
    this.data[key] = value;
  }

  /**
   * Get all config data
   */
  getAll(): MAMPConfigData {
    return { ...this.data };
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.data = this.getDefaults();
  }

  /**
   * Get registry URL for a scope
   */
  getRegistryForScope(scope: string): string | undefined {
    if (this.data.scopeRegistries && this.data.scopeRegistries[scope]) {
      return this.data.scopeRegistries[scope];
    }

    return this.data.registry;
  }

  /**
   * Get authentication token for a registry
   */
  getTokenForRegistry(registryUrl: string): string | undefined {
    if (this.data.registries) {
      for (const entry of Object.entries(this.data.registries)) {
        if (entry[1].url === registryUrl && entry[1].token) {
          return entry[1].token;
        }
      }
    }

    return this.data.token;
  }

  /**
   * Check if config is loaded
   */
  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private parseConfig(content: string): MAMPConfigData {
    try {
      return JSON.parse(content) as MAMPConfigData;
    } catch {
      // Try parsing as JSON5-like format (loose)
      try {
        // Remove comments and trailing commas for basic JSON5 support
        const cleaned = content
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/,\s*([}\]])/g, '$1');

        return JSON.parse(cleaned) as MAMPConfigData;
      } catch {
        throw new Error('Invalid configuration file format');
      }
    }
  }

  private getDefaults(): MAMPConfigData {
    return {
      registry: 'https://registry.mam.dev',
      cacheDir: join(this.rootDir, '.mam-cache'),
      packagesDir: join(this.rootDir, 'node_modules'),
      lockfile: true,
      strict: false,
      logLevel: 'info',
      installStrategy: 'hoist',
      telemetry: false,
      maxConcurrency: 8,
      registries: {},
      scopeRegistries: {},
    };
  }

  private isValidPath(pathStr: string): boolean {
    // Basic path validation
    if (!pathStr || pathStr.length === 0) {
      return false;
    }

    // Check for invalid characters
    const invalidChars = /[<>:"|?*]/;

    if (invalidChars.test(pathStr)) {
      return false;
    }

    return true;
  }
}

// ============================================================================
// Config Helpers
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge multiple config data objects into a single object.
 *
 * Later configs override earlier ones for scalar and object fields. Object
 * fields (such as `registries` and `scopeRegistries`) are shallow-merged, and
 * array values are concatenated and deduplicated.
 *
 * @param configs - The config objects to merge, in priority order.
 * @returns The merged config data.
 */
export function mergeConfigs(...configs: MAMPConfigData[]): MAMPConfigData {
  const merged: MAMPConfigData = {};

  for (const config of configs) {
    if (!config) {
      continue;
    }

    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) {
        continue;
      }

      const existing = merged[key as keyof MAMPConfigData];

      if (Array.isArray(value)) {
        const combined = Array.isArray(existing) ? [...existing, ...value] : [...value];
        (merged as Record<string, unknown>)[key] = Array.from(new Set(combined));
      } else if (isRecord(value) && isRecord(existing)) {
        (merged as Record<string, unknown>)[key] = { ...existing, ...value };
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }

  return merged;
}

/**
 * Get the default configuration data with no root-dir-dependent paths.
 *
 * @returns The default {@link MAMPConfigData}.
 */
export function getDefaultConfigData(): MAMPConfigData {
  return {
    registry: 'https://registry.mam.dev',
    cacheDir: '.mam-cache',
    packagesDir: 'node_modules',
    lockfile: true,
    strict: false,
    logLevel: 'info',
    installStrategy: 'hoist',
    telemetry: false,
    maxConcurrency: 8,
    registries: {},
    scopeRegistries: {},
  };
}
