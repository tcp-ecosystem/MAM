/**
 * MAM Imports Section Node
 */

export interface ImportItem {
  name: string;
  source: string;
  alias?: string;
}

export interface ImportsNode {
  type: 'Imports';
  items: ImportItem[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
