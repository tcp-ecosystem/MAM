/**
 * Structured LIR errors. Adapters and the registry convert these into
 * normalized failures; they are never swallowed into a success result.
 */

import type { JsonValue, LirErrorCode } from './types.js';

export class LirError extends Error {
  readonly code: LirErrorCode;
  readonly details?: JsonValue;

  constructor(code: LirErrorCode, message: string, details?: JsonValue) {
    super(message);
    this.name = 'LirError';
    this.code = code;
    this.details = details;
  }
}

export function isLirError(value: unknown): value is LirError {
  return value instanceof LirError;
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function errorStack(value: unknown): string | undefined {
  return value instanceof Error && typeof value.stack === 'string'
    ? value.stack
    : undefined;
}
