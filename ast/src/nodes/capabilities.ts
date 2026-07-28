/**
 * MAM Capabilities Section Node
 */

export interface Capability {
  name: string;
  description?: string;
  inputs?: string[];
  outputs?: string[];
}

export interface CapabilitiesNode {
  type: 'Capabilities';
  capabilities: Capability[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
