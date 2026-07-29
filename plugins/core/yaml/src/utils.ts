/**
 * YAML Plugin - Utility Functions
 */

import { stringifyYAML } from './parser.js';

export function flattenYAML(data: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenYAML(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

export function unflattenYAML(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const parts = key.split('.');
    let current: any = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i]! in current)) {
        current[parts[i]!] = {};
      }
      current = current[parts[i]!];
    }
    current[parts[parts.length - 1]!] = value;
  }
  return result;
}

export function mergeYAMLObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])
    ) {
      result[key] = mergeYAMLObjects(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function YAMLToJSON(yamlText: string): string {
  // Use dynamic import pattern for ESM compatibility
  const lines = yamlText.split('\n');
  const data: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      data[key] = val;
    }
  }
  return JSON.stringify(data, null, 2);
}

export function jsonToYAML(jsonText: string): string {
  const data = JSON.parse(jsonText);
  return stringifyYAML(data);
}

export function diffYAMLObjects(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): { added: string[]; removed: string[]; changed: string[] } {
  const flatA = flattenYAML(a);
  const flatB = flattenYAML(b);
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of Object.keys(flatB)) {
    if (!(key in flatA)) added.push(key);
    else if (flatA[key] !== flatB[key]) changed.push(key);
  }

  for (const key of Object.keys(flatA)) {
    if (!(key in flatB)) removed.push(key);
  }

  return { added, removed, changed };
}
