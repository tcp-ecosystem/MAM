/**
 * YAML Plugin - Parser & Type Coercion
 */

export interface YAMLParseResult {
  data: Record<string, unknown>;
  errors: string[];
}

export function parseYAMLValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function validateYAMLContent(value: string): { valid: boolean; error?: string; line?: number } {
  try {
    const lines = value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length === 0 || line.startsWith('#')) continue;
      if (line.startsWith('- ')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(key)) {
          return { valid: false, error: `Invalid YAML key "${key}" at line ${i + 1}`, line: i + 1 };
        }
      }
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

export function parseYAML(text: string): YAMLParseResult {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};

  const lines = text.split('\n');
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const colonIdx = trimmed.indexOf(':');

    if (colonIdx > 0 && indent === 0) {
      if (currentKey) {
        data[currentKey] = parseYAMLValue(currentValue.join('\n'));
      }
      currentKey = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      currentValue = val ? [val] : [];
    } else if (currentKey) {
      currentValue.push(trimmed);
    }
  }

  if (currentKey) {
    data[currentKey] = parseYAMLValue(currentValue.join('\n'));
  }

  const validation = validateYAMLContent(text);
  if (!validation.valid && validation.error) {
    errors.push(validation.error);
  }

  return { data, errors };
}

export function stringifyYAML(data: Record<string, unknown>, indent = 2): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      lines.push(`${key}: null`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string') {
      if (value.includes(':') || value.includes('#') || value.includes('\n')) {
        lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`${' '.repeat(indent)}- ${item}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`${' '.repeat(indent)}${k}: ${v}`);
      }
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines.join('\n');
}
