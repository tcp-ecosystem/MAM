/**
 * V2 Runtime Tests
 *
 * Comprehensive tests for MAMV2Runtime, createV2Runtime, DEFAULT_RUNTIME_CONFIG,
 * and the internal implementations (InMemoryMemoryStore, DefaultEventEmitter,
 * DefaultStateManager, DefaultPermissionChecker, DefaultPluginLoader) tested
 * indirectly through the runtime's public API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAMV2Runtime, createV2Runtime, DEFAULT_RUNTIME_CONFIG } from '../src/v2/index.js';
import { createLocation } from '@mam/ast';
import type { V2ModuleNode, V2StepNode, V2EdgeNode } from '@mam/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLocationForTest() {
  return createLocation(1, 0, 0, 10, 0, 100, 'test');
}

function createV2Module(overrides?: Partial<V2ModuleNode>): V2ModuleNode {
  return {
    type: 'ModuleNode',
    name: 'test-module',
    moduleType: 'module',
    location: createLocationForTest(),
    ...overrides,
  };
}

function createAgentModule(overrides?: Partial<V2ModuleNode>): V2ModuleNode {
  return createV2Module({
    name: 'test-agent',
    moduleType: 'agent',
    role: 'assistant',
    goal: 'help the user',
    tools: ['search', 'calculator'],
    ...overrides,
  });
}

function createToolModule(overrides?: Partial<V2ModuleNode>): V2ModuleNode {
  return createV2Module({
    name: 'test-tool',
    moduleType: 'tool',
    provider: 'openai',
    capabilities: ['text-generation'],
    ...overrides,
  });
}

function createMemoryModule(overrides?: Partial<V2ModuleNode>): V2ModuleNode {
  return createV2Module({
    name: 'test-memory',
    moduleType: 'memory',
    format: 'key-value',
    backend: 'redis',
    scope: 'shared',
    ...overrides,
  });
}

function createWorkflowModule(steps?: V2StepNode[], edges?: V2EdgeNode[]): V2ModuleNode {
  return createV2Module({
    name: 'test-workflow',
    moduleType: 'workflow',
    steps: steps ?? [
      { type: 'StepNode', name: 'step-1', location: createLocationForTest() },
      { type: 'StepNode', name: 'step-2', location: createLocationForTest() },
    ],
    edges: edges ?? [
      {
        type: 'EdgeNode',
        name: 'edge-1',
        from: 'step-1',
        to: 'step-2',
        location: createLocationForTest(),
      },
    ],
  });
}

function createPolicyModule(overrides?: Partial<V2ModuleNode>): V2ModuleNode {
  return createV2Module({
    name: 'test-policy',
    moduleType: 'policy',
    allow: ['filesystem:read', 'network:api'],
    deny: ['filesystem:write'],
    ...overrides,
  });
}

function createTestContext(module?: V2ModuleNode) {
  const mod = module ?? createV2Module();
  return {
    module: mod,
    allModules: new Map([[mod.name, mod]]),
    inputs: {},
    memory: createV2Runtime().constructor.prototype, // placeholder
    events: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      history: vi.fn().mockReturnValue([]),
    },
    state: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      getAll: vi.fn().mockReturnValue({}),
      subscribe: vi.fn(),
      history: vi.fn().mockReturnValue([]),
    },
    permissions: {
      check: vi.fn().mockReturnValue({ allowed: true }),
      getAllowed: vi.fn().mockReturnValue([]),
      getDenied: vi.fn().mockReturnValue([]),
    },
    options: {},
  };
}

function createRealContext(module?: V2ModuleNode) {
  const mod = module ?? createV2Module();
  // We need to use the runtime's internal context, but since we can't access it
  // directly, we'll create a context-like object that the runtime will use.
  // For the actual tests, we'll use the runtime's execute method which creates
  // the context internally.
  return {
    module: mod,
    allModules: new Map([[mod.name, mod]]),
    inputs: {},
    options: {},
  };
}

// ---------------------------------------------------------------------------
// Tests: DEFAULT_RUNTIME_CONFIG
// ---------------------------------------------------------------------------

describe('DEFAULT_RUNTIME_CONFIG', () => {
  it('should have default values', () => {
    expect(DEFAULT_RUNTIME_CONFIG).toBeDefined();
    expect(DEFAULT_RUNTIME_CONFIG.defaultTimeout).toBe(30000);
    expect(DEFAULT_RUNTIME_CONFIG.memoryLimit).toBe(256 * 1024 * 1024);
    expect(DEFAULT_RUNTIME_CONFIG.logging).toBe(true);
    expect(DEFAULT_RUNTIME_CONFIG.logLevel).toBe('info');
    expect(Array.isArray(DEFAULT_RUNTIME_CONFIG.pluginDirs)).toBe(true);
  });

  it('should have workingDir as cwd', () => {
    expect(DEFAULT_RUNTIME_CONFIG.workingDir).toBe(process.cwd());
  });
});

// ---------------------------------------------------------------------------
// Tests: MAMV2Runtime
// ---------------------------------------------------------------------------

describe('MAMV2Runtime', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = new MAMV2Runtime();
    await runtime.init({});
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  describe('init', () => {
    it('should initialize runtime', async () => {
      const r = new MAMV2Runtime();
      await r.init({});
      expect(r).toBeDefined();
    });

    it('should initialize with custom config', async () => {
      const r = new MAMV2Runtime();
      await r.init({
        defaultTimeout: 5000,
        logging: false,
        logLevel: 'error',
      });
      expect(r).toBeDefined();
    });

    it('should set name and version', () => {
      expect(runtime.name).toBe('mam-v2');
      expect(runtime.version).toBe('0.1.0');
    });

    it('should have supported types', () => {
      expect(runtime.supportedTypes).toContain('agent');
      expect(runtime.supportedTypes).toContain('tool');
      expect(runtime.supportedTypes).toContain('memory');
      expect(runtime.supportedTypes).toContain('workflow');
      expect(runtime.supportedTypes).toContain('policy');
      expect(runtime.supportedTypes).toContain('module');
    });
  });

  describe('execute', () => {
    it('should throw if not initialized', async () => {
      const r = new MAMV2Runtime();
      const mod = createV2Module();
      const ctx = createTestContext(mod);
      await expect(r.execute(mod, ctx as any)).rejects.toThrow('not initialized');
    });

    it('should execute a generic module', async () => {
      const mod = createV2Module({ name: 'generic', moduleType: 'module' });
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return events and stateChanges', async () => {
      const mod = createV2Module();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(Array.isArray(result.events)).toBe(true);
      expect(Array.isArray(result.stateChanges)).toBe(true);
    });
  });

  describe('executeAgent', () => {
    it('should execute an agent module', async () => {
      const mod = createAgentModule();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should fail agent without role', async () => {
      const mod = createAgentModule({ role: undefined, goal: 'help' });
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('role and goal');
    });

    it('should fail agent without goal', async () => {
      const mod = createAgentModule({ role: 'assistant', goal: undefined });
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('role and goal');
    });

    it('should emit agent events', async () => {
      const mod = createAgentModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.events.emit).toHaveBeenCalled();
    });

    it('should set agent state', async () => {
      const mod = createAgentModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.state.set).toHaveBeenCalled();
    });
  });

  describe('executeTool', () => {
    it('should execute a tool module', async () => {
      const mod = createToolModule();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should fail tool without provider', async () => {
      const mod = createToolModule({ provider: undefined });
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('provider');
    });

    it('should emit tool events', async () => {
      const mod = createToolModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.events.emit).toHaveBeenCalled();
    });
  });

  describe('executeMemory', () => {
    it('should execute a memory module', async () => {
      const mod = createMemoryModule();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should emit memory events', async () => {
      const mod = createMemoryModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.events.emit).toHaveBeenCalled();
    });
  });

  describe('executeWorkflow', () => {
    it('should execute a workflow module', async () => {
      const mod = createWorkflowModule();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should track steps and edges', async () => {
      const mod = createWorkflowModule();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      const output = result.output as Record<string, unknown>;
      expect(output.steps).toBe(2);
      expect(output.edges).toBe(1);
    });

    it('should emit workflow events', async () => {
      const mod = createWorkflowModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.events.emit).toHaveBeenCalled();
    });
  });

  describe('executePolicy', () => {
    it('should execute a policy module', async () => {
      const mod = createPolicyModule();
      const ctx = createTestContext(mod);
      const result = await runtime.execute(mod, ctx as any);
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should set policy state', async () => {
      const mod = createPolicyModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.state.set).toHaveBeenCalled();
    });

    it('should emit policy events', async () => {
      const mod = createPolicyModule();
      const ctx = createTestContext(mod);
      await runtime.execute(mod, ctx as any);
      expect(ctx.events.emit).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should cleanup without error', async () => {
      await runtime.cleanup();
      expect(runtime).toBeDefined();
    });

    it('should be safe to cleanup multiple times', async () => {
      await runtime.cleanup();
      await runtime.cleanup();
    });

    it('should reset initialized state', async () => {
      await runtime.cleanup();
      const mod = createV2Module();
      const ctx = createTestContext(mod);
      await expect(runtime.execute(mod, ctx as any)).rejects.toThrow('not initialized');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: createV2Runtime factory
// ---------------------------------------------------------------------------

describe('createV2Runtime', () => {
  it('should create and initialize runtime', () => {
    const runtime = createV2Runtime();
    expect(runtime).toBeInstanceOf(MAMV2Runtime);
    expect(runtime.name).toBe('mam-v2');
  });

  it('should create with custom config', () => {
    const runtime = createV2Runtime({
      defaultTimeout: 5000,
      logging: false,
    });
    expect(runtime).toBeDefined();
  });

  it('should be ready to execute', async () => {
    const runtime = createV2Runtime();
    const mod = createV2Module();
    const ctx = createTestContext(mod);
    const result = await runtime.execute(mod, ctx as any);
    expect(result.success).toBe(true);
    await runtime.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 Memory Store (tested via runtime)
// ---------------------------------------------------------------------------

describe('V2 Memory Store (via runtime)', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should handle memory module execution', async () => {
    const mod = createMemoryModule();
    const ctx = createTestContext(mod);
    const result = await runtime.execute(mod, ctx as any);
    expect(result.success).toBe(true);
  });

  it('should handle memory module with different configs', async () => {
    const mod = createMemoryModule({
      format: 'vector',
      backend: 'sqlite',
      scope: 'local',
      ttl: '3600',
    });
    const ctx = createTestContext(mod);
    const result = await runtime.execute(mod, ctx as any);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 Event Emitter (tested via runtime)
// ---------------------------------------------------------------------------

describe('V2 Event Emitter (via runtime)', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should emit events during execution', async () => {
    const mod = createAgentModule();
    const ctx = createTestContext(mod);
    await runtime.execute(mod, ctx as any);
    expect(ctx.events.emit).toHaveBeenCalled();
  });

  it('should emit multiple events for workflow', async () => {
    const mod = createWorkflowModule();
    const ctx = createTestContext(mod);
    await runtime.execute(mod, ctx as any);
    expect(ctx.events.emit).toHaveBeenCalledTimes(4); // start + 2 steps + complete
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 State Manager (tested via runtime)
// ---------------------------------------------------------------------------

describe('V2 State Manager (via runtime)', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should set state during agent execution', async () => {
    const mod = createAgentModule();
    const ctx = createTestContext(mod);
    await runtime.execute(mod, ctx as any);
    expect(ctx.state.set).toHaveBeenCalled();
  });

  it('should set state during policy execution', async () => {
    const mod = createPolicyModule();
    const ctx = createTestContext(mod);
    await runtime.execute(mod, ctx as any);
    expect(ctx.state.set).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 Permission Checker (tested via runtime)
// ---------------------------------------------------------------------------

describe('V2 Permission Checker (via runtime)', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should execute with permissions context', async () => {
    const mod = createV2Module();
    const ctx = createTestContext(mod);
    const result = await runtime.execute(mod, ctx as any);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 executeSystem
// ---------------------------------------------------------------------------

describe('MAMV2Runtime.executeSystem', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should execute system with multiple modules', async () => {
    const m1 = createV2Module({ name: 'mod-1', moduleType: 'module' });
    const m2 = createV2Module({ name: 'mod-2', moduleType: 'module' });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([
      [m1.name, m1],
      [m2.name, m2],
    ]);
    const result = await runtime.executeSystem([m1, m2], system, ctx as any);
    expect(result.success).toBe(true);
    expect(result.moduleResults).toBeInstanceOf(Map);
    expect(result.executionOrder).toContain('mod-1');
    expect(result.executionOrder).toContain('mod-2');
  });

  it('should handle dependency ordering', async () => {
    const m1 = createV2Module({
      name: 'dep',
      moduleType: 'module',
      requires: [],
    });
    const m2 = createV2Module({
      name: 'app',
      moduleType: 'module',
      requires: ['dep'],
    });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([
      [m1.name, m1],
      [m2.name, m2],
    ]);
    const result = await runtime.executeSystem([m1, m2], system, ctx as any);
    expect(result.executionOrder.indexOf('dep')).toBeLessThan(
      result.executionOrder.indexOf('app')
    );
  });

  it('should track failed modules', async () => {
    const good = createAgentModule({ name: 'good-agent', role: 'r', goal: 'g' });
    const bad = createAgentModule({ name: 'bad-agent', role: undefined, goal: undefined });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([
      [good.name, good],
      [bad.name, bad],
    ]);
    const result = await runtime.executeSystem([good, bad], system, ctx as any);
    expect(result.failedModules).toContain('bad-agent');
  });

  it('should throw if not initialized', async () => {
    const r = new MAMV2Runtime();
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    await expect(r.executeSystem([], system, ctx as any)).rejects.toThrow('not initialized');
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 Runtime topological sort
// ---------------------------------------------------------------------------

describe('V2 Runtime topological sort', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should handle modules with no dependencies', async () => {
    const m1 = createV2Module({ name: 'a', moduleType: 'module' });
    const m2 = createV2Module({ name: 'b', moduleType: 'module' });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([
      [m1.name, m1],
      [m2.name, m2],
    ]);
    const result = await runtime.executeSystem([m1, m2], system, ctx as any);
    expect(result.executionOrder).toHaveLength(2);
  });

  it('should handle linear chain', async () => {
    const m1 = createV2Module({ name: 'a', moduleType: 'module', requires: [] });
    const m2 = createV2Module({ name: 'b', moduleType: 'module', requires: ['a'] });
    const m3 = createV2Module({ name: 'c', moduleType: 'module', requires: ['b'] });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([
      [m1.name, m1],
      [m2.name, m2],
      [m3.name, m3],
    ]);
    const result = await runtime.executeSystem([m1, m2, m3], system, ctx as any);
    const order = result.executionOrder;
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('should handle diamond dependencies', async () => {
    const base = createV2Module({ name: 'base', moduleType: 'module', requires: [] });
    const left = createV2Module({ name: 'left', moduleType: 'module', requires: ['base'] });
    const right = createV2Module({ name: 'right', moduleType: 'module', requires: ['base'] });
    const top = createV2Module({ name: 'top', moduleType: 'module', requires: ['left', 'right'] });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([
      [base.name, base],
      [left.name, left],
      [right.name, right],
      [top.name, top],
    ]);
    const result = await runtime.executeSystem([base, left, right, top], system, ctx as any);
    const order = result.executionOrder;
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('left'));
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('right'));
    expect(order.indexOf('left')).toBeLessThan(order.indexOf('top'));
    expect(order.indexOf('right')).toBeLessThan(order.indexOf('top'));
  });

  it('should handle missing modules in system', async () => {
    const m1 = createV2Module({ name: 'exists', moduleType: 'module' });
    const system = createV2Module({ name: 'system', moduleType: 'system' });
    const ctx = createTestContext(system);
    ctx.allModules = new Map([[m1.name, m1]]);
    // The topoSort only processes modules in the input array.
    // Missing modules that are dependencies won't appear in executionOrder
    // but the modules that depend on them will still execute (with missing deps).
    const result = await runtime.executeSystem(
      [m1, createV2Module({ name: 'missing', moduleType: 'module' })],
      system,
      ctx as any
    );
    // Both modules are in the input array, so both appear in executionOrder
    expect(result.executionOrder).toContain('exists');
    expect(result.executionOrder).toContain('missing');
  });
});

// ---------------------------------------------------------------------------
// Tests: V2 Runtime error handling
// ---------------------------------------------------------------------------

describe('V2 Runtime error handling', () => {
  let runtime: MAMV2Runtime;

  beforeEach(async () => {
    runtime = createV2Runtime();
  });

  afterEach(async () => {
    await runtime.cleanup();
  });

  it('should handle module execution error gracefully', async () => {
    const mod = createV2Module({ name: 'failing', moduleType: 'module' });
    const ctx = createTestContext(mod);
    // Override events.emit to throw
    ctx.events.emit = vi.fn().mockImplementation(() => {
      throw new Error('emit failed');
    });
    const result = await runtime.execute(mod, ctx as any);
    // Should handle error gracefully
    expect(result).toBeDefined();
  });

  it('should return error result for failed modules', async () => {
    const mod = createAgentModule({ role: undefined, goal: undefined });
    const ctx = createTestContext(mod);
    const result = await runtime.execute(mod, ctx as any);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
