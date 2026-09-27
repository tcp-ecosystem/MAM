import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PluginManager,
  createPlugin,
  isCLIPlugin,
  validatePlugin,
  getPluginCommandNames,
  findPluginCommand,
  hasPluginHook,
  getLoadedPluginNames,
  countPluginCommands,
} from '../src/plugin.js';
import { PluginError } from '../src/errors.js';
import type { CLIPlugin, PluginContext, PluginHooks } from '../src/plugin.js';
import type { MAMConfig } from '../src/types.js';
import type { Logger } from '../src/logger.js';

function makePlugin(name: string, overrides?: Partial<CLIPlugin>): CLIPlugin {
  return createPlugin({
    name,
    version: '1.0.0',
    ...overrides,
  });
}

function makeCtx(): PluginContext {
  return {
    config: { version: '1' } as MAMConfig,
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger,
    cwd: '/tmp',
  };
}

describe('PluginManager', () => {
  let pm: PluginManager;

  beforeEach(() => {
    pm = new PluginManager();
  });

  it('should start empty', () => {
    expect(pm.size).toBe(0);
    expect(pm.getPlugins()).toEqual([]);
  });

  it('should load a plugin', () => {
    pm.loadPlugin(makePlugin('a'));
    expect(pm.size).toBe(1);
    expect(pm.getPlugins()).toHaveLength(1);
    expect(pm.getPlugins()[0].name).toBe('a');
  });

  it('should load multiple plugins', () => {
    pm.loadPlugin(makePlugin('a'));
    pm.loadPlugin(makePlugin('b'));
    pm.loadPlugin(makePlugin('c'));
    expect(pm.size).toBe(3);
    expect(pm.getPlugins().map((p) => p.name)).toEqual(['a', 'b', 'c']);
  });

  it('should throw on duplicate plugin name', () => {
    pm.loadPlugin(makePlugin('a'));
    expect(() => pm.loadPlugin(makePlugin('a'))).toThrow(PluginError);
    expect(() => pm.loadPlugin(makePlugin('a'))).toThrow('already loaded');
  });

  it('should unload a plugin', () => {
    pm.loadPlugin(makePlugin('a'));
    const removed = pm.unloadPlugin('a');
    expect(removed).toBe(true);
    expect(pm.size).toBe(0);
  });

  it('should return false when unloading non-existent plugin', () => {
    expect(pm.unloadPlugin('nope')).toBe(false);
  });

  it('should unload correct plugin and keep others', () => {
    pm.loadPlugin(makePlugin('a'));
    pm.loadPlugin(makePlugin('b'));
    pm.unloadPlugin('a');
    expect(pm.size).toBe(1);
    expect(pm.getPlugins()[0].name).toBe('b');
  });
});

describe('PluginManager getCommands', () => {
  it('should return empty array when no plugins have commands', () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a'));
    expect(pm.getCommands()).toEqual([]);
  });

  it('should collect commands from all plugins', () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a', {
      commands: [{ name: 'lint', description: 'Lint MAM files', handler: vi.fn() }],
    }));
    pm.loadPlugin(makePlugin('b', {
      commands: [
        { name: 'format', description: 'Format MAM files', handler: vi.fn() },
        { name: 'lint', description: 'Override lint', handler: vi.fn() },
      ],
    }));
    const commands = pm.getCommands();
    expect(commands).toHaveLength(3);
    expect(commands.map((c) => c.name)).toEqual(['lint', 'format', 'lint']);
  });
});

describe('PluginManager findCommand', () => {
  it('should find a command across plugins', () => {
    const pm = new PluginManager();
    const handler = vi.fn();
    pm.loadPlugin(makePlugin('a', {
      commands: [{ name: 'lint', description: 'Lint', handler }],
    }));
    const result = pm.findCommand('lint');
    expect(result).toBeDefined();
    expect(result!.plugin.name).toBe('a');
    expect(result!.command.name).toBe('lint');
  });

  it('should return undefined for non-existent command', () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a'));
    expect(pm.findCommand('nope')).toBeUndefined();
  });

  it('should find first matching command when duplicates exist', () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a', {
      commands: [{ name: 'lint', description: 'Lint A', handler: vi.fn() }],
    }));
    pm.loadPlugin(makePlugin('b', {
      commands: [{ name: 'lint', description: 'Lint B', handler: vi.fn() }],
    }));
    const result = pm.findCommand('lint');
    expect(result!.plugin.name).toBe('a');
  });
});

describe('PluginManager executeHook', () => {
  it('should call hook on plugins that have it', async () => {
    const pm = new PluginManager();
    const beforeBuild = vi.fn();
    pm.loadPlugin(makePlugin('a', { hooks: { beforeBuild } }));
    pm.loadPlugin(makePlugin('b'));
    pm.loadPlugin(makePlugin('c', { hooks: { beforeBuild: vi.fn() } }));

    await pm.executeHook('beforeBuild', makeCtx());
    expect(beforeBuild).toHaveBeenCalledTimes(1);
  });

  it('should pass context to hook', async () => {
    const pm = new PluginManager();
    const hook = vi.fn();
    pm.loadPlugin(makePlugin('a', { hooks: { beforeBuild: hook } }));
    const ctx = makeCtx();
    await pm.executeHook('beforeBuild', ctx);
    expect(hook).toHaveBeenCalledWith(ctx);
  });

  it('should pass additional args to hook', async () => {
    const pm = new PluginManager();
    const hook = vi.fn();
    pm.loadPlugin(makePlugin('a', { hooks: { afterBuild: hook } }));
    const ctx = makeCtx();
    const extra = { success: true };
    await pm.executeHook('afterBuild', ctx, extra);
    expect(hook).toHaveBeenCalledWith(ctx, extra);
  });

  it('should throw PluginError when hook throws', async () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a', {
      hooks: {
        beforeBuild: async () => { throw new Error('hook boom'); },
      },
    }));
    await expect(pm.executeHook('beforeBuild', makeCtx()))
      .rejects.toThrow(PluginError);
  });

  it('should throw PluginError with plugin name in message', async () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('my-plugin', {
      hooks: {
        onInit: async () => { throw new Error('oops'); },
      },
    }));
    try {
      await pm.executeHook('onInit', makeCtx());
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PluginError);
      expect((e as PluginError).message).toContain('my-plugin');
      expect((e as PluginError).message).toContain('onInit');
    }
  });

  it('should execute hooks in registration order', async () => {
    const order: string[] = [];
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a', {
      hooks: { onInit: async () => { order.push('a'); } },
    }));
    pm.loadPlugin(makePlugin('b', {
      hooks: { onInit: async () => { order.push('b'); } },
    }));
    await pm.executeHook('onInit', makeCtx());
    expect(order).toEqual(['a', 'b']);
  });

  it('should not throw when no plugins have the hook', async () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a'));
    await expect(pm.executeHook('beforeBuild', makeCtx())).resolves.toBeUndefined();
  });
});

describe('PluginManager size', () => {
  it('should reflect loadPlugin', () => {
    const pm = new PluginManager();
    expect(pm.size).toBe(0);
    pm.loadPlugin(makePlugin('a'));
    expect(pm.size).toBe(1);
    pm.loadPlugin(makePlugin('b'));
    expect(pm.size).toBe(2);
  });

  it('should reflect unloadPlugin', () => {
    const pm = new PluginManager();
    pm.loadPlugin(makePlugin('a'));
    pm.unloadPlugin('a');
    expect(pm.size).toBe(0);
  });
});

describe('createPlugin', () => {
  it('should create plugin with required fields', () => {
    const plugin = createPlugin({ name: 'test', version: '1.0.0' });
    expect(plugin.name).toBe('test');
    expect(plugin.version).toBe('1.0.0');
  });

  it('should default commands and hooks to empty', () => {
    const plugin = createPlugin({ name: 'test', version: '1.0.0' });
    expect(plugin.commands).toEqual([]);
    expect(plugin.hooks).toEqual({});
  });

  it('should override defaults', () => {
    const hook = vi.fn();
    const plugin = createPlugin({
      name: 'test',
      version: '2.0.0',
      description: 'my plugin',
      commands: [{ name: 'run', description: 'run', handler: vi.fn() }],
      hooks: { beforeBuild: hook },
    });
    expect(plugin.description).toBe('my plugin');
    expect(plugin.commands).toHaveLength(1);
    expect(plugin.hooks?.beforeBuild).toBe(hook);
  });
});

describe('isCLIPlugin', () => {
  it('should validate plugin shapes', () => {
    expect(isCLIPlugin(createPlugin({ name: 'a', version: '1.0.0' }))).toBe(true);
    expect(isCLIPlugin({ name: 'a' })).toBe(false);
    expect(isCLIPlugin(null)).toBe(false);
    expect(isCLIPlugin('plugin')).toBe(false);
  });
});

describe('validatePlugin', () => {
  it('should accept valid plugins', () => {
    expect(validatePlugin(createPlugin({ name: 'a', version: '1.0.0' }))).toEqual([]);
  });

  it('should report name, version, and duplicate commands', () => {
    const errors = validatePlugin({
      name: '',
      version: 'bad',
      commands: [
        { name: 'dup', description: 'x', handler: async () => {} },
        { name: 'dup', description: 'y', handler: async () => {} },
      ],
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('getPluginCommandNames / findPluginCommand', () => {
  const plugin = createPlugin({
    name: 'p',
    version: '1.0.0',
    commands: [{ name: 'lint', description: 'lint it', handler: async () => {} }],
  });

  it('should list and find commands', () => {
    expect(getPluginCommandNames(plugin)).toEqual(['lint']);
    expect(findPluginCommand(plugin, 'lint')?.description).toBe('lint it');
    expect(findPluginCommand(plugin, 'missing')).toBeUndefined();
    expect(getPluginCommandNames(createPlugin({ name: 'q', version: '1.0.0' }))).toEqual([]);
  });
});

describe('hasPluginHook', () => {
  it('should detect hooks', () => {
    const plugin = createPlugin({
      name: 'p',
      version: '1.0.0',
      hooks: { onInit: async () => {} },
    });
    expect(hasPluginHook(plugin, 'onInit')).toBe(true);
    expect(hasPluginHook(plugin, 'onExit')).toBe(false);
  });
});

describe('getLoadedPluginNames / countPluginCommands', () => {
  it('should inspect the manager', () => {
    const manager = new PluginManager();
    manager.loadPlugin(
      createPlugin({
        name: 'a',
        version: '1.0.0',
        commands: [{ name: 'one', description: '1', handler: async () => {} }],
      }),
    );
    manager.loadPlugin(createPlugin({ name: 'b', version: '1.0.0' }));
    expect(getLoadedPluginNames(manager)).toEqual(['a', 'b']);
    expect(countPluginCommands(manager)).toBe(1);
  });
});
