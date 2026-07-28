/**
 * MAM Dependencies Section Node
 */

export interface Dependency {
  name: string;
  version?: string;
  source?: string;
}

export interface DependenciesNode {
  type: 'Dependencies';
  dependencies: Dependency[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
