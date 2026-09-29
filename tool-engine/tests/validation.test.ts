import { describe, it, expect } from 'vitest';
import { type ToolDefinition } from '../src/validation/types.js';
import { ParamValidator } from '../src/validation/retrieval.js';
import { ValidationStore } from '../src/validation/store.js';
import { ValidationLifecycle } from '../src/validation/lifecycle.js';
import { createToolValidator } from '../src/validation/integration.js';

const httpGet: ToolDefinition = {
  name: 'http.get',
  description: 'Perform an HTTP GET request',
  handler: async () => ({}),
  parameters: [
    { name: 'url', type: 'string', required: true },
    { name: 'retries', type: 'integer', required: false, default: 3 },
  ],
};

describe('validation', () => {
  it('ParamValidator flags missing, type and enum issues', () => {
    const validator = new ParamValidator();

    const missing = validator.validateParams(
      [{ name: 'url', type: 'string', required: true }],
      {},
    );
    expect(missing.valid).toBe(false);
    expect(missing.issues[0].code).toBe('missing');

    const badType = validator.validateParams(
      [{ name: 'url', type: 'string', required: true }],
      { url: { nested: true } },
    );
    expect(badType.valid).toBe(false);
    expect(badType.issues[0].code).toBe('type');

    const badEnum = validator.validateParams(
      [{ name: 'method', type: 'string', required: true, enum: ['GET', 'POST'] }],
      { method: 'DELETE' },
    );
    expect(badEnum.valid).toBe(false);
    expect(badEnum.issues[0].code).toBe('enum');
  });

  it('ParamValidator coerces values into the declared type', () => {
    const validator = new ParamValidator();
    const result = validator.validateParams(
      [{ name: 'retries', type: 'number', required: true }],
      { retries: '42' },
    );
    expect(result.valid).toBe(true);
    expect(result.coerced?.retries).toBe(42);
  });

  it('ParamValidator validates definitions', () => {
    const validator = new ParamValidator();
    expect(validator.validateDefinition(httpGet).valid).toBe(true);

    const bad = validator.validateDefinition({} as never);
    expect(bad.valid).toBe(false);
    expect(bad.issues.length).toBeGreaterThan(0);
  });

  it('ToolValidator validates params and definitions through the facade', () => {
    const validator = createToolValidator();
    validator.registerSchema(httpGet);
    expect(validator.has('http.get')).toBe(true);
    expect(validator.size).toBe(1);

    const ok = validator.validateParams('http.get', { url: 'https://x.dev' });
    expect(ok.valid).toBe(true);
    expect(ok.coerced?.retries).toBe(3);

    const bad = validator.validateParams('http.get', {});
    expect(bad.valid).toBe(false);
    expect(bad.issues.some((issue) => issue.code === 'missing')).toBe(true);

    expect(validator.validateDefinition(httpGet).valid).toBe(true);
  });

  it('ValidationLifecycle registers schemas and prunes in bulk', () => {
    const store = new ValidationStore();
    const lifecycle = new ValidationLifecycle({ store });
    lifecycle.registerSchema('a', [{ name: 'x', type: 'string', required: true }]);
    lifecycle.registerSchema('b', [{ name: 'y', type: 'string', required: true }]);
    lifecycle.registerSchema('c', [{ name: 'z', type: 'string', required: true }]);
    expect(lifecycle.store.size).toBe(3);

    const removed = lifecycle.prune(['a', 'b']);
    expect(removed).toBe(2);
    expect(lifecycle.store.size).toBe(1);
    expect(lifecycle.has('c')).toBe(true);
  });
});