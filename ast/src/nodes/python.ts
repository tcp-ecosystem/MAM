/**
 * MAM Python Code Block Node
 */

export interface PythonNode {
  type: 'Python';
  code: string;
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
