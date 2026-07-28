/**
 * MAM Tests Section Node
 */

export interface TestCase {
  name: string;
  input?: string;
  expected?: string;
  description?: string;
}

export interface TestsNode {
  type: 'Tests';
  cases: TestCase[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
