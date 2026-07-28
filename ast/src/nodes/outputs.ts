/**
 * MAM Outputs Section Node
 */

export interface OutputPort {
  name: string;
  type: string;
  description?: string;
}

export interface OutputsNode {
  type: 'Outputs';
  ports: OutputPort[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
