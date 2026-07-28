/**
 * MAM Purpose Section Node
 */

export interface PurposeNode {
  type: 'Purpose';
  content: string;
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
