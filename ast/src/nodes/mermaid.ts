/**
 * MAM Mermaid Diagram Node
 */

export interface MermaidNode {
  type: 'Mermaid';
  diagramType: string;
  content: string;
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
