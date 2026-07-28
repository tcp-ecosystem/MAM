/**
 * MAM Validation Error Types
 */

export interface ValidationErrorOptions {
  rule: string;
  message: string;
  line?: number;
  column?: number;
  severity?: 'error' | 'warning' | 'info';
}

export class MAMValidationError extends Error {
  rule: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';

  constructor(options: ValidationErrorOptions) {
    super(options.message);
    this.name = 'MAMValidationError';
    this.rule = options.rule;
    this.line = options.line;
    this.column = options.column;
    this.severity = options.severity ?? 'error';
  }
}
