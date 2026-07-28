/**
 * MAM Memory Section Node
 */

export interface MemoryNode {
  type: 'Memory';
  format?: string;
  backend?: string;
  scope?: string;
  ttl?: string;
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
