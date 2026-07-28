/**
 * MAM Permissions Section Node
 */

export interface Permission {
  resource: string;
  level: string;
}

export interface PermissionsNode {
  type: 'Permissions';
  permissions: Permission[];
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
}
