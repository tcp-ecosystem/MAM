/**
 * MAM Exports Section Node
 */

export interface ExportItem {
  name: string;
  type?: string;
  description?: string;
}

export interface ExportsNode {
  type: 'Exports';
  items: ExportItem[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
