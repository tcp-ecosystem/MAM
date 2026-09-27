/**
 * MAM Reference Implementation — Logger
 *
 * Lightweight structured logger with level filtering, optional colour,
 * and child-logger support.
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  /** Minimum level to emit (default: 'info'). */
  level?: LogLevel;
  /** Use ANSI colours in output (default: true in TTY). */
  color?: boolean;
  /** Prefix each line with an ISO timestamp. */
  timestamp?: boolean;
  /** Static prefix prepended to every message. */
  prefix?: string;
  /** writable stream for output (default: process.stderr). */
  stream?: NodeJS.WriteStream;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// ============================================================================
// Logger
// ============================================================================

export class Logger {
  private _level: LogLevel;
  private _color: boolean;
  private _timestamp: boolean;
  private _prefix: string;
  private _stream: NodeJS.WriteStream;

  constructor(options: LoggerOptions = {}) {
    this._level = options.level ?? 'info';
    this._color = options.color ?? (process.stdout?.isTTY ?? false);
    this._timestamp = options.timestamp ?? false;
    this._prefix = options.prefix ?? '';
    this._stream = options.stream ?? process.stderr;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  debug(message: string, ...args: unknown[]): void {
    this._emit('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this._emit('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this._emit('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this._emit('error', message, args);
  }

  /**
   * Emit an "info" message with a green check mark prefix.
   */
  success(message: string, ...args: unknown[]): void {
    const msg = this._color ? `\x1b[32m✓\x1b[0m ${message}` : `✓ ${message}`;
    this._emit('info', msg, args);
  }

  /**
   * Create a child logger with an additional prefix.
   */
  child(prefix: string): Logger {
    const combined = this._prefix ? `${this._prefix}:${prefix}` : prefix;
    return new Logger({
      level: this._level,
      color: this._color,
      timestamp: this._timestamp,
      prefix: combined,
      stream: this._stream,
    });
  }

  /**
   * Change the log level at runtime.
   */
  setLevel(level: LogLevel): void {
    this._level = level;
  }

  /**
   * Return the current log level.
   */
  getLevel(): LogLevel {
    return this._level;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private _emit(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this._level]) return;
    if (this._level === 'silent') return;

    const parts: string[] = [];

    if (this._timestamp) {
      parts.push(new Date().toISOString());
    }

    if (this._prefix) {
      parts.push(`[${this._prefix}]`);
    }

    parts.push(this._colourise(level, message));

    if (args.length > 0) {
      for (const arg of args) {
        parts.push(typeof arg === 'string' ? arg : JSON.stringify(arg));
      }
    }

    const line = parts.join(' ') + '\n';

    if (level === 'error') {
      this._stream.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  private _colourise(level: LogLevel, text: string): string {
    if (!this._color) return text;

    const codes: Record<string, string> = {
      debug: '\x1b[90m',   // grey
      info: '\x1b[36m',    // cyan
      warn: '\x1b[33m',    // yellow
      error: '\x1b[31m',   // red
    };
    const reset = '\x1b[0m';
    const tag = level.toUpperCase().padEnd(5);

    return `${codes[level] ?? ''}${tag}${reset} ${text}`;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Convenience factory for creating a Logger.
 */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

// ============================================================================
// Singleton (used by the CLI when no explicit logger is needed)
// ============================================================================

let _defaultLogger: Logger | undefined;

/**
 * Return the process-wide default Logger instance.
 * Created lazily on first call.
 */
export function getDefaultLogger(): Logger {
  if (!_defaultLogger) {
    _defaultLogger = new Logger({
      level: process.env.MAM_LOG_LEVEL as LogLevel | undefined ?? 'info',
      color: process.stdout?.isTTY ?? false,
    });
  }
  return _defaultLogger;
}

/**
 * Replace the process-wide default Logger (useful for testing).
 */
export function setDefaultLogger(logger: Logger): void {
  _defaultLogger = logger;
}

export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as string[]).includes(value);
}

export function compareLogLevels(a: LogLevel, b: LogLevel): number {
  return LEVEL_ORDER[a] - LEVEL_ORDER[b];
}

export function isLevelEnabled(current: LogLevel, level: LogLevel): boolean {
  if (current === 'silent') return false;
  return LEVEL_ORDER[level] >= LEVEL_ORDER[current];
}

export function formatLogMessage(level: LogLevel, message: string, prefix?: string): string {
  const tag = level.toUpperCase().padEnd(5);
  if (prefix) {
    return `${tag} [${prefix}] ${message}`;
  }
  return `${tag} ${message}`;
}

export function createSilentLogger(): Logger {
  return new Logger({ level: 'silent' });
}

export function createMemoryLogger(options?: LoggerOptions): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const stream = {
    write(chunk: string): boolean {
      lines.push(String(chunk));
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  const logger = new Logger({ ...options, stream });
  return { logger, lines };
}
