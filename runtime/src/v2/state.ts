import { StateManager, StateCallback, StateChange } from './types.js';

interface StateEntry {
  value: unknown;
  createdAt: number;
  updatedAt: number;
  version: number;
  expiresAt?: number;
}

interface StateSnapshot {
  timestamp: number;
  state: Map<string, unknown>;
}

interface LockInfo {
  mode: 'exclusive' | 'shared';
  holders: number;
  queue: Array<() => void>;
}

interface TransactionOp {
  type: 'set' | 'delete' | 'setNamespace' | 'deleteNamespace';
  key: string;
  namespace?: string;
  value?: unknown;
}

interface Transaction {
  id: number;
  snapshot: Map<string, StateEntry>;
  namespaceSnapshots: Map<string, Map<string, StateEntry>>;
  ops: TransactionOp[];
  nestingLevel: number;
}

type StateValidator = (key: string, value: unknown) => boolean;

export class DefaultStateManager implements StateManager {
  private state = new Map<string, StateEntry>();
  private subscribers = new Map<string, Set<StateCallback>>();
  private historyLog: StateChange[] = [];
  private namespaces: Map<string, Map<string, StateEntry>> = new Map();
  private snapshots: StateSnapshot[] = [];
  private maxSnapshots: number;
  private maxHistory: number;
  private validators = new Map<string, StateValidator[]>();
  private globalValidators: StateValidator[] = [];
  private locks = new Map<string, LockInfo>();
  private watchers = new Map<string, Set<(key: string, oldValue: unknown, newValue: unknown) => void>>();
  private globalUpdateCallbacks = new Set<(change: StateChange) => void>();
  private transactions: Transaction[] = [];
  private nextTransactionId = 1;
  private namespaceList = new Set<string>();

  constructor(options?: { maxSnapshots?: number; maxHistory?: number }) {
    this.maxSnapshots = options?.maxSnapshots ?? 10;
    this.maxHistory = options?.maxHistory ?? 500;
  }

  private get activeTransaction(): Transaction | undefined {
    return this.transactions.length > 0 ? this.transactions[this.transactions.length - 1] : undefined;
  }

  get(key: string): unknown {
    const entry = this.state.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.state.delete(key);
      return undefined;
    }
    return entry.value;
  }

  getByNamespace(namespace: string, key: string): unknown {
    const ns = this.namespaces.get(namespace);
    if (!ns) return undefined;
    const entry = ns.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      ns.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: unknown): void {
    const tx = this.activeTransaction;
    if (tx) {
      tx.ops.push({ type: 'set', key, value });
      return;
    }
    this.applySet(key, value);
  }

  private applySet(key: string, value: unknown): void {
    if (!this.validateEntry(key, value)) {
      throw new Error(`Validation failed for key: ${key}`);
    }
    const now = Date.now();
    const existing = this.state.get(key);
    const oldValue = existing?.value ?? null;
    const version = (existing?.version ?? 0) + 1;

    this.state.set(key, {
      value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version,
      expiresAt: existing?.expiresAt,
    });

    const change: StateChange = {
      key,
      oldValue,
      newValue: value,
      timestamp: now,
    };
    this.historyLog.push(change);

    if (this.historyLog.length > this.maxHistory) {
      this.historyLog.shift();
    }

    this.notifySubscribers(key, oldValue, value);
    this.notifyWatchers(key, oldValue, value);
    this.notifyGlobalUpdate(change);
  }

  setNamespace(namespace: string, key: string, value: unknown): void {
    const tx = this.activeTransaction;
    if (tx) {
      tx.ops.push({ type: 'setNamespace', key, namespace, value });
      return;
    }
    this.applySetNamespace(namespace, key, value);
  }

  private applySetNamespace(namespace: string, key: string, value: unknown): void {
    if (!this.validateEntry(`${namespace}:${key}`, value)) {
      throw new Error(`Validation failed for namespace key: ${namespace}:${key}`);
    }
    const now = Date.now();
    if (!this.namespaces.has(namespace)) {
      this.namespaces.set(namespace, new Map());
      this.namespaceList.add(namespace);
    }
    const ns = this.namespaces.get(namespace)!;
    const existing = ns.get(key);
    const oldValue = existing?.value ?? null;
    const version = (existing?.version ?? 0) + 1;

    ns.set(key, { value, createdAt: existing?.createdAt ?? now, updatedAt: now, version });

    const change: StateChange = {
      key: `${namespace}:${key}`,
      oldValue,
      newValue: value,
      timestamp: now,
    };
    this.historyLog.push(change);
    this.notifyGlobalUpdate(change);
  }

  delete(key: string): void {
    const tx = this.activeTransaction;
    if (tx) {
      tx.ops.push({ type: 'delete', key });
      return;
    }
    this.applyDelete(key);
  }

  private applyDelete(key: string): void {
    const entry = this.state.get(key);
    const oldValue = entry?.value ?? null;
    this.state.delete(key);

    const change: StateChange = {
      key,
      oldValue,
      newValue: null,
      timestamp: Date.now(),
    };
    this.historyLog.push(change);

    this.notifySubscribers(key, oldValue, null);
    this.notifyWatchers(key, oldValue, null);
    this.notifyGlobalUpdate(change);
  }

  deleteNamespace(namespace: string, key: string): void {
    const tx = this.activeTransaction;
    if (tx) {
      tx.ops.push({ type: 'deleteNamespace', key, namespace });
      return;
    }
    this.applyDeleteNamespace(namespace, key);
  }

  private applyDeleteNamespace(namespace: string, key: string): void {
    const ns = this.namespaces.get(namespace);
    if (ns) {
      const entry = ns.get(key);
      const oldValue = entry?.value ?? null;
      ns.delete(key);

      const change: StateChange = {
        key: `${namespace}:${key}`,
        oldValue,
        newValue: null,
        timestamp: Date.now(),
      };
      this.historyLog.push(change);
      this.notifyGlobalUpdate(change);
    }
  }

  getAll(): Record<string, unknown> {
    this.evictExpired();
    const result: Record<string, unknown> = {};
    for (const [key, entry] of this.state) {
      result[key] = entry.value;
    }
    return result;
  }

  getNamespace(namespace: string): Record<string, unknown> {
    const ns = this.namespaces.get(namespace);
    if (!ns) return {};
    const result: Record<string, unknown> = {};
    for (const [key, entry] of ns) {
      result[key] = entry.value;
    }
    return result;
  }

  subscribe(key: string, callback: StateCallback): void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
  }

  unsubscribe(key: string, callback: StateCallback): void {
    const subscriberSet = this.subscribers.get(key);
    if (subscriberSet) {
      subscriberSet.delete(callback);
      if (subscriberSet.size === 0) {
        this.subscribers.delete(key);
      }
    }
  }

  history(): StateChange[] {
    return [...this.historyLog];
  }

  clearHistory(): void {
    this.historyLog = [];
  }

  clear(): void {
    this.state.clear();
    this.namespaces.clear();
    this.historyLog = [];
    this.namespaceList.clear();
    this.locks.clear();
  }

  snapshot(): StateSnapshot {
    this.evictExpired();
    const snapshot: StateSnapshot = {
      timestamp: Date.now(),
      state: new Map(Array.from(this.state.entries()).map(([k, v]) => [k, v.value])),
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    return snapshot;
  }

  restoreSnapshot(snapshot: StateSnapshot): void {
    this.state.clear();
    const now = Date.now();
    for (const [key, value] of snapshot.state) {
      this.state.set(key, { value, createdAt: now, updatedAt: now, version: 1 });
    }
  }

  has(key: string): boolean {
    const entry = this.state.get(key);
    if (!entry) return false;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.state.delete(key);
      return false;
    }
    return true;
  }

  size(): number {
    this.evictExpired();
    return this.state.size;
  }

  keys(): string[] {
    this.evictExpired();
    return Array.from(this.state.keys());
  }

  addValidator(key: string, validator: StateValidator): void {
    if (!this.validators.has(key)) {
      this.validators.set(key, []);
    }
    this.validators.get(key)!.push(validator);
  }

  addGlobalValidator(validator: StateValidator): void {
    this.globalValidators.push(validator);
  }

  removeValidator(key: string, validator: StateValidator): void {
    const list = this.validators.get(key);
    if (list) {
      const idx = list.indexOf(validator);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  removeGlobalValidator(validator: StateValidator): void {
    const idx = this.globalValidators.indexOf(validator);
    if (idx !== -1) this.globalValidators.splice(idx, 1);
  }

  diff(snapshot1: StateSnapshot, snapshot2: StateSnapshot): Record<string, { oldValue: unknown; newValue: unknown }> {
    const result: Record<string, { oldValue: unknown; newValue: unknown }> = {};
    const allKeys = new Set([...snapshot1.state.keys(), ...snapshot2.state.keys()]);
    for (const key of allKeys) {
      const v1 = snapshot1.state.get(key);
      const v2 = snapshot2.state.get(key);
      if (v1 !== v2) {
        result[key] = { oldValue: v1 ?? null, newValue: v2 ?? null };
      }
    }
    return result;
  }

  lock(key: string, mode: 'exclusive' | 'shared'): Promise<void> {
    return new Promise<void>((resolve) => {
      const existing = this.locks.get(key);
      if (!existing) {
        this.locks.set(key, { mode, holders: 1, queue: [] });
        resolve();
        return;
      }
      if (mode === 'shared' && existing.mode === 'shared') {
        existing.holders++;
        resolve();
        return;
      }
      existing.queue.push(() => {
        if (mode === 'shared' && existing.mode === 'shared') {
          existing.holders++;
        } else {
          existing.mode = mode;
          existing.holders = 1;
        }
        resolve();
      });
    });
  }

  unlock(key: string): void {
    const existing = this.locks.get(key);
    if (!existing) return;
    existing.holders--;
    if (existing.holders <= 0) {
      const next = existing.queue.shift();
      if (next) {
        next();
      } else {
        this.locks.delete(key);
      }
    }
  }

  isLocked(key: string): boolean {
    const lock = this.locks.get(key);
    return lock !== undefined && lock.holders > 0;
  }

  watch(key: string, callback: (key: string, oldValue: unknown, newValue: unknown) => void): () => void {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key)!.add(callback);
    return () => {
      const set = this.watchers.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) this.watchers.delete(key);
      }
    };
  }

  onUpdate(callback: (change: StateChange) => void): () => void {
    this.globalUpdateCallbacks.add(callback);
    return () => {
      this.globalUpdateCallbacks.delete(callback);
    };
  }

  beginTransaction(): number {
    const id = this.nextTransactionId++;
    const snapshot = new Map(this.state.entries());
    const namespaceSnapshots = new Map<string, Map<string, StateEntry>>();
    for (const [ns, entries] of this.namespaces) {
      namespaceSnapshots.set(ns, new Map(entries));
    }
    const nestingLevel = this.transactions.length;
    this.transactions.push({ id, snapshot, namespaceSnapshots, ops: [], nestingLevel });
    return id;
  }

  commitTransaction(id: number): void {
    const idx = this.transactions.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Transaction ${id} not found`);
    const tx = this.transactions[idx];
    this.transactions.splice(idx, 1);
    for (const op of tx.ops) {
      switch (op.type) {
        case 'set':
          this.applySet(op.key, op.value!);
          break;
        case 'delete':
          this.applyDelete(op.key);
          break;
        case 'setNamespace':
          this.applySetNamespace(op.namespace!, op.key, op.value);
          break;
        case 'deleteNamespace':
          this.applyDeleteNamespace(op.namespace!, op.key);
          break;
      }
    }
  }

  rollbackTransaction(id: number): void {
    const idx = this.transactions.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Transaction ${id} not found`);
    const tx = this.transactions[idx];
    this.transactions.splice(idx, 1);
    this.state = new Map(tx.snapshot);
    for (const [ns, entries] of tx.namespaceSnapshots) {
      this.namespaces.set(ns, new Map(entries));
    }
  }

  getCurrentTransactionId(): number | null {
    if (this.transactions.length === 0) return null;
    return this.transactions[this.transactions.length - 1].id;
  }

  setSize(key: string, value: unknown): void {
    this.set(key, value);
  }

  getVersion(key: string): number {
    const entry = this.state.get(key);
    return entry?.version ?? 0;
  }

  expire(key: string, ttlMs: number): void {
    const entry = this.state.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlMs;
    }
  }

  persist(key: string): void {
    const entry = this.state.get(key);
    if (entry) {
      entry.expiresAt = undefined;
    }
  }

  getKeysByPrefix(prefix: string): string[] {
    this.evictExpired();
    const result: string[] = [];
    for (const key of this.state.keys()) {
      if (key.startsWith(prefix)) result.push(key);
    }
    return result;
  }

  getKeysByRegex(pattern: RegExp | string): string[] {
    this.evictExpired();
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const result: string[] = [];
    for (const key of this.state.keys()) {
      if (regex.test(key)) result.push(key);
    }
    return result;
  }

  listNamespaces(): string[] {
    return Array.from(this.namespaceList);
  }

  getNamespaceKeys(namespace: string): string[] {
    const ns = this.namespaces.get(namespace);
    if (!ns) return [];
    return Array.from(ns.keys());
  }

  private validateEntry(key: string, value: unknown): boolean {
    for (const v of this.globalValidators) {
      if (!v(key, value)) return false;
    }
    const keyValidators = this.validators.get(key);
    if (keyValidators) {
      for (const v of keyValidators) {
        if (!v(key, value)) return false;
      }
    }
    return true;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.state) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.state.delete(key);
      }
    }
    for (const [, ns] of this.namespaces) {
      for (const [key, entry] of ns) {
        if (entry.expiresAt && now > entry.expiresAt) {
          ns.delete(key);
        }
      }
    }
  }

  private notifySubscribers(key: string, oldValue: unknown, newValue: unknown): void {
    const subscriberSet = this.subscribers.get(key);
    if (subscriberSet) {
      for (const callback of subscriberSet) {
        try {
          callback(key, oldValue, newValue);
        } catch {}
      }
    }

    const globalSubscribers = this.subscribers.get('*');
    if (globalSubscribers) {
      for (const callback of globalSubscribers) {
        try {
          callback(key, oldValue, newValue);
        } catch {}
      }
    }
  }

  private notifyWatchers(key: string, oldValue: unknown, newValue: unknown): void {
    const watcherSet = this.watchers.get(key);
    if (watcherSet) {
      for (const callback of watcherSet) {
        try {
          callback(key, oldValue, newValue);
        } catch {}
      }
    }
  }

  private notifyGlobalUpdate(change: StateChange): void {
    for (const callback of this.globalUpdateCallbacks) {
      try {
        callback(change);
      } catch {}
    }
  }
}
