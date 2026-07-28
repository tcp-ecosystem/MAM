/**
 * MAM Plugin Registry
 *
 * Manages plugin metadata, discovery, and lifecycle.
 */

export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
}

export class PluginRegistry {
  private metadata: Map<string, PluginMetadata> = new Map();

  register(meta: PluginMetadata): void {
    if (this.metadata.has(meta.name)) {
      throw new Error(`Plugin "${meta.name}" is already registered`);
    }
    this.metadata.set(meta.name, meta);
  }

  unregister(name: string): void {
    this.metadata.delete(name);
  }

  get(name: string): PluginMetadata | undefined {
    return this.metadata.get(name);
  }

  list(): PluginMetadata[] {
    return Array.from(this.metadata.values());
  }

  has(name: string): boolean {
    return this.metadata.has(name);
  }

  find(predicate: (meta: PluginMetadata) => boolean): PluginMetadata | undefined {
    return this.list().find(predicate);
  }
}
