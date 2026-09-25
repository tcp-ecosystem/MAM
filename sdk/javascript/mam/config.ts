import { readFile, writeFile, mkdir, access, rename, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

export interface SDKConfig {
  version: string;
  workDir: string;
  target: string;
  verbose: boolean;
  extra?: Record<string, string>;
}

export const DEFAULT_SDK_CONFIG: SDKConfig = {
  version: '1',
  workDir: '.',
  target: 'python',
  verbose: false,
};

const SDK_CONFIG_FILENAME = 'mam.sdk.json';

export async function loadSDKConfig(path?: string): Promise<SDKConfig> {
  const explicit = path === undefined ? undefined : expandSDKConfigPath(path);
  const resolved = explicit ?? await findSDKConfigUpwards(process.cwd());
  if (resolved === undefined) {
    return cloneSDKConfig(DEFAULT_SDK_CONFIG);
  }
  const raw = await readFile(resolved, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<SDKConfig>;
  const merged = mergeSDKConfigs(DEFAULT_SDK_CONFIG, parsed);
  const problems = validateSDKConfig(merged);
  if (problems.length > 0) {
    throw new Error(`Invalid SDK config ${resolved}: ${problems.join('; ')}`);
  }
  const effective = applySDKEnvOverrides(merged);
  const envProblems = validateSDKConfig(effective);
  if (envProblems.length > 0) {
    throw new Error(`Invalid SDK config after environment overrides: ${envProblems.join('; ')}`);
  }
  return effective;
}

export async function saveSDKConfig(config: SDKConfig, path: string): Promise<string> {
  const problems = validateSDKConfig(config);
  if (problems.length > 0) {
    throw new Error(`Refusing to save invalid SDK config: ${problems.join('; ')}`);
  }
  path = expandSDKConfigPath(path);
  const dir = dirname(resolve(path));
  await mkdir(dir, { recursive: true });
  const normalized = normalizeSDKConfig(config);
  const raw = JSON.stringify(normalized, null, 2) + '\n';
  const existing = await readSDKConfigRaw(path);
  if (existing !== raw) {
    let structurallySame = false;
    if (existing !== undefined) {
      try {
        const parsed = JSON.parse(existing) as Partial<SDKConfig>;
        structurallySame = equalSDKConfigs(mergeSDKConfigs(DEFAULT_SDK_CONFIG, parsed), normalized);
      } catch {
        structurallySame = false;
      }
    }
    if (!structurallySame) {
      await writeFileAtomic(path, raw);
    }
  }
  return path;
}

export function validateSDKConfig(config: SDKConfig): string[] {
  const problems: string[] = [];
  if (config.version.trim() === '') {
    problems.push('version is required');
  } else if (!isVersionLike(config.version)) {
    problems.push(`version ${JSON.stringify(config.version)} must be numeric dotted (e.g. "1" or "1.0")`);
  }
  if (config.target.trim() === '') {
    problems.push('target is required');
  } else if (!isKnownSDKTarget(config.target)) {
    problems.push(`target ${JSON.stringify(config.target)} is not a supported target`);
  }
  if (config.workDir.trim() === '') {
    problems.push('workDir is required');
  }
  for (const [key, value] of Object.entries(config.extra ?? {})) {
    if (key.trim() === '') {
      problems.push('extra keys must not be empty');
      break;
    }
    if (value.includes('\n')) {
      problems.push(`extra[${JSON.stringify(key)}] must be a single line`);
    }
  }
  return problems;
}

export function mergeSDKConfigs(base: SDKConfig, override: Partial<SDKConfig>): SDKConfig {
  const merged: SDKConfig = {
    ...cloneSDKConfig(base),
    extra: { ...(base.extra ?? {}) },
  };
  if (override.version !== undefined && override.version.trim() !== '') {
    merged.version = override.version;
  }
  if (override.workDir !== undefined && override.workDir.trim() !== '') {
    merged.workDir = override.workDir;
  }
  if (override.target !== undefined && override.target.trim() !== '') {
    merged.target = override.target;
  }
  if (override.verbose !== undefined) {
    merged.verbose = override.verbose;
  }
  if (override.extra !== undefined) {
    merged.extra = { ...(merged.extra ?? {}), ...override.extra };
  }
  return normalizeSDKConfig(merged);
}

export function resolveSDKConfigPath(dir: string): string {
  const trimmed = dir.trim();
  const base = trimmed === '' ? '.' : expandSDKConfigPath(trimmed);
  return resolve(join(base, SDK_CONFIG_FILENAME));
}

export function isSupportedSDKTarget(target: string): boolean {
  return isKnownSDKTarget(target);
}

export function listSDKTargets(): string[] {
  return [...knownSDKTargets()];
}

function cloneSDKConfig(config: SDKConfig): SDKConfig {
  return {
    ...config,
    extra: config.extra === undefined ? undefined : { ...config.extra },
  };
}

function normalizeSDKConfig(config: SDKConfig): SDKConfig {
  const normalized: SDKConfig = {
    version: config.version.trim(),
    workDir: config.workDir.trim(),
    target: config.target.trim().toLowerCase(),
    verbose: config.verbose,
  };
  if (config.extra !== undefined) {
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.extra)) {
      const trimmed = key.trim();
      if (trimmed !== '') {
        extra[trimmed] = value;
      }
    }
    normalized.extra = extra;
  }
  return normalized;
}

function isVersionLike(version: string): boolean {
  const parts = version.split('.');
  if (parts.length === 0) {
    return false;
  }
  return parts.every((part, index) => {
    if (part === '' || !/^\d+$/.test(part)) {
      return false;
    }
    return index > 0 || part.length === 1 || !part.startsWith('0');
  });
}

function isKnownSDKTarget(target: string): boolean {
  return knownSDKTargets().includes(target.toLowerCase());
}

function knownSDKTargets(): string[] {
  return [
    'python', 'javascript', 'typescript', 'go', 'rust',
    'json', 'yaml', 'openai', 'langgraph', 'crewai',
    'csharp', 'java', 'wasm', 'gemini', 'autogen',
    'kubernetes', 'terraform',
  ];
}

async function findSDKConfigUpwards(dir: string): Promise<string | undefined> {
  let current = resolve(dir);
  for (;;) {
    const candidate = join(current, SDK_CONFIG_FILENAME);
    if (await configFileExists(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

async function configFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readSDKConfigRaw(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function applySDKEnvOverrides(config: SDKConfig): SDKConfig {
  const merged = cloneSDKConfig(config);
  const version = (process.env.MAM_VERSION ?? '').trim();
  if (version !== '') {
    merged.version = version;
  }
  const workDir = (process.env.MAM_WORK_DIR ?? '').trim();
  if (workDir !== '') {
    merged.workDir = workDir;
  }
  const target = (process.env.MAM_TARGET ?? '').trim();
  if (target !== '') {
    merged.target = target.toLowerCase();
  }
  const verbose = (process.env.MAM_VERBOSE ?? '').trim().toLowerCase();
  if (verbose !== '') {
    merged.verbose = verbose === '1' || verbose === 'true' || verbose === 'yes';
  }
  const extra = (process.env.MAM_EXTRA ?? '').trim();
  if (extra !== '') {
    merged.extra = { ...(merged.extra ?? {}), ...parseExtraList(extra) };
  }
  return merged;
}

function parseExtraList(list: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of list.split(',')) {
    const trimmed = item.trim();
    if (trimmed === '') {
      continue;
    }
    const index = trimmed.indexOf('=');
    if (index < 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    if (key === '') {
      continue;
    }
    result[key] = trimmed.slice(index + 1).trim();
  }
  return result;
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw new Error(`write config ${path}: ${(error as Error).message}`);
  }
}

function expandSDKConfigPath(path: string): string {
  if (path.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (home !== '') {
      return join(home, path.slice(2));
    }
  }
  return path.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([^}]+)\}/g, (match, simple?: string, braced?: string) => {
    const name = simple ?? braced ?? '';
    return process.env[name] ?? match;
  });
}

function equalSDKConfigs(a: SDKConfig, b: SDKConfig): boolean {
  const left = normalizeSDKConfig(a);
  const right = normalizeSDKConfig(b);
  if (left.version !== right.version || left.workDir !== right.workDir ||
    left.target !== right.target || left.verbose !== right.verbose) {
    return false;
  }
  const leftExtra = left.extra ?? {};
  const rightExtra = right.extra ?? {};
  const leftKeys = Object.keys(leftExtra);
  if (leftKeys.length !== Object.keys(rightExtra).length) {
    return false;
  }
  return leftKeys.every((key) => rightExtra[key] === leftExtra[key]);
}
