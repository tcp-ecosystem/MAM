/**
 * MAM Prompt Section Node
 */

export interface PromptNode {
  type: 'Prompt';
  content: string;
  variables?: string[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
