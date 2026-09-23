/**
 * MAM V2 Sandbox
 *
 * A sandbox abstraction with filesystem, network, process, resource-limit,
 * and execution-timeout policies. Execution is mediated through a guarded
 * API; unauthorized operations raise PermissionViolationError.
 */

export interface SandboxFilesystemPolicy {
  read: boolean;
  write: boolean;
  /** Allowed path prefixes (relative to the sandbox root). */
  allowedPaths?: string[];
}

export interface SandboxNetworkPolicy {
  allow: boolean;
  domains?: string[];
}

export interface SandboxProcessPolicy {
  allowSpawn: boolean;
  maxProcesses?: number;
}

export interface SandboxResourceLimits {
  memoryMB?: number;
  cpuPercent?: number;
  timeoutMs?: number;
}

export interface SandboxConfig {
  name?: string;
  filesystem?: SandboxFilesystemPolicy;
  network?: SandboxNetworkPolicy;
  process?: SandboxProcessPolicy;
  limits?: SandboxResourceLimits;
  /** In-memory filesystem seeded for the sandbox. */
  seedFiles?: Record<string, string>;
}

export interface SandboxExecutionResult {
  success: boolean;
  output: unknown;
  violations: string[];
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxApi {
  fs: {
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    list(root?: string): Promise<string[]>;
  };
  net: {
    fetch(url: string): Promise<{ status: number; body: unknown }>;
  };
  process: {
    spawn(command: string): Promise<{ ok: boolean; output: string }>;
  };
}

export interface Sandbox {
  readonly name: string;
  readonly config: SandboxConfig;
  execute<T>(fn: (api: SandboxApi) => Promise<T>): Promise<SandboxExecutionResult & { result?: T }>;
  violations(): string[];
  isolation(): string[];
}

export class PermissionViolationError extends Error {
  constructor(resource: string, detail: string) {
    super(`Sandbox permission denied: ${resource} — ${detail}`);
    this.name = 'PermissionViolationError';
  }
}

const DEFAULT_FS: SandboxFilesystemPolicy = { read: true, write: false, allowedPaths: ['/'] };
const DEFAULT_NETWORK: SandboxNetworkPolicy = { allow: false };
const DEFAULT_PROCESS: SandboxProcessPolicy = { allowSpawn: false, maxProcesses: 0 };

function pathAllowed(path: string, policy: SandboxFilesystemPolicy): boolean {
  const roots = policy.allowedPaths ?? ['/'];
  return roots.some((root) => path.startsWith(root));
}

export class SandboxManager {
  private sandboxes = new Map<string, Sandbox>();

  validate(config: SandboxConfig): string[] {
    const errors: string[] = [];
    const limits = config.limits ?? {};
    if (limits.memoryMB !== undefined && limits.memoryMB <= 0) errors.push('memoryMB must be positive');
    if (limits.timeoutMs !== undefined && limits.timeoutMs <= 0) errors.push('timeoutMs must be positive');
    if (config.filesystem?.write && config.filesystem.allowedPaths?.length === 0) errors.push('write requires allowedPaths');
    return errors;
  }

  createSandbox(config: SandboxConfig = {}): Sandbox {
    const name = config.name ?? `sandbox-${this.sandboxes.size + 1}`;
    const violations: string[] = [];
    const fsPolicy = { ...DEFAULT_FS, ...config.filesystem };
    const netPolicy = { ...DEFAULT_NETWORK, ...config.network };
    const procPolicy = { ...DEFAULT_PROCESS, ...config.process };
    const files = new Map<string, string>(Object.entries(config.seedFiles ?? {}));

    const api: SandboxApi = {
      fs: {
        async read(path: string): Promise<string> {
          if (!fsPolicy.read) { violations.push(`fs.read ${path}`); throw new PermissionViolationError('fs.read', path); }
          if (!pathAllowed(path, fsPolicy)) { violations.push(`fs.read ${path}`); throw new PermissionViolationError('fs.read', `path outside allowed roots: ${path}`); }
          if (!files.has(path)) throw new Error(`Not found: ${path}`);
          return files.get(path)!;
        },
        async write(path: string, data: string): Promise<void> {
          if (!fsPolicy.write) { violations.push(`fs.write ${path}`); throw new PermissionViolationError('fs.write', path); }
          if (!pathAllowed(path, fsPolicy)) { violations.push(`fs.write ${path}`); throw new PermissionViolationError('fs.write', `path outside allowed roots: ${path}`); }
          files.set(path, data);
        },
        async list(root = '/'): Promise<string[]> {
          if (!fsPolicy.read) throw new PermissionViolationError('fs.list', root);
          return [...files.keys()].filter((p) => p.startsWith(root));
        },
      },
      net: {
        async fetch(url: string): Promise<{ status: number; body: unknown }> {
          if (!netPolicy.allow) { violations.push(`net.fetch ${url}`); throw new PermissionViolationError('net.fetch', url); }
          if (netPolicy.domains && netPolicy.domains.length > 0) {
            const host = (() => { try { return new URL(url).host; } catch { return url; } })();
            if (!netPolicy.domains.some((d) => host === d || host.endsWith(`.${d}`))) {
              violations.push(`net.fetch ${url}`); throw new PermissionViolationError('net.fetch', `domain not allowed: ${host}`);
            }
          }
          return { status: 200, body: { url } };
        },
      },
      process: {
        async spawn(command: string): Promise<{ ok: boolean; output: string }> {
          if (!procPolicy.allowSpawn) { violations.push(`process.spawn ${command}`); throw new PermissionViolationError('process.spawn', command); }
          return { ok: true, output: '' };
        },
      },
    };

    const sandbox: Sandbox = {
      name,
      config,
      async execute<T>(fn: (api: SandboxApi) => Promise<T>): Promise<SandboxExecutionResult & { result?: T }> {
        const start = Date.now();
        const timeoutMs = config.limits?.timeoutMs;
        let timedOut = false;
        try {
          const result = await Promise.race([
            fn(api),
            timeoutMs
              ? new Promise<never>((_, reject) => setTimeout(() => { timedOut = true; reject(new Error('Sandbox execution timed out')); }, timeoutMs))
              : new Promise<never>(() => {}),
          ]);
          return { success: true, output: result, result, violations: [...violations], durationMs: Date.now() - start, timedOut: false };
        } catch (err) {
          return { success: false, output: undefined, violations: [...violations], durationMs: Date.now() - start, timedOut };
        }
      },
      violations: () => [...violations],
      isolation: () => [
        `filesystem: ${fsPolicy.write ? 'read+write' : 'read-only'}`,
        `network: ${netPolicy.allow ? 'allowed' : 'denied'}`,
        `process: ${procPolicy.allowSpawn ? 'allowed' : 'denied'}`,
        `memory limit: ${config.limits?.memoryMB ?? 'unlimited'}MB`,
        `timeout: ${config.limits?.timeoutMs ?? 'none'}`,
      ],
    };

    this.sandboxes.set(name, sandbox);
    return sandbox;
  }

  get(name: string): Sandbox | undefined {
    return this.sandboxes.get(name);
  }

  list(): string[] {
    return [...this.sandboxes.keys()];
  }

  remove(name: string): boolean {
    return this.sandboxes.delete(name);
  }
}

export function createSandboxManager(): SandboxManager {
  return new SandboxManager();
}