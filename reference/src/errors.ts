/**
 * MAM Reference Implementation — Error Classes
 *
 * Structured error hierarchy for the CLI, compiler, package manager,
 * and registry subsystems.
 */

// ============================================================================
// Base Error
// ============================================================================

export interface ErrorOptions {
  /** Machine-readable error code */
  code?: string;
  /** Underlying cause */
  cause?: Error;
  /** Additional context */
  context?: Record<string, unknown>;
  /** File path where the error occurred */
  path?: string;
  /** Line number if applicable */
  line?: number;
  /** Column number if applicable */
  column?: number;
}

export class MAMError extends Error {
  /** Machine-readable error code */
  readonly code: string;
  /** Underlying cause */
  readonly cause?: Error;
  /** Additional context */
  readonly context?: Record<string, unknown>;
  /** File path where the error occurred */
  readonly path?: string;
  /** Line number */
  readonly line?: number;
  /** Column number */
  readonly column?: number;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message);
    this.name = 'MAMError';
    this.code = options.code ?? 'MAM_ERROR';
    this.cause = options.cause;
    this.context = options.context;
    this.path = options.path;
    this.line = options.line;
    this.column = options.column;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Format error for display with optional file/line context.
   */
  format(): string {
    const parts: string[] = [this.message];
    if (this.path) {
      const location = [this.path];
      if (this.line !== undefined) location.push(String(this.line));
      if (this.column !== undefined) location.push(String(this.column));
      parts.unshift(`at ${location.join(':')}`);
    }
    return parts.join('\n');
  }

  /**
   * Convert to a plain object for serialisation.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      path: this.path,
      line: this.line,
      column: this.column,
      context: this.context,
    };
  }
}

// ============================================================================
// Specific Error Classes
// ============================================================================

export class ParseError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'PARSE_ERROR', ...options });
    this.name = 'ParseError';
  }
}

export class ValidationError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'VALIDATION_ERROR', ...options });
    this.name = 'ValidationError';
  }
}

export class CompileError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'COMPILE_ERROR', ...options });
    this.name = 'CompileError';
  }
}

export class ConfigError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'CONFIG_ERROR', ...options });
    this.name = 'ConfigError';
  }
}

export class RegistryError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'REGISTRY_ERROR', ...options });
    this.name = 'RegistryError';
  }
}

export class PluginError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'PLUGIN_ERROR', ...options });
    this.name = 'PluginError';
  }
}

export class PackageError extends MAMError {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, { code: options.code ?? 'PACKAGE_ERROR', ...options });
    this.name = 'PackageError';
  }
}

// ============================================================================
// Error Collector
// ============================================================================

export class ErrorCollector {
  private _errors: MAMError[] = [];
  private _warnings: MAMError[] = [];

  /**
   * Record an error.
   */
  addError(error: MAMError): void {
    this._errors.push(error);
  }

  /**
   * Record a warning.
   */
  addWarning(warning: MAMError): void {
    this._warnings.push(warning);
  }

  /**
   * Whether any errors have been recorded.
   */
  hasErrors(): boolean {
    return this._errors.length > 0;
  }

  /**
   * Whether any warnings have been recorded.
   */
  hasWarnings(): boolean {
    return this._warnings.length > 0;
  }

  /**
   * Return all recorded errors.
   */
  getErrors(): MAMError[] {
    return [...this._errors];
  }

  /**
   * Return all recorded warnings.
   */
  getWarnings(): MAMError[] {
    return [...this._warnings];
  }

  /**
   * Total error count.
   */
  get errorCount(): number {
    return this._errors.length;
  }

  /**
   * Total warning count.
   */
  get warningCount(): number {
    return this._warnings.length;
  }

  /**
   * Clear all recorded errors and warnings.
   */
  clear(): void {
    this._errors = [];
    this._warnings = [];
  }

  /**
   * Format all errors and warnings for display.
   */
  format(): string {
    const lines: string[] = [];

    for (const error of this._errors) {
      lines.push(`error [${error.code}]: ${error.format()}`);
    }
    for (const warning of this._warnings) {
      lines.push(`warn  [${warning.code}]: ${warning.format()}`);
    }

    return lines.join('\n');
  }

  /**
   * Convert to a plain object for serialisation.
   */
  toResult(): {
    errors: Array<{ code: string; message: string; path?: string }>;
    warnings: Array<{ code: string; message: string; path?: string }>;
  } {
    return {
      errors: this._errors.map((e) => ({
        code: e.code,
        message: e.message,
        path: e.path,
      })),
      warnings: this._warnings.map((w) => ({
        code: w.code,
        message: w.message,
        path: w.path,
      })),
    };
  }
}

export function isMAMError(err: unknown): err is MAMError {
  return err instanceof MAMError;
}

export function asMAMError(err: unknown): MAMError {
  if (err instanceof MAMError) return err;
  if (err instanceof Error) {
    return new MAMError(err.message, { cause: err });
  }
  return new MAMError(String(err));
}

export function getErrorCode(err: unknown): string {
  if (err instanceof MAMError) return err.code;
  return 'UNKNOWN_ERROR';
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isErrorCode(err: unknown, code: string): boolean {
  return getErrorCode(err) === code;
}

export function formatUnknownError(err: unknown): string {
  return `[${getErrorCode(err)}] ${getErrorMessage(err)}`;
}

export function collectErrorMessages(errors: unknown[]): string[] {
  return errors.map(getErrorMessage);
}
