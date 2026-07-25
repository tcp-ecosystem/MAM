/**
 * MAM Configuration
 * 
 * Configuration management for MAM CLI.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface MAMConfig {
  /** Module name */
  name?: string;
  /** Default runtime */
  runtime?: string;
  /** Validation level */
  validationLevel?: 'syntax' | 'schema' | 'semantic' | 'strict';
  /** Output format */
  outputFormat?: 'text' | 'json';
  /** Plugin list */
  plugins?: string[];
  /** Custom rules */
  customRules?: string[];
  /** Ignore patterns */
  ignore?: string[];
  /** Formatter config */
  formatter?: {
    indent?: number;
    maxLineLength?: number;
  };
  /** Linter config */
  linter?: {
    level?: 'error' | 'warning' | 'info';
    style?: boolean;
    bestPractices?: boolean;
  };
}

// ============================================================================
// Constants
// ============================================================================

const CONFIG_FILE = 'mam.config.json';
const PACKAGE_KEY = 'mam';

// ============================================================================
// Config Manager
// ============================================================================

let cachedConfig: MAMConfig | null = null;

/**
 * Load configuration from file
 */
export async function loadConfig(searchPath?: string): Promise<MAMConfig> {
  if (cachedConfig) return cachedConfig;

  const dir = searchPath || process.cwd();
  const configPath = join(dir, CONFIG_FILE);

  try {
    await access(configPath);
    const content = await readFile(configPath, 'utf-8');
    cachedConfig = JSON.parse(content);
    return cachedConfig!;
  } catch {
    // Try package.json
    try {
      const pkgPath = join(dir, 'package.json');
      await access(pkgPath);
      const content = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      cachedConfig = pkg[PACKAGE_KEY] || {};
      return cachedConfig!;
    } catch {
      cachedConfig = {};
      return cachedConfig!;
    }
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: MAMConfig, dir?: string): Promise<void> {
  const configPath = join(dir || process.cwd(), CONFIG_FILE);
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): MAMConfig {
  return {
    runtime: 'python',
    validationLevel: 'schema',
    outputFormat: 'text',
    plugins: [],
    ignore: ['node_modules', 'dist', '.git'],
    formatter: {
      indent: 4,
      maxLineLength: 200,
    },
    linter: {
      level: 'warning',
      style: true,
      bestPractices: true,
    },
  };
}

/**
 * Merge configurations
 */
export function mergeConfigs(base: MAMConfig, override: MAMConfig): MAMConfig {
  return {
    ...base,
    ...override,
    plugins: [...(base.plugins || []), ...(override.plugins || [])],
    ignore: [...(base.ignore || []), ...(override.ignore || [])],
    formatter: { ...base.formatter, ...override.formatter },
    linter: { ...base.linter, ...override.linter },
  };
}

/**
 * Clear config cache
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Resolve configuration with defaults
 */
export async function resolveConfig(searchPath?: string): Promise<MAMConfig> {
  const fileConfig = await loadConfig(searchPath);
  const defaultConfig = getDefaultConfig();
  return mergeConfigs(defaultConfig, fileConfig);
}