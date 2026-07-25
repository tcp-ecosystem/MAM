/**
 * MAM Memory Plugin
 * 
 * Provides persistent memory/state management for MAM modules.
 */

import { MAMPlugin, PluginManifest, SectionDefinition, ValidationRule } from '@mam/plugin-api';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const manifest: PluginManifest = {
  name: '@mam/plugin-memory',
  version: '1.0.0',
  description: 'Memory and state management for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['memory', 'state', 'persistence'],
  main: './index.js',
};

const memoryStore: Map<string, unknown> = new Map();
const MEMORY_DIR = join(process.cwd(), '.mam', 'memory');

function parseMemoryContent(content: unknown[]): Record<string, unknown> {
  const memory: Record<string, unknown> = {};
  for (const node of content) {
    if (node.type === 'Paragraph') {
      const lines = (node as { value: string }).value.split('\n');
      for (const line of lines) {
        const match = line.match(/^[-*]\s*\*\*(.+?)\*\*:\s*(.+)$/);
        if (match) memory[match[1]!.trim()] = match[2]!.trim();
      }
    } else if (node.type === 'CodeBlock' && (node as { language: string }).language === 'json') {
      try { Object.assign(memory, JSON.parse((node as { value: string }).value)); } catch { /* skip */ }
    }
  }
  return memory;
}

async function loadMemoryFile(moduleId: string): Promise<Record<string, unknown>> {
  const memFile = join(MEMORY_DIR, `${moduleId}.json`);
  try {
    await access(memFile);
    const content = await readFile(memFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMemoryFile(moduleId: string, data: Record<string, unknown>): Promise<void> {
  try {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(MEMORY_DIR, { recursive: true });
    const memFile = join(MEMORY_DIR, `${moduleId}.json`);
    await writeFile(memFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

const memorySection: SectionDefinition = {
  name: 'Memory',
  description: 'Persistent memory and state for the module',
  required: false,
  contentTypes: ['text', 'code'],
  validator: (content) => {
    const results = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'json') {
        try { JSON.parse((node as { value: string }).value); }
        catch (error) { results.push({ valid: false, message: `Invalid JSON in Memory: ${(error as Error).message}` }); }
      }
    }
    return results;
  },
};

const memoryRule: ValidationRule = {
  name: 'memory-consistency',
  description: 'Check memory section for consistency',
  severity: 'info',
  check: (module) => {
    const results = [];
    const memSection = module.sections.find(s => s.name === 'Memory');
    if (memSection) {
      const memory = parseMemoryContent(memSection.content);
      if (Object.keys(memory).length === 0) {
        results.push({ valid: true, message: 'Memory section is empty' });
      }
    }
    return results;
  },
};

const memoryPlugin: MAMPlugin = {
  manifest,
  sections: [memorySection],
  rules: [memoryRule],
  hooks: {
    afterParse: async (module) => {
      const memSection = module.sections.find(s => s.name === 'Memory');
      if (memSection) {
        const parsed = parseMemoryContent(memSection.content);
        const moduleId = module.frontmatter?.data.id || 'unknown';
        const existing = await loadMemoryFile(moduleId);
        const merged = { ...existing, ...parsed };
        for (const [key, value] of Object.entries(merged)) {
          memoryStore.set(`${moduleId}:${key}`, value);
        }
        await saveMemoryFile(moduleId, merged);
      }
      return module;
    },
  },
};
export default memoryPlugin;