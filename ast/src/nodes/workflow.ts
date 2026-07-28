/**
 * MAM Workflow Section Node
 */

export interface WorkflowStep {
  name: string;
  description?: string;
  agent?: string;
}

export interface WorkflowNode {
  type: 'Workflow';
  steps: WorkflowStep[];
  edges?: Array<{ from: string; to: string }>;
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
