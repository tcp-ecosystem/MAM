/**
 * Memory Plugin - Content Parser
 * Parses memory content from parsed MAM sections.
 */

import type { ContentNode } from '@mam/ast';

export interface MemoryEntry {
  key: string;
  value: unknown;
  source: 'paragraph' | 'codeblock';
}

export interface ParsedMemory {
  entries: MemoryEntry[];
  flat: Record<string, unknown>;
  keys: string[];
}

const BULLET_PATTERN = /^\*\*(.+?)\*\*:\s*(.+)$/;
const SIMPLE_BULLET = /^[-*]\s+(.+?)\s*[:=]\s*(.+)$/;

export function parseMemoryContent(content: ContentNode[]): ParsedMemory {
  const entries: MemoryEntry[] = [];
  const flat: Record<string, unknown> = {};

  for (const node of content) {
    const n = node as { type?: string; value?: string; language?: string };

    if (n.type === 'Paragraph') {
      const lines = (n.value || '').split('\n');
      for (const line of lines) {
        const boldMatch = line.match(BULLET_PATTERN);
        if (boldMatch) {
          const key = boldMatch[1]!.trim();
          const value = boldMatch[2]!.trim();
          entries.push({ key, value, source: 'paragraph' });
          flat[key] = value;
          continue;
        }
        const simpleMatch = line.match(SIMPLE_BULLET);
        if (simpleMatch) {
          const key = simpleMatch[1]!.trim();
          const value = simpleMatch[2]!.trim();
          entries.push({ key, value, source: 'paragraph' });
          flat[key] = value;
        }
      }
    } else if (n.type === 'CodeBlock' && n.language === 'json') {
      try {
        const parsed = JSON.parse(n.value || '');
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            entries.push({ key, value, source: 'codeblock' });
            flat[key] = value;
          }
        }
      } catch {
        // skip invalid JSON
      }
    }
  }

  return { entries, flat, keys: Object.keys(flat) };
}

export function mergeMemory(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

export function filterMemoryByPrefix(
  data: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      result[key.slice(prefix.length)] = value;
    }
  }
  return result;
}
