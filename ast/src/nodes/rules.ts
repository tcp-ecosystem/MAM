/**
 * MAM Rules Section Node
 */

export interface Rule {
  text: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface RulesNode {
  type: 'Rules';
  rules: Rule[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
