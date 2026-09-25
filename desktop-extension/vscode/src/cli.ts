/**
 * CliService — thin, resilient wrapper around the `@mam/cli` binary.
 *
 * Every command is executed through `child_process.spawn` so the extension
 * never blocks the renderer and can surface real CLI output in the MAM output
 * channel. The binary name/path is taken from the `mam.cliPath` configuration
 * and defaults to `mam` (expected to be a `@mam/cli` on PATH).
 *
 * Windows note: npm global binaries are `.cmd` shims, so on win32 we build a
 * single command line and let `cmd.exe` resolve the shim (shell: true). On all
 * other platforms we spawn the executable directly.
 */

import * as child_process from 'child_process';

/** A single diagnostic emitted by `mam validate --format json`. */
export interface CliDiagnostic {
  ruleId: string;
  message: string;
  /** Severity strings the MAM validator produces. */
  severity: 'error' | 'warning' | 'info';
  /** 1-based line (0 means "unknown"). */
  line: number;
  /** 1-based column. */
  column: number;
  endLine?: number;
  endColumn?: number;
}

/** Parsed result of `mam validate --format json`. */
export interface ValidateResult {
  valid: boolean;
  file: string;
  level: string;
  diagnostics: CliDiagnostic[];
  stats: {
    errors: number;
    warnings: number;
    info: number;
    rulesChecked: number;
    linesChecked: number;
  };
}

/** Parsed result of `mam run --format json`. */
export interface RunResult {
  success: boolean;
  output: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  timeMs: number;
  memoryUsedBytes: number;
}

/** Raw process outcome returned by the spawn helper. */
interface SpawnOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

/** Error thrown when the `mam` binary cannot be found / executed. */
export class CliUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUnavailableError';
  }
}

export interface CliOptions {
  /** Binary name or absolute path to the MAM CLI. */
  cliPath: string;
  /** Working directory used as cwd for spawned processes. */
  cwd?: string;
}

export class CliService {
  private readonly cliPath: string;
  private readonly cwd: string;

  constructor(options: CliOptions) {
    this.cliPath = options.cliPath;
    this.cwd = options.cwd || process.cwd();
  }

  /**
   * Spawn a command and capture stdout/stderr + exit code.
   * Rejects with CliUnavailableError when the binary is missing.
   */
  private spawn(args: string[], cwd?: string, timeoutMs = 30_000): Promise<SpawnOutcome> {
    return new Promise((resolve, reject) => {
      const opts: child_process.SpawnOptions = {
        cwd: cwd || this.cwd,
        env: process.env,
        windowsHide: true,
      };

      let child: child_process.ChildProcess;
      try {
        if (process.platform === 'win32') {
          // Quote args that contain whitespace; cmd.exe resolves .cmd shims.
          const line = [this.cliPath, ...args]
            .map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
            .join(' ');
          child = child_process.spawn(line, [], { ...opts, shell: true });
        } else {
          child = child_process.spawn(this.cliPath, args, opts);
        }
      } catch (err) {
        reject(new CliUnavailableError((err as Error).message));
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // already exited
        }
      }, timeoutMs);

      child.stdout?.on('data', (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'EACCES') {
          reject(new CliUnavailableError(`MAM CLI '${this.cliPath}' not found: ${err.message}`));
        } else {
          reject(err);
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? (timedOut ? -1 : -1), stdout, stderr });
      });
    });
  }

  /**
   * Strip ANSI color codes (chalk) so text-formatted CLI output can be parsed.
   */
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001b\[[0-9;]*m/g, '');
  }

  /**
   * Parse the last JSON object embedded in stdout. The CLI may emit banners or
   * progress text around the payload; this extracts the final `{...}` block.
   */
  private parseJson<T>(stdout: string): T {
    const clean = this.stripAnsi(stdout);
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`No JSON payload found in CLI output: ${clean.slice(0, 200)}`);
    }
    return JSON.parse(clean.slice(start, end + 1)) as T;
  }

  /** Check whether the MAM CLI is available (runs `mam --version`). */
  async available(): Promise<boolean> {
    try {
      const outcome = await this.spawn(['--version'], undefined, 10_000);
      return outcome.code === 0;
    } catch {
      return false;
    }
  }

  /**
   * Run `mam validate <file> --format json` and map the structured result.
   * Falls back to parsing the human-readable (text) report when the CLI does
   * not support `--format json`.
   */
  async validate(file: string): Promise<ValidateResult> {
    // CliUnavailableError propagates so callers can fall back gracefully.
    const outcome = await this.spawn(['validate', file, '--format', 'json']);

    try {
      const parsed = this.parseJson<ValidateResult>(outcome.stdout);
      return {
        valid: Boolean(parsed.valid),
        file: parsed.file || file,
        level: parsed.level || 'schema',
        diagnostics: Array.isArray(parsed.diagnostics)
          ? parsed.diagnostics.map((d: CliDiagnostic) => ({
              ruleId: d.ruleId || 'UNKNOWN',
              message: d.message || 'Unknown validation error',
              severity: d.severity || 'error',
              line: Number(d.line) || 0,
              column: Number(d.column) || 1,
              endLine: d.endLine !== undefined ? Number(d.endLine) : undefined,
              endColumn: d.endColumn !== undefined ? Number(d.endColumn) : undefined,
            }))
          : [],
        stats: parsed.stats || { errors: 0, warnings: 0, info: 0, rulesChecked: 0, linesChecked: 0 },
      };
    } catch {
      // Older / incompatible CLI: fall back to parsing the text report lines
      // of the shape: `  <line>:<col> <message> (<RULE>)`.
      return this.parseValidateText(outcome.stdout, file);
    }
  }

  /** Parse the human-readable validator report into structured diagnostics. */
  private parseValidateText(stdout: string, file: string): ValidateResult {
    const clean = this.stripAnsi(stdout);
    const diagnostics: CliDiagnostic[] = [];
    const linePattern = /^\s*(\d+):(\d+)\s+(.+?)(?:\s+\(([A-Z0-9_]+)\))?\s*$/;

    for (const raw of clean.split('\n')) {
      const line = raw.trim();
      const match = linePattern.exec(line);
      if (!match) continue;
      diagnostics.push({
        ruleId: match[4] || 'TEXT',
        message: match[3] ?? '',
        severity: this.detectSeverity(line),
        line: Number(match[1]) || 0,
        column: Number(match[2]) || 1,
      });
    }

    const errors = diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
    const info = diagnostics.filter((d) => d.severity === 'info').length;
    return {
      valid: errors === 0,
      file,
      level: 'schema',
      diagnostics,
      stats: { errors, warnings, info, rulesChecked: 0, linesChecked: 0 },
    };
  }

  /** Guess severity from the leading symbol the text report prints. */
  private detectSeverity(line: string): 'error' | 'warning' | 'info' {
    if (line.startsWith('✖') || /error/i.test(line)) return 'error';
    if (line.startsWith('⚠') || /warning/i.test(line)) return 'warning';
    return 'info';
  }

  /**
   * Run `mam run <file> --format json` and return the execution result.
   */
  async run(file: string, cwd?: string): Promise<RunResult> {
    const outcome = await this.spawn(['run', file, '--format', 'json'], cwd);
    const parsed = this.parseJson<RunResult>(outcome.stdout);
    return {
      success: Boolean(parsed.success),
      output: parsed.output || {},
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      timeMs: Number(parsed.timeMs) || 0,
      memoryUsedBytes: Number(parsed.memoryUsedBytes) || 0,
    };
  }

  /**
   * Run `mam build` (project or module build) in the given directory.
   */
  async build(dir?: string): Promise<{ ok: boolean; output: string }> {
    const outcome = await this.spawn(['build'], dir);
    const output = `${this.stripAnsi(outcome.stdout)}\n${this.stripAnsi(outcome.stderr)}`.trim();
    return { ok: outcome.code === 0, output };
  }

  /**
   * Run `mam compile <file> -t <target>` and capture the compiler output.
   */
  async compile(file: string, target: string): Promise<{ ok: boolean; output: string }> {
    const outcome = await this.spawn(['compile', file, '-t', target]);
    const output = `${this.stripAnsi(outcome.stdout)}\n${this.stripAnsi(outcome.stderr)}`.trim();
    return { ok: outcome.code === 0, output };
  }

  /**
   * Run `mam new <type> <name> -d <dir>` and return the scaffolded file paths.
   */
  async newModule(type: string, name: string, dir: string): Promise<{ ok: boolean; output: string; files: string[] }> {
    const outcome = await this.spawn(['new', type, name, '-d', dir], dir);
    const output = this.stripAnsi(outcome.stdout);
    const files = output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /\.mam(\.md)?$/.test(l))
      .map((l) => l.trim());
    return { ok: outcome.code === 0, output, files };
  }

  /**
   * Run `mam run --format json` in the given directory (project entry point).
   */
  async runProject(dir?: string): Promise<RunResult> {
    const outcome = await this.spawn(['run', '--format', 'json'], dir);
    const parsed = this.parseJson<RunResult>(outcome.stdout);
    return {
      success: Boolean(parsed.success),
      output: parsed.output || {},
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      timeMs: Number(parsed.timeMs) || 0,
      memoryUsedBytes: Number(parsed.memoryUsedBytes) || 0,
    };
  }
}