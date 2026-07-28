/**
 * MAM Examples Section Node
 */

export interface ExampleEntry {
  title?: string;
  content: string;
}

export interface ExamplesNode {
  type: 'Examples';
  examples: ExampleEntry[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
