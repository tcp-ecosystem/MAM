/**
 * MAM Plugin Loader
 *
 * Loads, initializes, and manages MAM plugins.
 */

export interface Plugin {
  name: string;
  version: string;
  initialize: (context: unknown) => void | Promise<void>;
  destroy?: () => void | Promise<void>;
}

export class PluginLoader {
  private plugins: Map<string, Plugin> = new Map();

  async load(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already loaded`);
    }
    await plugin.initialize({});
    this.plugins.set(plugin.name, plugin);
  }

  async unload(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      await plugin.destroy?.();
      this.plugins.delete(name);
    }
  }

  async reload(plugin: Plugin): Promise<void> {
    await this.unload(plugin.name);
    await this.load(plugin);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  async unloadAll(): Promise<void> {
    const names = Array.from(this.plugins.keys());
    for (const name of names) {
      await this.unload(name);
    }
  }
}
