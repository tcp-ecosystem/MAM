/**
 * MAM Inputs Section Node
 */

export interface InputPort {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
}

export interface InputsNode {
  type: 'Inputs';
  ports: InputPort[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
