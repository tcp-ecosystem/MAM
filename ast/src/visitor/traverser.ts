/**
 * MAM AST Traverser
 * 
 * Generic tree traversal utilities for MAM AST nodes.
 */

export type NodeType = 'ModuleNode' | 'AgentNode' | 'ToolNode' | 'MemoryNode' | 'WorkflowNode' | 'TeamNode' | 'PolicyNode' | 'SystemNode' | 'EdgeNode' | 'StepNode';

export interface traversable {
  type: string;
  [key: string]: unknown;
}

export type VisitorCallback = (node: traversable, parent: traversable | null, path: string[]) => void;

export function traverse(node: traversable, callback: VisitorCallback, parent: traversable | null = null, path: string[] = []): void {
  callback(node, parent, path);

  for (const key of Object.keys(node)) {
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'type' in item) {
          traverse(item as traversable, callback, node, [...path, key]);
        }
      }
    } else if (value && typeof value === 'object' && 'type' in value) {
      traverse(value as traversable, callback, node, [...path, key]);
    }
  }
}

export function findNodes(node: traversable, predicate: (n: traversable) => boolean): traversable[] {
  const results: traversable[] = [];
  traverse(node, (n) => {
    if (predicate(n)) results.push(n);
  });
  return results;
}

export function findNodeByType(node: traversable, type: string): traversable | undefined {
  return findNodes(node, n => n.type === type)[0];
}

export function countNodes(node: traversable): number {
  let count = 0;
  traverse(node, () => { count++; });
  return count;
}

export function collectText(node: traversable): string {
  const parts: string[] = [];
  traverse(node, (n) => {
    if ('value' in n && typeof n.value === 'string') {
      parts.push(n.value);
    }
  });
  return parts.join(' ');
}

export function findNodesByType(node: traversable, type: string): traversable[] {
  return findNodes(node, (n) => n.type === type);
}

export function getNodeTypes(node: traversable): string[] {
  const types = new Set<string>();
  traverse(node, (n) => {
    types.add(n.type);
  });
  return Array.from(types);
}

export function getMaxDepth(node: traversable): number {
  let max = 0;
  traverse(node, (_n, _parent, path) => {
    if (path.length > max) max = path.length;
  });
  return max;
}

export function collectPaths(node: traversable): string[][] {
  const paths: string[][] = [];
  traverse(node, (_n, _parent, path) => {
    paths.push([...path]);
  });
  return paths;
}

export function someNode(node: traversable, predicate: (n: traversable) => boolean): boolean {
  let match = false;
  traverse(node, (n) => {
    if (!match && predicate(n)) {
      match = true;
    }
  });
  return match;
}

export function everyNodeShallow(node: traversable, predicate: (n: traversable) => boolean): boolean {
  if (!predicate(node)) return false;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          item &&
          typeof item === 'object' &&
          'type' in item &&
          !predicate(item as traversable)
        ) {
          return false;
        }
      }
    } else if (value && typeof value === 'object' && 'type' in value && !predicate(value as traversable)) {
      return false;
    }
  }
  return true;
}

export function collectValuesByKey(node: traversable, key: string): unknown[] {
  const values: unknown[] = [];
  traverse(node, (n) => {
    if (key in n) {
      values.push(n[key]);
    }
  });
  return values;
}
