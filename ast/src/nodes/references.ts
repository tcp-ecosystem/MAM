/**
 * MAM References Section Node
 */

export interface Reference {
  title: string;
  url?: string;
  description?: string;
}

export interface ReferencesNode {
  type: 'References';
  references: Reference[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
