/**
 * Adapter helpers shared by the Python and Node adapters.
 */

import type {
  LirErrorCode,
  LirInvocationFailure,
  LirInvocationRequest,
  LirInvocationResult,
  LirInvocationSuccess,
  LirLanguage,
  JsonValue,
} from '../types.js';
import type { ProcessOutcome } from '../process.js';

export const LIR_SENTINEL = '__MAM_LIR_RESULT__';

export interface ProtocolExtraction {
  /** Implementation output with the protocol line removed. */
  stdout: string;
  /** Parsed protocol payload, when present. */
  payload?: { ok: boolean; value?: JsonValue; error?: { name?: string; message?: string; stack?: string } };
  found: boolean;
  parseError?: string;
}

/** Remove and parse the last LIR protocol line from stdout. */
export function extractProtocol(stdout: string): ProtocolExtraction {
  const lines = stdout.split(/\r?\n/);
  let markerIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]!.startsWith(LIR_SENTINEL)) {
      markerIndex = index;
      break;
    }
  }

  if (markerIndex < 0) {
    return { stdout, found: false };
  }

  const text = lines.slice(0, markerIndex).join('\n');
  const raw = lines[markerIndex]!.slice(LIR_SENTINEL.length);

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { stdout: text, found: false, parseError: 'protocol payload is not an object' };
    }
    return {
      stdout: text,
      found: true,
      payload: parsed as ProtocolExtraction['payload'],
    };
  } catch (error) {
    return {
      stdout: text,
      found: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function baseResult(
  request: LirInvocationRequest,
  adapter: string,
  command: string,
  outcome: ProcessOutcome,
  stdout: string,
): Omit<LirInvocationSuccess, 'ok' | 'value'> {
  return {
    implementationId: request.implementation.id,
    language: request.implementation.language,
    adapter,
    command,
    stdout,
    stderr: outcome.stderr,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    aborted: outcome.aborted,
    outputTruncated: outcome.outputTruncated,
  };
}

export function failure(
  request: LirInvocationRequest,
  adapter: string,
  command: string,
  outcome: ProcessOutcome,
  code: LirErrorCode,
  message: string,
  stdout = '',
  details?: JsonValue,
): LirInvocationFailure {
  return {
    ...baseResult(request, adapter, command, outcome, stdout),
    ok: false,
    error: details === undefined
      ? { code, message }
      : { code, message, details },
  };
}

/**
 * Convert a completed process into a normalized LIR result.
 *
 * Precedence matters: process-level failures (spawn, timeout, cancellation,
 * truncation) are reported before protocol parsing, so a partial result can
 * never be mistaken for success.
 */
export function normalizeProcessResult(
  request: LirInvocationRequest,
  adapter: string,
  command: string,
  outcome: ProcessOutcome,
  language: LirLanguage,
): LirInvocationResult {
  const protocol = extractProtocol(outcome.stdout);
  const stdout = protocol.stdout;

  if (outcome.spawnError) {
    const missing = outcome.spawnError.code === 'ENOENT';
    return failure(
      request,
      adapter,
      command,
      outcome,
      missing ? 'LIR_RUNTIME_MISSING' : 'LIR_INVOKE_FAILED',
      missing
        ? `${adapter} runtime not found: ${command}`
        : `Failed to start ${adapter}: ${outcome.spawnError.message}`,
      stdout,
    );
  }

  if (outcome.timedOut) {
    return failure(
      request,
      adapter,
      command,
      outcome,
      'LIR_TIMEOUT',
      `${language} implementation "${request.implementation.id}" timed out after ${request.timeoutMs}ms`,
      stdout,
    );
  }

  if (outcome.aborted) {
    return failure(
      request,
      adapter,
      command,
      outcome,
      'LIR_ABORTED',
      `Execution of "${request.implementation.id}" was aborted`,
      stdout,
    );
  }

  if (outcome.outputTruncated && !protocol.found) {
    return failure(
      request,
      adapter,
      command,
      outcome,
      'LIR_OUTPUT_LIMIT',
      `Output exceeded the ${request.maxOutputBytes}-byte limit before a result was produced`,
      stdout,
    );
  }

  if (protocol.parseError) {
    return failure(
      request,
      adapter,
      command,
      outcome,
      'LIR_PROTOCOL',
      `Malformed LIR protocol payload: ${protocol.parseError}`,
      stdout,
    );
  }

  if (!protocol.found || !protocol.payload) {
    const stderr = outcome.stderr.trim();
    if (outcome.exitCode !== 0) {
      return failure(
        request,
        adapter,
        command,
        outcome,
        'LIR_EXIT',
        `${language} implementation exited with code ${outcome.exitCode ?? 'null'}${stderr ? `: ${stderr}` : ''}`,
        stdout,
      );
    }
    return failure(
      request,
      adapter,
      command,
      outcome,
      'LIR_PROTOCOL',
      `${language} implementation produced no LIR result marker`,
      stdout,
    );
  }

  if (protocol.payload.ok === true) {
    if (!hasOwn(protocol.payload, 'value')) {
      return failure(
        request,
        adapter,
        command,
        outcome,
        'LIR_RESULT_INVALID',
        'LIR protocol success payload is missing "value"',
        stdout,
      );
    }
    if (outcome.exitCode !== 0) {
      return failure(
        request,
        adapter,
        command,
        outcome,
        'LIR_EXIT',
        `${language} implementation reported success but exited with code ${outcome.exitCode}`,
        stdout,
      );
    }
    return {
      ...baseResult(request, adapter, command, outcome, stdout),
      ok: true,
      value: protocol.payload.value as JsonValue,
    };
  }

  if (protocol.payload.ok === false) {
    const error = protocol.payload.error ?? {};
    const details: JsonValue = {
      name: typeof error.name === 'string' ? error.name : 'Error',
      ...(typeof error.stack === 'string' ? { stack: error.stack.slice(0, 8_000) } : {}),
    };
    return failure(
      request,
      adapter,
      command,
      outcome,
      'LIR_INVOKE_FAILED',
      typeof error.message === 'string' && error.message
        ? error.message
        : `${language} implementation failed`,
      stdout,
      details,
    );
  }

  return failure(
    request,
    adapter,
    command,
    outcome,
    'LIR_PROTOCOL',
    'LIR protocol payload is missing a boolean "ok" field',
    stdout,
  );
}
