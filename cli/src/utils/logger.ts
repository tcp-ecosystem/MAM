/**
 * MAM Logger
 * 
 * Logging utility for CLI with colored output and log levels.
 */

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerConfig {
  /** Log level */
  level: LogLevel;
  /** Whether to use colors */
  colors: boolean;
  /** Whether to include timestamp */
  timestamp: boolean;
  /** Whether to include source */
  source: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  silent: '',
};

const RESET = '\x1b[0m';

// ============================================================================
// Logger
// ============================================================================

let currentConfig: LoggerConfig = {
  level: 'info',
  colors: true,
  timestamp: true,
  source: false,
};

/**
 * Set log level
 */
export function setLogLevel(level: LogLevel): void {
  currentConfig.level = level;
}

/**
 * Set logger config
 */
export function setLoggerConfig(config: Partial<LoggerConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

/**
 * Get logger config
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...currentConfig };
}

/**
 * Check if should log
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentConfig.level];
}

/**
 * Format timestamp
 */
function formatTimestamp(): string {
  if (!currentConfig.timestamp) return '';
  return `[${new Date().toISOString()}] `;
}

/**
 * Format log message
 */
function formatMessage(level: LogLevel, message: string, source?: string): string {
  let msg = '';
  
  if (currentConfig.colors) {
    msg += COLORS[level];
  }
  
  msg += formatTimestamp();
  
  if (source && currentConfig.source) {
    msg += `[${source}] `;
  }
  
  msg += `${level.toUpperCase()}: ${message}`;
  
  if (currentConfig.colors) {
    msg += RESET;
  }
  
  return msg;
}

/**
 * Logger instance
 */
export const logger = {
  debug: (message: string, ...args: unknown[]) => {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message), ...args);
    }
  },
  
  info: (message: string, ...args: unknown[]) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message), ...args);
    }
  },
  
  warn: (message: string, ...args: unknown[]) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message), ...args);
    }
  },
  
  error: (message: string, ...args: unknown[]) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message), ...args);
    }
  },
  
  /**
   * Create a child logger with source
   */
  child: (source: string) => ({
    debug: (message: string, ...args: unknown[]) => {
      if (shouldLog('debug')) {
        console.debug(formatMessage('debug', message, source), ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (shouldLog('info')) {
        console.log(formatMessage('info', message, source), ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (shouldLog('warn')) {
        console.warn(formatMessage('warn', message, source), ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (shouldLog('error')) {
        console.error(formatMessage('error', message, source), ...args);
      }
    },
  }),
};

/**
 * Create a named logger
 */
export function createLogger(name: string) {
  return logger.child(name);
}