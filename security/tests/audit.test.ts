import { describe, it, expect } from 'vitest';
import { AuditStore } from '../src/audit/store.js';
import { AuditQuery } from '../src/audit/retrieval.js';
import { AuditLifecycle } from '../src/audit/lifecycle.js';
import { createAuditLogger, createSecurityReporter, Redactor } from '../src/audit/integration.js';

describe('audit', () => {
  it('AuditStore appends, records and filters by type', () => {
    const store = new AuditStore();
    const event = store.append({ type: 'access', action: 'read', result: 'allowed', actor: 'alice' });
    expect(store.has(event.id)).toBe(true);
    expect(store.size()).toBe(1);
    store.record({ type: 'auth', action: 'login', actor: 'bob' });
    store.record({ type: 'access', action: 'delete', result: 'denied', actor: 'bob' });
    expect(store.size()).toBe(3);
    expect(store.getByType('access')).toHaveLength(2);
    expect(store.getByType('auth')).toHaveLength(1);
    expect(store.getByResult('denied')).toHaveLength(1);
  });

  it('AuditQuery recent / byType / summary', () => {
    const store = new AuditStore();
    store.record({ type: 'access', action: 'read', result: 'allowed', actor: 'alice' });
    store.record({ type: 'access', action: 'delete', result: 'denied', actor: 'bob' });
    const query = new AuditQuery({ store });

    const recent = query.recent();
    expect(recent).toHaveLength(2);
    expect(query.byType('access')).toHaveLength(2);
    expect(query.denied()).toHaveLength(1);

    const summary = query.summary();
    expect(summary.total).toBe(2);
    expect(summary.denied).toBe(1);
    expect(summary.allowed).toBe(1);
    expect(summary.topActions.length).toBeGreaterThan(0);
    expect(summary.perType.access).toBe(2);
  });

  it('AuditLogger records events and detects anomalies', () => {
    const audit = createAuditLogger();
    audit.recordAllowed('document.read', 'alice', { target: 'doc-1' });
    for (let i = 0; i < 5; i += 1) {
      audit.recordDenied('document.delete', 'alice', { target: 'doc-42' });
    }
    audit.recordError('kms.decrypt', 'provider unreachable');

    const flags = audit.detectAnomalies();
    expect(flags.some((f) => f.ruleId === 'denial-burst')).toBe(true);

    const stats = audit.stats();
    expect(stats.total).toBe(7);
    expect(stats.byResult.denied).toBe(5);

    const q = audit.query();
    expect(q.byActor('alice')).toHaveLength(6);
  });

  it('SecurityReporter produces a report', () => {
    const store = new AuditStore();
    store.record({ type: 'access', action: 'read', result: 'allowed', actor: 'alice' });
    store.record({ type: 'access', action: 'delete', result: 'denied', actor: 'alice' });
    store.record({ type: 'access', action: 'delete', result: 'denied', actor: 'bob' });

    const reporter = createSecurityReporter({}, { store });
    const report = reporter.report();
    expect(report.totalEvents).toBe(3);
    expect(report.deniedRatio).toBeCloseTo(2 / 3, 5);
    expect(report.byResult.denied).toBe(2);
    expect(report.topActors.length).toBeGreaterThan(0);
    expect(report.recentDenied).toHaveLength(2);
    expect(typeof report.generatedAt).toBe('number');
  });

  it('Redactor masks secrets', () => {
    const redactor = new Redactor();
    expect(redactor.redact('contact alice@example.com now')).not.toContain('alice@example.com');
    expect(redactor.redact('key sk-abcdefgh12345678')).not.toContain('sk-abcdefgh12345678');
    expect(redactor.redact('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
    expect(redactor.redact('password: hunter2')).not.toContain('hunter2');
    expect(redactor.redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature')).toContain('***');
  });

  it('AuditLifecycle prunes by age', () => {
    const store = new AuditStore();
    const lifecycle = new AuditLifecycle({ store });
    store.record({ type: 'access', action: 'read', actor: 'alice', timestamp: Date.now() - 60_000 });
    store.record({ type: 'access', action: 'read', actor: 'bob', timestamp: Date.now() });

    const result = lifecycle.prune(10_000);
    expect(result.count).toBe(1);
    expect(store.size()).toBe(1);

    expect(lifecycle.isRunning()).toBe(false);
    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.isRunning()).toBe(true);
    expect(lifecycle.stop()).toBe(true);
    expect(lifecycle.isRunning()).toBe(false);
    lifecycle.dispose();
  });
});