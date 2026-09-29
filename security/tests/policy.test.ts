import { describe, it, expect } from 'vitest';
import { PolicyStore } from '../src/policy/store.js';
import { PolicyIndex } from '../src/policy/index.js';
import { PolicyEvaluator } from '../src/policy/retrieval.js';
import { PolicyLifecycle } from '../src/policy/lifecycle.js';
import { createSecurityPolicyEngine, SecurityPolicyError } from '../src/policy/integration.js';

describe('policy', () => {
  it('PolicyStore adds and removes rules', () => {
    const store = new PolicyStore();
    const rule = store.addRule({ id: 'read-docs', effect: 'allow', action: 'read', resource: 'document' });
    expect(rule.id).toBe('read-docs');
    expect(rule.effect).toBe('allow');
    expect(store.hasRule('read-docs')).toBe(true);
    expect(store.listRules()).toHaveLength(1);
    expect(store.removeRule('read-docs')).toBe(true);
    expect(store.hasRule('read-docs')).toBe(false);
  });

  it('PolicyEvaluator evaluates allow/deny rules', () => {
    const store = new PolicyStore();
    store.addRule({ id: 'read-docs', effect: 'allow', action: 'read', resource: 'document' });
    store.addRule({ id: 'block-secrets', effect: 'deny', resource: 'secrets' });
    const evaluator = new PolicyEvaluator(store);

    const ok = evaluator.evaluate({ action: 'read', resource: 'document' });
    expect(ok.allowed).toBe(true);
    expect(ok.matchedRuleId).toBe('read-docs');

    const denied = evaluator.evaluate({ action: 'read', resource: 'secrets' });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('denied');

    const defaultDenied = evaluator.evaluate({ action: 'delete', resource: 'document' });
    expect(defaultDenied.allowed).toBe(false);
    expect(defaultDenied.reason).toBe('default-deny');
  });

  it('PolicyEvaluator sanitizes input', () => {
    const evaluator = new PolicyEvaluator(new PolicyStore());
    const result = evaluator.sanitize('<script>alert(1)</script>hello');
    expect(result.sanitized).not.toContain('<script>');
    expect(result.changed).toBe(true);

    const noJs = evaluator.sanitize('javascript:alert(1)');
    expect(noJs.sanitized).not.toContain('javascript:');

    const capped = evaluator.sanitize('a'.repeat(50), { maxLength: 10 });
    expect(capped.sanitized).toHaveLength(10);
    expect(capped.removed).toBe(40);
  });

  it('PolicyEvaluator enforces rate limits', () => {
    const evaluator = new PolicyEvaluator(new PolicyStore());
    const spec = { windowMs: 1000, max: 2 };
    expect(evaluator.checkRateLimit('api:u-1', spec).allowed).toBe(true);
    expect(evaluator.checkRateLimit('api:u-1', spec).allowed).toBe(true);
    const third = evaluator.checkRateLimit('api:u-1', spec);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
    expect(third.remaining).toBe(0);
  });

  it('PolicyEvaluator validates dependencies', () => {
    const evaluator = new PolicyEvaluator(new PolicyStore());
    const ok = evaluator.validateDependencies(['lodash', '@mam/core'], ['lodash', '@mam/*']);
    expect(ok.valid).toBe(true);
    expect(ok.allowed).toContain('lodash');

    const bad = evaluator.validateDependencies(['lodash', 'evil-pkg'], ['lodash']);
    expect(bad.valid).toBe(false);
    expect(bad.unknown).toContain('evil-pkg');
  });

  it('SecurityPolicyEngine evaluates, enforces, sanitizes and rate-limits', () => {
    const engine = createSecurityPolicyEngine();
    engine.addRule({ id: 'allow-read', effect: 'allow', action: 'read', resource: 'document' });

    expect(engine.evaluate({ action: 'read', resource: 'document' }).allowed).toBe(true);
    expect(engine.can({ action: 'read', resource: 'document' })).toBe(true);
    expect(() => engine.enforce({ action: 'delete', resource: 'document' })).toThrow(SecurityPolicyError);

    const safe = engine.sanitize('<script>alert(1)</script>hi');
    expect(safe.sanitized).not.toContain('<script>');

    const spec = { windowMs: 1000, max: 1 };
    expect(engine.rateLimit('k', spec).allowed).toBe(true);
    expect(engine.rateLimit('k', spec).allowed).toBe(false);

    expect(engine.removeRule('allow-read')).toBe(true);
    expect(engine.hasRule('allow-read')).toBe(false);
  });

  it('PolicyLifecycle prunes disabled rules', () => {
    const store = new PolicyStore();
    const index = new PolicyIndex();
    const evaluator = new PolicyEvaluator(store, index);
    const lifecycle = new PolicyLifecycle(store, index, evaluator);

    lifecycle.addRule({ id: 'temp', effect: 'allow', action: 'read', resource: 'x' });
    lifecycle.addRule({ id: 'keeper', effect: 'allow', action: 'write', resource: 'x' });
    expect(lifecycle.disable('temp')).toBe(true);

    const removed = lifecycle.prune();
    expect(removed).toContain('temp');
    expect(removed).not.toContain('keeper');
    expect(store.hasRule('temp')).toBe(false);
    expect(store.hasRule('keeper')).toBe(true);
  });
});