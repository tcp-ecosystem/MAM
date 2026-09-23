/**
 * V2 engine tests: Observability, Policy, Resource Manager, Agent, Sandbox.
 */

import { describe, it, expect } from 'vitest';
import { ObservabilityEngine } from '../src/v2/observability.js';
import { DefaultPolicyEngine } from '../src/v2/policy-engine.js';
import { ResourceManager } from '../src/v2/resource-manager.js';
import { AgentEngine, type ModelAdapter } from '../src/v2/agent-engine.js';
import { SandboxManager, PermissionViolationError } from '../src/v2/sandbox.js';

describe('ObservabilityEngine', () => {
  it('records logs, metrics and traces', () => {
    const obs = new ObservabilityEngine();
    obs.info('hello', 'test');
    obs.metric('latency', 12.5, 'ms');
    const id = obs.startSpan('run');
    obs.endSpan(id);
    const report = obs.report();
    expect(report.stats.logCount).toBe(1);
    expect(report.stats.metricCount).toBe(1);
    expect(report.stats.spanCount).toBe(1);
    expect(report.spans[0]?.status).toBe('ok');
  });

  it('records token usage, model and tool calls', () => {
    const obs = new ObservabilityEngine();
    obs.recordTokenUsage(100, 50, 'gpt', 'openai');
    obs.recordModelCall({ model: 'gpt', provider: 'openai', latencyMs: 200, cost: 0.01, tokensIn: 100, tokensOut: 50, success: true });
    obs.recordToolCall({ tool: 'search', params: { q: 'x' }, latencyMs: 30, success: true });
    const stats = obs.getStats();
    expect(stats.totalTokens).toBe(150);
    expect(stats.modelCallCount).toBe(1);
    expect(stats.toolCallCount).toBe(1);
  });

  it('can be disabled', () => {
    const obs = new ObservabilityEngine({ enabled: false });
    obs.info('x');
    obs.metric('m', 1);
    expect(obs.report().stats.logCount).toBe(0);
  });
});

describe('DefaultPolicyEngine', () => {
  it('defaults to deny', async () => {
    const policy = new DefaultPolicyEngine();
    const decision = await policy.evaluate('anything', {});
    expect(decision.allowed).toBe(false);
  });

  it('allows and denies by action', async () => {
    const policy = new DefaultPolicyEngine();
    policy.addAllow('allow-run', 'Allow Run', 'run');
    policy.addDeny('deny-rm', 'Deny rm', 'rm');
    expect((await policy.evaluate('run', {})).allowed).toBe(true);
    expect((await policy.evaluate('rm', {})).allowed).toBe(false);
  });

  it('summarizes policies by kind', () => {
    const policy = new DefaultPolicyEngine();
    policy.addTimeoutRule('t', 'timeout', { maxSeconds: 30, action: 'abort' });
    const summary = policy.summarize();
    expect(summary.byKind.timeout).toBe(1);
    expect(summary.total).toBeGreaterThan(1);
  });
});

describe('ResourceManager', () => {
  it('registers, acquires and releases resources', () => {
    const rm = new ResourceManager();
    rm.register({ name: 'db', type: 'service', capacity: 2 });
    const lease = rm.acquire('db');
    expect(lease.type).toBe('service');
    expect(rm.getStats().active).toBe(1);
    expect(rm.release(lease.id)).toBe(true);
    expect(rm.getStats().active).toBe(0);
  });

  it('enforces capacity', () => {
    const rm = new ResourceManager();
    rm.register({ name: 'db', type: 'service', capacity: 1 });
    rm.acquire('db');
    expect(() => rm.acquire('db')).toThrow(/capacity/);
  });

  it('checks permissions', () => {
    const rm = new ResourceManager();
    rm.register({ name: 'fs', type: 'filesystem', permissions: ['read'] });
    expect(rm.checkPermission('fs', 'read')).toBe(true);
    expect(rm.checkPermission('fs', 'write')).toBe(false);
  });
});

describe('AgentEngine', () => {
  it('runs an agent without tools', async () => {
    const model: ModelAdapter = {
      name: 'mock', provider: 'test',
      async invoke(input: string) {
        return { text: 'final answer', tokensIn: 10, tokensOut: 5 };
      },
    };
    const engine = new AgentEngine();
    const agent = engine.createAgent({ name: 'a', model, systemPrompt: 'be helpful' });
    const result = await agent.run('hi');
    expect(result.output).toContain('final answer');
    expect(result.toolCalls).toBe(0);
  });

  it('invokes tools when requested', async () => {
    let toolCalled = 0;
    const model: ModelAdapter = {
      name: 'mock', provider: 'test',
      async invoke(input: string) {
        toolCalled++;
        return toolCalled === 1
          ? { text: '[[tool:search]] {"q":"mam"}', tokensIn: 10, tokensOut: 5 }
          : { text: 'done', tokensIn: 5, tokensOut: 2 };
      },
    };
    const engine = new AgentEngine();
    const agent = engine.createAgent({
      name: 'a',
      model,
      tools: {
        list: () => [{ name: 'search', description: 'search' }],
        invoke: async (name: string, params: Record<string, unknown>) => ({ results: [params.q] }),
      },
    });
    const result = await agent.run('find mam');
    expect(result.toolCalls).toBe(1);
    expect(result.output).toBe('done');
  });
});

describe('SandboxManager', () => {
  it('allows read and blocks write by default', async () => {
    const manager = new SandboxManager();
    const sandbox = manager.createSandbox({ seedFiles: { '/data.txt': 'hello' } });
    const res = await sandbox.execute(async (api) => {
      const content = await api.fs.read('/data.txt');
      return content;
    });
    expect(res.success).toBe(true);
    expect(res.result).toBe('hello');

    const denied = await sandbox.execute(async (api) => {
      await api.fs.write('/x', 'y');
    });
    expect(denied.success).toBe(false);
    expect(denied.violations.some((v) => v.includes('fs.write'))).toBe(true);
  });

  it('blocks network when not allowed', async () => {
    const manager = new SandboxManager();
    const sandbox = manager.createSandbox({});
    const res = await sandbox.execute(async (api) => api.net.fetch('https://example.com'));
    expect(res.success).toBe(false);
  });

  it('reports isolation summary', () => {
    const manager = new SandboxManager();
    const sandbox = manager.createSandbox({ limits: { timeoutMs: 1000 } });
    const isolation = sandbox.isolation();
    expect(isolation.join(' ')).toContain('read-only');
    expect(isolation.join(' ')).toContain('denied');
  });
});