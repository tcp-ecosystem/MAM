import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../src/score.ts';

const normalized = {
  name: 'ada lovelace',
  length: 12,
  tokens: ['ada', 'lovelace'],
};

test('scores the normalized upstream payload', () => {
  const result = score({
    inputs: { name: 'Ada Lovelace' },
    upstream: normalized,
  });

  assert.deepEqual(result, {
    score: 122,
    label: 'ADA LOVELACE (12)',
    tokenCount: 2,
  });
});

test('rejects a missing upstream payload', () => {
  assert.throws(
    () => score({ inputs: { name: 'Ada Lovelace' } }),
    /upstream/,
  );
});
