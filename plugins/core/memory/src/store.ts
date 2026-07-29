/**
 * Memory Plugin - In-Memory Store & File Persistence
 */

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const MEMORY_DIR = join(process.cwd(), '.mam', 'memory');

export class MemoryStore {
  private store: Map<string, unknown> = new Map();
  private memoryDir: string;

  constructor(memoryDir?: string) {
    this.memoryDir = memoryDir || MEMORY_DIR;
  }

  get(moduleId: string, key: string): unknown {
    return this.store.get(`${moduleId}:${key}`);
  }

  set(moduleId: string, key: string, value: unknown): void {
    this.store.set(`${moduleId}:${key}`, value);
  }

  has(moduleId: string, key: string): boolean {
    return this.store.has(`${moduleId}:${key}`);
  }

  delete(moduleId: string, key: string): boolean {
    return this.store.delete(`${moduleId}:${key}`);
  }

  keys(moduleId: string): string[] {
    const prefix = `${moduleId}:`;
    const result: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        result.push(key.slice(prefix.length));
      }
    }
    return result;
  }

  entries(moduleId: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const prefix = `${moduleId}:`;
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        result[key.slice(prefix.length)] = value;
      }
    }
    return result;
  }

  clear(moduleId?: string): void {
    if (moduleId) {
      const prefix = `${moduleId}:`;
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) {
          this.store.delete(key);
        }
      }
    } else {
      this.store.clear();
    }
  }

  size(moduleId?: string): number {
    if (moduleId) {
      return this.keys(moduleId).length;
    }
    return this.store.size;
  }

  async loadFile(moduleId: string): Promise<Record<string, unknown>> {
    const memFile = join(this.memoryDir, `${moduleId}.json`);
    try {
      await access(memFile);
      const content = await readFile(memFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async saveFile(moduleId: string, data: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(this.memoryDir, { recursive: true });
      const memFile = join(this.memoryDir, `${moduleId}.json`);
      await writeFile(memFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // ignore write errors
    }
  }

  async syncFromFile(moduleId: string): Promise<void> {
    const fileData = await this.loadFile(moduleId);
    for (const [key, value] of Object.entries(fileData)) {
      this.set(moduleId, key, value);
    }
  }

  async persistToFile(moduleId: string): Promise<void> {
    const data = this.entries(moduleId);
    await this.saveFile(moduleId, data);
  }
}

export function createMemoryStore(memoryDir?: string): MemoryStore {
  return new MemoryStore(memoryDir);
}
