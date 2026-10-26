/**
 * Score a normalized name for the Interop Demo system.
 *
 * LIR passes `{ inputs, upstream }` because this declaration uses
 * `inputFrom: normalize`. The function must return a JSON-compatible value.
 */

export interface Normalized {
  name: string;
  length: number;
  tokens: string[];
}

export interface ScoreEnvelope {
  inputs: { name?: string };
  upstream: Normalized;
}

export interface ScoreResult {
  score: number;
  label: string;
  tokenCount: number;
}

export function score(payload: ScoreEnvelope): ScoreResult {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('score expects a JSON object input');
  }

  const upstream = payload.upstream;
  if (
    !upstream
    || typeof upstream.name !== 'string'
    || !Array.isArray(upstream.tokens)
  ) {
    throw new TypeError('score requires an upstream object from normalize');
  }

  const { name, length, tokens } = upstream;
  return {
    score: length * 10 + tokens.length,
    label: `${name.toUpperCase()} (${length})`,
    tokenCount: tokens.length,
  };
}
