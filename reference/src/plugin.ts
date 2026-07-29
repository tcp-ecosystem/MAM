/**
 * MAM Reference Implementation — Plugin System
 *
 * Lightweight plugin API allowing third-party extensions to register CLI
 * commands and lifecycle hooks.
 */

import type { MAMConfig, BuildResult, ValidationDetail } from './types.js';
import type { Logger } from './logger.js';
import { PluginError } from './errors.js';

// ============================================================================
// Plugin Types
// ============================================================================

export interface CLIPlugin {
  /** Unique plugin name. */
  name: string;
  /** Semver version string. */
  version: string;
  /** Human-readable description. */
  description?: string;
  /** Commands this plugin contributes. */
  commands?: PluginCommand[];
  /** Lifecycle hooks. */
  hooks?: PluginHooks;
}

export interface PluginCommand {
  /** Sub-command name (e.g. "lint" → `mamc lint`). */
  name: string;
  /** One-line description shown in `mamc --help`. */
  description: string;
  /** Extra CLI options for this command. */
  options?: CommandOption[];
  /** Command handler. */
  handler: (args: PluginCommandArgs, context: PluginContext) => Promise<void>;
}

export interface CommandOption {
  /** Long flag name (without leading dashes). */
  name: string;
  /** Short flag (single character). */
  short?: string;
  /** Description shown in help. */
  description: string;
  /** Whether the option is required. */
  required?: boolean;
  /** Default value. */
  default?: unknown;
}

export interface PluginCommandArgs {
  /** Positional arguments. */
  _: string[];
  /** Parsed option values. */
  [key: string]: unknown;
}

export interface PluginHooks {
  /** Called before the build pipeline starts. */
  beforeBuild?: (ctx: PluginContext) => Promise<void>;
  /** Called after the build pipeline completes. */
  afterBuild?: (ctx: PluginContext, result: BuildResult) => Promise<void>;
  /** Called before validation. */
  beforeValidate?: (ctx: PluginContext) => Promise<void>;
  /** Called after validation. */
  afterValidate?: (
    ctx: PluginContext,
    result: ValidationDetail[],
  ) => Promise<void>;
  /** Called on CLI startup. */
  onInit?: (ctx: PluginContext) => Promise<void>;
  /** Called when the CLI exits. */
  onExit?: (ctx: PluginContext) => Promise<void>;
}

export interface PluginContext {
  /** Effective MAM configuration. */
  config: MAMConfig;
  /** Logger instance scoped to the current command. */
  logger: Logger;
  /** Current working directory. */
  cwd: string;
}

// ============================================================================
// Plugin Manager
// ============================================================================

export class PluginManager {
  private _plugins: Map<string, CLIPlugin> = new Map();
  private _hookOrder: string[] = [];

  /**
   * Register a plugin.
   *
   * @throws {PluginError} if a plugin with the same name is already loaded.
   */
  loadPlugin(plugin: CLIPlugin): void {
    if (this._plugins.has(plugin.name)) {
      throw new PluginError(
        `Plugin "${plugin.name}" is already loaded.`,
      );
    }
    this._plugins.set(plugin.name, plugin);
    this._hookOrder.push(plugin.name);
  }

  /**
   * Unregister a plugin by name.
   *
   * @returns `true` if the plugin was removed, `false` if it wasn't found.
   */
  unloadPlugin(name: string): boolean {
    const removed = this._plugins.delete(name);
    this._hookOrder = this._hookOrder.filter((n) => n !== name);
    return removed;
  }

  /**
   * Return all loaded plugins.
   */
  getPlugins(): CLIPlugin[] {
    return this._hookOrder
      .map((name) => this._plugins.get(name))
      .filter((p): p is CLIPlugin => p !== undefined);
  }

  /**
   * Return all commands contributed by loaded plugins.
   */
  getCommands(): PluginCommand[] {
    const commands: PluginCommand[] = [];
    for (const plugin of this.getPlugins()) {
      if (plugin.commands) {
        commands.push(...plugin.commands);
      }
    }
    return commands;
  }

  /**
   * Find a specific command across all plugins.
   */
  findCommand(commandName: string): { plugin: CLIPlugin; command: PluginCommand } | undefined {
    for (const plugin of this.getPlugins()) {
      const cmd = plugin.commands?.find((c) => c.name === commandName);
      if (cmd) return { plugin, command: cmd };
    }
    return undefined;
  }

  /**
   * Execute a lifecycle hook on all loaded plugins (in registration order).
   *
   * @param hookName  Name of the hook method on PluginHooks.
   * @param ctx       Shared plugin context.
   * @param args      Additional arguments forwarded to the hook.
   */
  async executeHook(
    hookName: keyof PluginHooks,
    ctx: PluginContext,
    ...args: unknown[]
  ): Promise<void> {
    for (const plugin of this.getPlugins()) {
      const hook = plugin.hooks?.[hookName];
      if (typeof hook === 'function') {
        try {
          await (hook as (...a: unknown[]) => Promise<void>)(ctx, ...args);
        } catch (err) {
          throw new PluginError(
            `Plugin "${plugin.name}" hook "${hookName}" failed: ${(err as Error).message}`,
            { cause: err as Error, context: { plugin: plugin.name, hook: hookName } },
          );
        }
      }
    }
  }

  /**
   * Number of loaded plugins.
   */
  get size(): number {
    return this._plugins.size;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal plugin from a partial definition.
 */
export function createPlugin(def: Partial<CLIPlugin> & Pick<CLIPlugin, 'name' | 'version'>): CLIPlugin {
  return {
    commands: [],
    hooks: {},
    ...def,
  };
}
