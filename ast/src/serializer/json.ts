/**
 * MAM AST JSON Serializer
 */

export interface SerializeOptions {
  indent?: number;
  includeLocation?: boolean;
}

export function serializeToJSON(ast: unknown, options: SerializeOptions = {}): string {
  const indent = options.indent ?? 2;
  return JSON.stringify(ast, null, indent);
}

export function deserializeFromJSON(json: string): unknown {
  return JSON.parse(json);
}
