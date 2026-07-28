/**
 * MAM Plugins Section Node
 */

export interface PluginRef {
  name: string;
  version?: string;
  config?: Record<string, unknown>;
}

export interface PluginsNode {
  type: 'Plugins';
  plugins: PluginRef[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
