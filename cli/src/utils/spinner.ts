/**
 * MAM Spinner
 * 
 * Spinner utility for CLI with colored output.
 */

import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

export interface SpinnerConfig {
  /** Spinner text */
  text: string;
  /** Spinner symbol */
  symbol?: string;
  /** Success symbol */
  successSymbol?: string;
  /** Error symbol */
  errorSymbol?: string;
  /** Warning symbol */
  warningSymbol?: string;
  /** Interval in ms */
  interval?: number;
}

// ============================================================================
// Spinner
// ============================================================================

export class Spinner {
  private config: SpinnerConfig;
  private frameIndex: number = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isSpinning: boolean = false;

  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(config: SpinnerConfig) {
    this.config = {
      symbol: '⠋',
      successSymbol: '✓',
      errorSymbol: '✗',
      warningSymbol: '⚠',
      interval: 80,
      ...config,
    };
  }

  /**
   * Start the spinner
   */
  start(): this {
    this.isSpinning = true;
    this.frameIndex = 0;
    
    process.stderr.write('\x1B[?25l'); // Hide cursor
    
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, this.config.interval);

    this.render();
    return this;
  }

  /**
   * Stop the spinner
   */
  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isSpinning = false;
    process.stderr.write('\r\x1B[K'); // Clear line
    process.stderr.write('\x1B[?25h'); // Show cursor
    return this;
  }

  /**
   * Update spinner text
   */
  setText(text: string): this {
    this.config.text = text;
    if (this.isSpinning) {
      this.render();
    }
    return this;
  }

  /**
   * Succeed with message
   */
  succeed(text?: string): this {
    this.stop();
    const msg = text || this.config.text;
    process.stderr.write(`${chalk.green(this.config.successSymbol)} ${msg}\n`);
    return this;
  }

  /**
   * Fail with message
   */
  fail(text?: string): this {
    this.stop();
    const msg = text || this.config.text;
    process.stderr.write(`${chalk.red(this.config.errorSymbol)} ${msg}\n`);
    return this;
  }

  /**
   * Warn with message
   */
  warn(text?: string): this {
    this.stop();
    const msg = text || this.config.text;
    process.stderr.write(`${chalk.yellow(this.config.warningSymbol)} ${msg}\n`);
    return this;
  }

  /**
   * Info with message
   */
  info(text?: string): this {
    this.stop();
    const msg = text || this.config.text;
    process.stderr.write(`${chalk.blue('ℹ')} ${msg}\n`);
    return this;
  }

  /**
   * Render the spinner
   */
  private render(): void {
    const frame = this.frames[this.frameIndex];
    process.stderr.write(`\r${chalk.cyan(frame)} ${this.config.text}`);
  }
}

/**
 * Create a spinner
 */
export function createSpinner(text: string): Spinner {
  return new Spinner({ text });
}