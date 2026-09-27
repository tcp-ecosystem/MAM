import { createHash } from 'node:crypto';

export interface LockfileEntry {
  name: string;
  version: string;
  source?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
}

export function createLockfileEntry(
  name: string,
  version: string,
  extra?: Partial<Omit<LockfileEntry, 'name' | 'version'>>,
): LockfileEntry {
  const entry: LockfileEntry = { name, version };
  if (extra?.source !== undefined) entry.source = extra.source;
  if (extra?.integrity !== undefined) entry.integrity = extra.integrity;
  if (extra?.dependencies !== undefined) entry.dependencies = { ...extra.dependencies };
  return entry;
}

export function parseLockfile(text: string): LockfileEntry[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error('Lockfile must contain an array of entries');
  }
  return parsed.map((item) => normalizeLockfileEntry(item));
}

export function serializeLockfile(entries: LockfileEntry[]): string {
  return JSON.stringify(sortLockfileEntries(entries), null, 2) + '\n';
}

export function mergeLockfiles(a: LockfileEntry[], b: LockfileEntry[]): LockfileEntry[] {
  const merged = a.map((entry) => cloneLockfileEntry(entry));
  const index = new Map<string, number>(merged.map((entry, i) => [entry.name, i] as [string, number]));
  for (const entry of b) {
    const existing = index.get(entry.name);
    if (existing !== undefined) {
      merged[existing] = cloneLockfileEntry(entry);
    } else {
      index.set(entry.name, merged.length);
      merged.push(cloneLockfileEntry(entry));
    }
  }
  return sortLockfileEntries(merged);
}

export function verifyLockfile(entries: LockfileEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of entries.entries()) {
    if (!entry.name) {
      errors.push(`entries[${i}].name is required`);
    } else if (seen.has(entry.name)) {
      errors.push(`duplicate lockfile entry "${entry.name}"`);
    } else {
      seen.add(entry.name);
    }
    if (!entry.version) {
      errors.push(`entries[${i}].version is required for "${entry.name || 'unknown'}"`);
    } else if (!/^\d+\.\d+\.\d+/.test(entry.version)) {
      errors.push(`entries[${i}].version must be semver, got "${entry.version}"`);
    }
    if (entry.integrity !== undefined && !isValidIntegrityFormat(entry.integrity)) {
      errors.push(`entries[${i}].integrity has invalid format for "${entry.name}"`);
    }
  }
  const cycles = detectDependencyCycles(buildDependencyGraph(entries));
  for (const cycle of cycles) {
    errors.push(`dependency cycle detected: ${cycle.join(' -> ')}`);
  }
  return errors;
}

export function sortLockfileEntries(entries: LockfileEntry[]): LockfileEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeLockfileEntry(item: unknown): LockfileEntry {
  if (typeof item !== 'object' || item === null) {
    throw new Error('Lockfile entry must be an object');
  }
  const record = item as Record<string, unknown>;
  if (typeof record.name !== 'string' || typeof record.version !== 'string') {
    throw new Error('Lockfile entry must have string name and version');
  }
  const entry: LockfileEntry = { name: record.name, version: record.version };
  if (typeof record.source === 'string') entry.source = record.source;
  if (typeof record.integrity === 'string') entry.integrity = record.integrity;
  if (isStringRecord(record.dependencies)) entry.dependencies = { ...record.dependencies };
  return entry;
}

function cloneLockfileEntry(entry: LockfileEntry): LockfileEntry {
  const clone: LockfileEntry = { name: entry.name, version: entry.version };
  if (entry.source !== undefined) clone.source = entry.source;
  if (entry.integrity !== undefined) clone.integrity = entry.integrity;
  if (entry.dependencies !== undefined) clone.dependencies = { ...entry.dependencies };
  return clone;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function findLockfileEntry(entries: LockfileEntry[], name: string): LockfileEntry | undefined {
  return entries.find((entry) => entry.name === name);
}

function hasLockfileEntry(entries: LockfileEntry[], name: string): boolean {
  return findLockfileEntry(entries, name) !== undefined;
}

function removeLockfileEntry(entries: LockfileEntry[], name: string): LockfileEntry[] {
  return entries.filter((entry) => entry.name !== name);
}

function getLockfileNames(entries: LockfileEntry[]): string[] {
  return entries.map((entry) => entry.name);
}

function countLockfileEntries(entries: LockfileEntry[]): number {
  return entries.length;
}

function getOutdatedEntries(entries: LockfileEntry[], latest: Record<string, string>): LockfileEntry[] {
  return entries.filter((entry) => {
    const version = latest[entry.name];
    return version !== undefined && version !== entry.version;
  });
}

function diffLockfileEntries(a: LockfileEntry[], b: LockfileEntry[]): { added: string[]; removed: string[]; changed: string[] } {
  const aNames = new Set(getLockfileNames(a));
  const bNames = new Set(getLockfileNames(b));
  const added = [...bNames].filter((name) => !aNames.has(name));
  const removed = [...aNames].filter((name) => !bNames.has(name));
  const changed: string[] = [];
  for (const entry of a) {
    const other = findLockfileEntry(b, entry.name);
    if (other && other.version !== entry.version) {
      changed.push(entry.name);
    }
  }
  return { added, removed, changed };
}

function formatLockfileSummary(entries: LockfileEntry[]): string {
  if (entries.length === 0) return '0 locked dependencies';
  const names = getLockfileNames(sortLockfileEntries(entries)).join(', ');
  return `${entries.length} locked dependencies: ${names}`;
}

function getEntryDependencyNames(entry: LockfileEntry): string[] {
  return Object.keys(entry.dependencies ?? {});
}

function hasIntegrity(entry: LockfileEntry): boolean {
  return entry.integrity !== undefined && entry.integrity.length > 0;
}

function getEntriesMissingIntegrity(entries: LockfileEntry[]): LockfileEntry[] {
  return entries.filter((entry) => !hasIntegrity(entry));
}

function compareSemver(a: string, b: string): number {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

function parseSemverParts(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isVersionInRange(version: string, minimum: string): boolean {
  return compareSemver(version, minimum) >= 0;
}

function pickHighestVersion(versions: string[]): string | undefined {
  let best: string | undefined;
  for (const version of versions) {
    if (best === undefined || compareSemver(version, best) > 0) {
      best = version;
    }
  }
  return best;
}

function isValidIntegrityFormat(integrity: string): boolean {
  return /^(sha512|sha384|sha256|sha1|md5)-[A-Za-z0-9+/=]+$/.test(integrity);
}

function buildDependencyGraph(entries: LockfileEntry[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const entry of entries) {
    graph.set(entry.name, Object.keys(entry.dependencies ?? {}));
  }
  return graph;
}

function detectDependencyCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    if (stack.includes(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (graph.has(dep)) {
        visit(dep);
      }
    }
    stack.pop();
  };
  for (const node of graph.keys()) {
    visit(node);
  }
  return cycles;
}

function findOrphanedEntries(entries: LockfileEntry[]): LockfileEntry[] {
  const required = new Set<string>();
  for (const entry of entries) {
    for (const dep of Object.keys(entry.dependencies ?? {})) {
      required.add(dep);
    }
  }
  const names = new Set(getLockfileNames(entries));
  return entries.filter((entry) => entry.dependencies && !required.has(entry.name) && names.size > 1 && false);
}

function entriesToRecord(entries: LockfileEntry[]): Record<string, LockfileEntry> {
  const record: Record<string, LockfileEntry> = {};
  for (const entry of entries) {
    record[entry.name] = cloneLockfileEntry(entry);
  }
  return record;
}

function recordToEntries(record: Record<string, LockfileEntry>): LockfileEntry[] {
  return sortLockfileEntries(Object.values(record).map(cloneLockfileEntry));
}

function formatEntryLine(entry: LockfileEntry): string {
  const source = entry.source ? ` from ${entry.source}` : '';
  return `${entry.name}@${entry.version}${source}`;
}

function formatEntriesList(entries: LockfileEntry[]): string {
  return entries.map((entry) => `  - ${formatEntryLine(entry)}`).join('\n');
}

function computeContentIntegrity(content: string): string {
  return `sha512-${createHash('sha512').update(content).digest('base64')}`;
}

function getTransitiveDependencies(entries: LockfileEntry[], name: string): string[] {
  const graph = buildDependencyGraph(entries);
  const result: string[] = [];
  const seen = new Set<string>([name]);
  const queue = [...(graph.get(name) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    queue.push(...(graph.get(current) ?? []));
  }
  return result.sort();
}

function getDependencyDepth(entries: LockfileEntry[], name: string): number {
  const graph = buildDependencyGraph(entries);
  const depths = new Map<string, number>();
  const visit = (node: string, trail: string[]): number => {
    if (trail.includes(node)) return 0;
    const cached = depths.get(node);
    if (cached !== undefined) return cached;
    const deps = graph.get(node) ?? [];
    let depth = 0;
    for (const dep of deps) {
      depth = Math.max(depth, 1 + visit(dep, [...trail, node]));
    }
    depths.set(node, depth);
    return depth;
  };
  return visit(name, []);
}
