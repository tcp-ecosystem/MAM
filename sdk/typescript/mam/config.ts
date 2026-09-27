import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** SDK configuration persisted by mam.sdk.json. */
export interface SDKConfig {
  version: string;
  work_dir: string;
  target: string;
  verbose: boolean;
  extra: Record<string, string>;
}

/** Returns the default SDK configuration. */
export function defaultSDKConfig(): SDKConfig {
  return { version: '1', work_dir: '.', target: 'typescript', verbose: false, extra: {} };
}

/** Returns supported config targets. */
export function supportedTargets(): string[] {
  return ['python', 'javascript', 'typescript', 'go', 'rust', 'json', 'yaml', 'openai', 'langgraph', 'crewai', 'csharp', 'java', 'wasm', 'gemini', 'autogen', 'kubernetes', 'terraform'];
}

/** Reports whether a target is supported. */
export function isSupportedTarget(target: string): boolean {
  return supportedTargets().includes(target.trim().toLowerCase());
}

/** Returns human-readable configuration problems. */
export function validateSDKConfig(config: SDKConfig): string[] {
  const problems: string[] = [];
  if (!config.version.trim()) problems.push('version is required');
  if (!/^\d+(?:\.\d+)*$/.test(config.version.trim())) problems.push('version must be numeric dotted');
  if (!config.work_dir.trim()) problems.push('work_dir is required');
  if (!isSupportedTarget(config.target)) problems.push(`unsupported target: ${config.target}`);
  for (const [key, value] of Object.entries(config.extra)) {
    if (!key.trim()) problems.push('extra keys must not be empty');
    if (value.includes('\n')) problems.push(`extra[${key}] must be one line`);
  }
  return problems;
}

/** Merges non-empty override values without mutating either input. */
export function mergeSDKConfigs(base: SDKConfig, override: Partial<SDKConfig>): SDKConfig {
  return {
    version: override.version?.trim() || base.version,
    work_dir: override.work_dir?.trim() || base.work_dir,
    target: (override.target || base.target).trim().toLowerCase(),
    verbose: Boolean(override.verbose || base.verbose),
    extra: { ...base.extra, ...(override.extra ?? {}) },
  };
}

/** Returns the conventional config path inside a directory. */
export function resolveSDKConfigPath(directory = '.'): string {
  return join(directory, 'mam.sdk.json');
}

/** Loads and validates a config file, or returns defaults when absent. */
export async function loadSDKConfig(path?: string): Promise<SDKConfig> {
  const defaults = defaultSDKConfig();
  if (!path) return defaults;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SDKConfig>;
    const config = mergeSDKConfigs(defaults, parsed);
    const problems = validateSDKConfig(config);
    if (problems.length) throw new Error(problems.join('; '));
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
    throw new Error(`Unable to load config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Saves a validated config as indented JSON. */
export async function saveSDKConfig(config: SDKConfig, path = resolveSDKConfigPath()): Promise<string> {
  const problems = validateSDKConfig(config);
  if (problems.length) throw new Error(`Refusing to save invalid config: ${problems.join('; ')}`);
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return path;
}

/** Returns a normalized target. */
export function normalizeTarget(target: string): string {
  return target.trim().toLowerCase();
}

/** Applies supported environment overrides to a config. */
export function applyEnvironment(config: SDKConfig, environment: NodeJS.ProcessEnv = process.env): SDKConfig {
  const extra = { ...config.extra };
  const override: Partial<SDKConfig> = { extra };
  if (environment.MAM_VERSION) override.version = environment.MAM_VERSION;
  if (environment.MAM_WORK_DIR) override.work_dir = environment.MAM_WORK_DIR;
  if (environment.MAM_TARGET) override.target = environment.MAM_TARGET;
  if (environment.MAM_VERBOSE) override.verbose = ['1', 'true', 'yes'].includes(environment.MAM_VERBOSE.toLowerCase());
  return mergeSDKConfigs(config, override);
}

/** Returns a copy of config extra data. */
export function copySDKConfig(config: SDKConfig): SDKConfig {
  return { ...config, extra: { ...config.extra } };
}

/** Returns a config summary for logs. */
export function formatSDKConfig(config: SDKConfig): string {
  return `v${config.version} target=${config.target} work_dir=${config.work_dir} verbose=${config.verbose}`;
}

/** Returns a boolean indicating whether a config is usable. */
export function isValidSDKConfig(config: SDKConfig): boolean {
  return validateSDKConfig(config).length === 0;
}

/** Returns a typed value from config extra data. */
export function configValue(config: SDKConfig, key: string, fallback = ''): string {
  return config.extra[key] ?? fallback;
}

/** Adds a single extra value, rejecting empty keys. */
export function withExtraValue(config: SDKConfig, key: string, value: string): SDKConfig {
  if (!key.trim()) throw new Error('extra key must not be empty');
  return { ...config, extra: { ...config.extra, [key]: value } };
}

/** Serializes config to deterministic JSON. */
export function serializeSDKConfig(config: SDKConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Parses config JSON with a useful error for malformed input. */
export function parseSDKConfig(raw: string): SDKConfig {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config must be a JSON object');
  return mergeSDKConfigs(defaultSDKConfig(), value as Partial<SDKConfig>);
}

/** Returns whether a path is explicitly supplied. */
export function hasConfigPath(path: string | undefined): path is string {
  return typeof path === 'string' && path.trim().length > 0;
}

/** Returns a config path with environment expansion. */
export function expandConfigPath(path: string, environment: NodeJS.ProcessEnv = process.env): string {
  return path.replace(/\$\{([^}]+)\}/g, (_, key: string) => environment[key] ?? '').replace(/^~(?=$|[\\/])/, environment.USERPROFILE ?? environment.HOME ?? '~');
}

/** Returns a config with all string fields trimmed. */
export function normalizeSDKConfig(config: SDKConfig): SDKConfig {
  return { ...config, version: config.version.trim(), work_dir: config.work_dir.trim(), target: normalizeTarget(config.target), extra: Object.fromEntries(Object.entries(config.extra).map(([key, value]) => [key.trim(), value])) };
}

/** Returns whether a config target is TypeScript. */
export function isTypeScriptTarget(config: SDKConfig): boolean {
  return normalizeTarget(config.target) === 'typescript';
}

/** Returns a default config for a specific target. */
export function configForTarget(target: string): SDKConfig {
  return { ...defaultSDKConfig(), target: normalizeTarget(target) };
}

/** Returns a path with the conventional filename appended when needed. */
export function ensureConfigFilename(path: string): string {
  return path.toLowerCase().endsWith('mam.sdk.json') ? path : join(path, 'mam.sdk.json');
}

/** Returns a config with a single field replaced. */
export function withConfigField<K extends keyof SDKConfig>(config: SDKConfig, field: K, value: SDKConfig[K]): SDKConfig {
  return { ...config, [field]: value };
}

/** Returns a config with verbose output toggled. */
export function withVerbose(config: SDKConfig, verbose: boolean): SDKConfig {
  return { ...config, verbose };
}

/** Returns the target's display name. */
export function targetLabel(target: string): string {
  return normalizeTarget(target) || 'unspecified';
}

/** Returns a key/value list of config fields. */
export function configEntries(config: SDKConfig): Array<[string, unknown]> {
  return Object.entries(config).map(([key, value]) => [key, key === 'extra' ? Object.keys(value).length : value]);
}

/** Returns a safe working directory. */
export function safeWorkingDirectory(config: SDKConfig): string {
  return config.work_dir.trim() || '.';
}

/** Returns a validated config or throws. */
export function requireValidSDKConfig(config: SDKConfig): SDKConfig {
  const problems = validateSDKConfig(config);
  if (problems.length) throw new Error(problems.join('; '));
  return config;
}

/** Returns true when the target belongs to the current SDK family. */
export function isSdkTarget(target: string): boolean {
  return isSupportedTarget(target);
}

/** Returns an environment override map for deterministic tests. */
export function environmentOverrides(environment: NodeJS.ProcessEnv): Partial<SDKConfig> {
  const result: Partial<SDKConfig> = {};
  if (environment.MAM_VERSION) result.version = environment.MAM_VERSION;
  if (environment.MAM_WORK_DIR) result.work_dir = environment.MAM_WORK_DIR;
  if (environment.MAM_TARGET) result.target = environment.MAM_TARGET;
  if (environment.MAM_VERBOSE) result.verbose = ['1', 'true', 'yes'].includes(environment.MAM_VERBOSE.toLowerCase());
  return result;
}

/** Returns a list of config field names. */
export function configFieldNames(): Array<keyof SDKConfig> {
  return ['version', 'work_dir', 'target', 'verbose', 'extra'];
}

/** Returns whether an extra value is present. */
export function hasExtraValue(config: SDKConfig, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(config.extra, key);
}

/** Returns a config string suitable for shell display. */
export function quoteConfigValue(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : JSON.stringify(value);
}

/** Returns a config with a normalized target. */
export function targetConfig(config: SDKConfig, target: string): SDKConfig {
  return normalizeSDKConfig(withConfigField(config, 'target', target));
}

/** Returns a config with a normalized working directory. */
export function workingDirectoryConfig(config: SDKConfig, directory: string): SDKConfig {
  return withConfigField(config, 'work_dir', directory);
}

/** Returns a config with a version. */
export function versionConfig(config: SDKConfig, version: string): SDKConfig {
  return withConfigField(config, 'version', version);
}

/** Returns a config with a verbose flag. */
export function verboseConfig(config: SDKConfig, verbose = true): SDKConfig {
  return withConfigField(config, 'verbose', verbose);
}

/** Returns whether a config has a target. */
export function hasTarget(config: SDKConfig): boolean {
  return config.target.trim().length > 0;
}

/** Returns whether a config has a version. */
export function hasVersion(config: SDKConfig): boolean {
  return config.version.trim().length > 0;
}

/** Returns whether a config has a work directory. */
export function hasWorkDirectory(config: SDKConfig): boolean {
  return config.work_dir.trim().length > 0;
}

/** Returns whether a config has extra values. */
export function hasExtra(config: SDKConfig): boolean {
  return Object.keys(config.extra).length > 0;
}

/** Returns a config field as a display string. */
export function configField(config: SDKConfig, field: keyof SDKConfig): string {
  const value = config[field];
  return field === 'extra' ? JSON.stringify(value) : typeof value === 'boolean' ? String(value) : String(value ?? '');
}

/** Returns a sorted list of config field names. */
export function sortedConfigFields(): Array<keyof SDKConfig> {
  return configFieldNames().sort();
}

/** Returns a config with all empty extra keys removed. */
export function compactSDKConfig(config: SDKConfig): SDKConfig {
  return { ...config, extra: Object.fromEntries(Object.entries(config.extra).filter(([key, value]) => key.trim() && value.length > 0)) };
}

/** Returns a config with extra values filtered to one line. */
export function singleLineSDKConfig(config: SDKConfig): SDKConfig {
  return { ...config, extra: Object.fromEntries(Object.entries(config.extra).map(([key, value]) => [key, value.replace(/[\r\n]+/g, ' ')])) };
}

/** Returns a config with fields copied into a plain object. */
export function configToObject(config: SDKConfig): Record<string, unknown> {
  return { version: config.version, work_dir: config.work_dir, target: config.target, verbose: config.verbose, extra: { ...config.extra } };
}

/** Returns a config from a partial plain object. */
export function configFromObject(value: Record<string, unknown>): SDKConfig {
  return mergeSDKConfigs(defaultSDKConfig(), value as Partial<SDKConfig>);
}

/** Returns a human-readable target. */
export function humanTarget(target: string): string {
  return target ? target.trim().toLowerCase() : 'unspecified';
}

/** Returns a human-readable version. */
export function humanVersion(version: string): string {
  return version ? `v${version}` : 'unversioned';
}

/** Returns a safe default config path. */
export function defaultConfigPath(): string {
  return resolveSDKConfigPath('.');
}

/** Returns whether a path has a config filename. */
export function isConfigPath(path: string): boolean {
  return path.toLowerCase().endsWith('mam.sdk.json');
}

void hasConfigPath;
void configValue;
void applyEnvironment;
