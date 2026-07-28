/**
 * MAM AST YAML Serializer
 * 
 * Basic YAML serializer for MAM AST.
 */

export function serializeToYAML(ast: unknown): string {
  // Simple YAML serialization for flat structures
  if (typeof ast !== 'object' || ast === null) return String(ast);
  
  const lines: string[] = [];
  const entries = Object.entries(ast as Record<string, unknown>);
  
  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      lines.push(`${key}: null`);
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${key}:`);
      const nested = Object.entries(value as Record<string, unknown>);
      for (const [k, v] of nested) {
        lines.push(`  ${k}: ${v}`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  
  return lines.join('\n');
}
