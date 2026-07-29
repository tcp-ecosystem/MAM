---
title: Memory Plugin
description: Memory backend plugin for MAM modules
version: 1.0.0
author: MAM Examples
license: MIT
tags: [plugin, memory, redis, postgresql, cache, example]
---

# Memory Plugin

Demonstrates how to register custom memory backends with the MAM Plugin API.
This plugin provides Redis, PostgreSQL, and in-memory backends for persisting
module state, execution results, and inter-section communication.

## Overview

Memory backends store key-value data that persists across module executions.
They support TTL-based expiration, namespaced isolation, batch operations,
and connection pooling. The plugin registers multiple backends and routes
requests based on configuration.

## Plugin Manifest (`plugin.json`)

```json
{
  "name": "custom-memory-backends",
  "version": "1.0.0",
  "description": "Custom memory backends: Redis, PostgreSQL, In-Memory for MAM modules",
  "author": "MAM Examples",
  "license": "MIT",
  "mamVersion": ">=0.1.0",
  "keywords": ["memory", "redis", "postgres", "cache"],
  "categories": ["storage"],
  "main": "dist/index.js",
  "engines": { "mam": ">=0.1.0" }
}
```

## TypeScript Plugin Code

```typescript
import { MAMPlugin, PluginConfig } from "@mam/plugin-api";
import { randomBytes } from "node:crypto";

// ─── Memory Interface ─────────────────────────────────────────────

interface MemoryBackend {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
  mget(keys: string[]): Promise<(string | null)[]>;
  mset(entries: Array<{ key: string; value: string; ttlMs?: number }>): Promise<void>;
  mdel(keys: string[]): Promise<number>;
  ttl(key: string): Promise<number>;
  size(): Promise<number>;
  isAvailable(): Promise<boolean>;
}

// ─── In-Memory Backend ────────────────────────────────────────────

class InMemoryBackend implements MemoryBackend {
  name = "memory";
  private store = new Map<string, { value: string; expiresAt: number | null }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<void> {
    this.cleanupInterval = setInterval(() => this.evictExpired(), 1000);
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.store.clear();
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.store.keys());
    if (!pattern) return allKeys;
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return allKeys.filter((k) => regex.test(k));
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  async mset(entries: Array<{ key: string; value: string; ttlMs?: number }>): Promise<void> {
    for (const { key, value, ttlMs } of entries) {
      await this.set(key, value, ttlMs);
    }
  }

  async mdel(keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (await this.delete(k)) count++;
    }
    return count;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry || !entry.expiresAt) return -1;
    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : -2;
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// ─── Redis Backend ────────────────────────────────────────────────

class RedisBackend implements MemoryBackend {
  name = "redis";
  private client: any = null;
  private prefix: string;

  constructor(private config: { url: string; prefix?: string }) {
    this.prefix = config.prefix || "mam:";
  }

  async connect(): Promise<void> {
    // Dynamic import to avoid hard dependency
    try {
      const redis = await import("redis");
      this.client = redis.createClient({ url: this.config.url });
      this.client.on("error", (err: Error) => console.error("[redis-backend]", err));
      await this.client.connect();
    } catch (err) {
      throw new Error(`Redis connection failed: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) await this.client.disconnect();
  }

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<string | null> {
    return this.client?.get(this.key(key)) ?? null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs) {
      await this.client?.setEx(this.key(key), Math.ceil(ttlMs / 1000), value);
    } else {
      await this.client?.set(this.key(key), value);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.client?.del(this.key(key));
    return result > 0;
  }

  async has(key: string): Promise<boolean> {
    const exists = await this.client?.exists(this.key(key));
    return exists > 0;
  }

  async clear(): Promise<void> {
    const keys = await this.client?.keys(`${this.prefix}*`);
    if (keys?.length) await this.client?.del(keys);
  }

  async keys(pattern?: string): Promise<string[]> {
    const searchPattern = pattern
      ? `${this.prefix}${pattern}`
      : `${this.prefix}*`;
    const keys = await this.client?.keys(searchPattern);
    return (keys || []).map((k: string) => k.slice(this.prefix.length));
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.client?.mGet(keys.map((k) => this.key(k))) ?? [];
  }

  async mset(entries: Array<{ key: string; value: string; ttlMs?: number }>): Promise<void> {
    const pipeline = this.client?.multi();
    for (const { key, value, ttlMs } of entries) {
      if (ttlMs) {
        pipeline?.setEx(this.key(key), Math.ceil(ttlMs / 1000), value);
      } else {
        pipeline?.set(this.key(key), value);
      }
    }
    await pipeline?.exec();
  }

  async mdel(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client?.del(keys.map((k) => this.key(k))) ?? 0;
  }

  async ttl(key: string): Promise<number> {
    const remaining = await this.client?.ttl(this.key(key));
    return remaining ?? -2;
  }

  async size(): Promise<number> {
    const keys = await this.client?.keys(`${this.prefix}*`);
    return keys?.length ?? 0;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client?.ping();
      return true;
    } catch {
      return false;
    }
  }
}

// ─── PostgreSQL Backend ───────────────────────────────────────────

class PostgresBackend implements MemoryBackend {
  name = "postgresql";
  private pool: any = null;
  private tableName: string;

  constructor(private config: { connectionString: string; table?: string }) {
    this.tableName = config.table || "mam_memory";
  }

  async connect(): Promise<void> {
    try {
      const { Pool } = await import("pg");
      this.pool = new Pool({ connectionString: this.config.connectionString });

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          expires_at BIGINT,
          created_at BIGINT DEFAULT ${Date.now()}
        )
      `);
      await this.pool.query(
        `CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires ON ${this.tableName}(expires_at)`
      );
    } catch (err) {
      throw new Error(`PostgreSQL connection failed: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) await this.pool.end();
  }

  async get(key: string): Promise<string | null> {
    const result = await this.pool?.query(
      `SELECT value, expires_at FROM ${this.tableName} WHERE key = $1`,
      [key],
    );
    if (!result?.rows[0]) return null;
    const row = result.rows[0];
    if (row.expires_at && Date.now() > row.expires_at) {
      await this.delete(key);
      return null;
    }
    return row.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    await this.pool?.query(
      `INSERT INTO ${this.tableName} (key, value, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3`,
      [key, value, expiresAt],
    );
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.pool?.query(
      `DELETE FROM ${this.tableName} WHERE key = $1`,
      [key],
    );
    return result?.rowCount > 0;
  }

  async has(key: string): Promise<boolean> {
    const result = await this.pool?.query(
      `SELECT 1 FROM ${this.tableName} WHERE key = $1 AND (expires_at IS NULL OR expires_at > $2)`,
      [key, Date.now()],
    );
    return result?.rowCount > 0;
  }

  async clear(): Promise<void> {
    await this.pool?.query(`DELETE FROM ${this.tableName}`);
  }

  async keys(pattern?: string): Promise<string[]> {
    let query = `SELECT key FROM ${this.tableName} WHERE (expires_at IS NULL OR expires_at > $1)`;
    const params: any[] = [Date.now()];

    if (pattern) {
      query += ` AND key LIKE $2`;
      params.push(pattern.replace(/\*/g, "%"));
    }

    const result = await this.pool?.query(query, params);
    return result?.rows.map((r: any) => r.key) ?? [];
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    const result = await this.pool?.query(
      `SELECT key, value, expires_at FROM ${this.tableName} WHERE key = ANY($1) AND (expires_at IS NULL OR expires_at > $2)`,
      [keys, Date.now()],
    );
    const map = new Map(result?.rows.map((r: any) => [r.key, r.value]) ?? []);
    return keys.map((k) => map.get(k) ?? null);
  }

  async mset(entries: Array<{ key: string; value: string; ttlMs?: number }>): Promise<void> {
    const client = await this.pool?.connect();
    try {
      await client.query("BEGIN");
      for (const { key, value, ttlMs } of entries) {
        const expiresAt = ttlMs ? Date.now() + ttlMs : null;
        await client.query(
          `INSERT INTO ${this.tableName} (key, value, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3`,
          [key, value, expiresAt],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async mdel(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const result = await this.pool?.query(
      `DELETE FROM ${this.tableName} WHERE key = ANY($1)`,
      [keys],
    );
    return result?.rowCount ?? 0;
  }

  async ttl(key: string): Promise<number> {
    const result = await this.pool?.query(
      `SELECT expires_at FROM ${this.tableName} WHERE key = $1`,
      [key],
    );
    if (!result?.rows[0]) return -2;
    if (!result.rows[0].expires_at) return -1;
    const remaining = result.rows[0].expires_at - Date.now();
    return remaining > 0 ? remaining : -2;
  }

  async size(): Promise<number> {
    const result = await this.pool?.query(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE expires_at IS NULL OR expires_at > $1`,
      [Date.now()],
    );
    return parseInt(result?.rows[0]?.count ?? "0", 10);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.pool?.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Plugin Assembly ──────────────────────────────────────────────

const memoryPlugin: MAMPlugin = {
  manifest: {
    name: "custom-memory-backends",
    version: "1.0.0",
    description: "Custom memory backends: Redis, PostgreSQL, In-Memory for MAM modules",
    author: "MAM Examples",
    license: "MIT",
    mamVersion: ">=0.1.0",
    keywords: ["memory", "redis", "postgres", "cache"],
    categories: ["storage"],
    main: "dist/index.js",
  },

  hooks: {
    onModuleLoad: (module) => {
      // Initialize memory namespace for the module
      const moduleId = (module as any).id || randomBytes(8).toString("hex");
      (module as any)._memoryNamespace = `module:${moduleId}`;
      return module;
    },

    onConfigChange: (config) => {
      // Handle memory backend configuration changes
      if (config.memory) {
        console.log("[memory-plugin] Memory config updated:", Object.keys(config.memory));
      }
      return config;
    },
  },
};

// ─── Factory & Registry ──────────────────────────────────────────

const backends = new Map<string, MemoryBackend>();

export function createBackend(type: "memory" | "redis" | "postgresql", config?: any): MemoryBackend {
  switch (type) {
    case "redis":
      return new RedisBackend(config || { url: "redis://localhost:6379" });
    case "postgresql":
      return new PostgresBackend(config || { connectionString: "postgresql://localhost/mam" });
    case "memory":
    default:
      return new InMemoryBackend();
  }
}

export function registerBackend(name: string, backend: MemoryBackend): void {
  backends.set(name, backend);
}

export function getBackend(name: string): MemoryBackend | undefined {
  return backends.get(name);
}

export async function connectAll(): Promise<void> {
  for (const backend of backends.values()) {
    await backend.connect();
  }
}

export async function disconnectAll(): Promise<void> {
  for (const backend of backends.values()) {
    await backend.disconnect();
  }
}

// Register default backends
registerBackend("memory", createBackend("memory"));

export default memoryPlugin;
```

## Python Memory Backends

```python
"""
Custom memory backends for MAM modules.

Provides Redis, PostgreSQL, and in-memory storage with TTL support,
namespaced isolation, batch operations, and connection pooling.
Designed for use as state stores, caches, and inter-section communication.
"""

from __future__ import annotations

import json
import time
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Iterator
from collections.abc import MutableMapping
import hashlib


@dataclass
class MemoryEntry:
    """A single memory entry with optional TTL."""
    value: str
    expires_at: float | None = None
    created_at: float = field(default_factory=time.time)

    @property
    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return time.time() > self.expires_at


class MemoryBackend(ABC):
    """Abstract base class for memory backends."""

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def get(self, key: str) -> str | None: ...

    @abstractmethod
    def set(self, key: str, value: str, ttl_ms: int | None = None) -> None: ...

    @abstractmethod
    def delete(self, key: str) -> bool: ...

    @abstractmethod
    def has(self, key: str) -> bool: ...

    @abstractmethod
    def clear(self) -> None: ...

    @abstractmethod
    def keys(self, pattern: str | None = None) -> list[str]: ...

    @abstractmethod
    def size(self) -> int: ...

    def mget(self, keys: list[str]) -> list[str | None]:
        return [self.get(k) for k in keys]

    def mset(self, entries: list[tuple[str, str, int | None]]) -> None:
        for key, value, ttl_ms in entries:
            self.set(key, value, ttl_ms)

    def mdel(self, keys: list[str]) -> int:
        return sum(1 for k in keys if self.delete(k))

    def ttl(self, key: str) -> int:
        return -1

    def is_available(self) -> bool:
        return True


# ─── In-Memory Backend ─────────────────────────────────────────────

class InMemoryMemory(MemoryBackend):
    """Thread-safe in-memory key-value store with TTL support."""

    def __init__(self) -> None:
        self._store: dict[str, MemoryEntry] = {}
        self._lock = threading.Lock()
        self._cleanup_thread: threading.Thread | None = None
        self._running = False

    def connect(self) -> None:
        self._running = True
        self._cleanup_thread = threading.Thread(target=self._cleanup_loop, daemon=True)
        self._cleanup_thread.start()

    def disconnect(self) -> None:
        self._running = False
        if self._cleanup_thread:
            self._cleanup_thread.join(timeout=1)
        self._store.clear()

    def get(self, key: str) -> str | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if entry.is_expired:
                del self._store[key]
                return None
            return entry.value

    def set(self, key: str, value: str, ttl_ms: int | None = None) -> None:
        expires_at = (time.time() + ttl_ms / 1000) if ttl_ms else None
        with self._lock:
            self._store[key] = MemoryEntry(value=value, expires_at=expires_at)

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._store:
                del self._store[key]
                return True
            return False

    def has(self, key: str) -> bool:
        return self.get(key) is not None

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def keys(self, pattern: str | None = None) -> list[str]:
        import fnmatch
        with self._lock:
            all_keys = list(self._store.keys())
            # Evict expired
            expired = [k for k, v in self._store.items() if v.is_expired]
            for k in expired:
                del self._store[k]
            all_keys = [k for k in all_keys if k not in expired]

        if pattern:
            return [k for k in all_keys if fnmatch.fnmatch(k, pattern)]
        return all_keys

    def size(self) -> int:
        with self._lock:
            return len([e for e in self._store.values() if not e.is_expired])

    def ttl(self, key: str) -> int:
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return -2
            if entry.expires_at is None:
                return -1
            remaining = int((entry.expires_at - time.time()) * 1000)
            return max(remaining, -2)

    def _cleanup_loop(self) -> None:
        while self._running:
            time.sleep(1)
            with self._lock:
                expired = [k for k, v in self._store.items() if v.is_expired]
                for k in expired:
                    del self._store[k]


# ─── Redis Backend ─────────────────────────────────────────────────

class RedisMemory(MemoryBackend):
    """Redis-backed memory store with optional key prefix."""

    def __init__(self, url: str = "redis://localhost:6379", prefix: str = "mam:") -> None:
        self._url = url
        self._prefix = prefix
        self._client: Any = None

    def _key(self, key: str) -> str:
        return f"{self._prefix}{key}"

    def connect(self) -> None:
        try:
            import redis
            self._client = redis.Redis.from_url(self._url, decode_responses=True)
            self._client.ping()
        except ImportError:
            raise ImportError("redis package required: pip install redis")
        except Exception as e:
            raise ConnectionError(f"Redis connection failed: {e}")

    def disconnect(self) -> None:
        if self._client:
            self._client.close()

    def get(self, key: str) -> str | None:
        return self._client.get(self._key(key))

    def set(self, key: str, value: str, ttl_ms: int | None = None) -> None:
        if ttl_ms:
            self._client.setex(self._key(key), ttl_ms // 1000, value)
        else:
            self._client.set(self._key(key), value)

    def delete(self, key: str) -> bool:
        return self._client.delete(self._key(key)) > 0

    def has(self, key: str) -> bool:
        return self._client.exists(self._key(key)) > 0

    def clear(self) -> None:
        keys = self._client.keys(f"{self._prefix}*")
        if keys:
            self._client.delete(*keys)

    def keys(self, pattern: str | None = None) -> list[str]:
        search = f"{self._prefix}{pattern or '*'}"
        result = self._client.keys(search)
        prefix_len = len(self._prefix)
        return [k[prefix_len:] for k in result]

    def mget(self, keys: list[str]) -> list[str | None]:
        return self._client.mget([self._key(k) for k in keys])

    def mset(self, entries: list[tuple[str, str, int | None]]) -> None:
        pipe = self._client.pipeline()
        for key, value, ttl_ms in entries:
            if ttl_ms:
                pipe.setex(self._key(key), ttl_ms // 1000, value)
            else:
                pipe.set(self._key(key), value)
        pipe.execute()

    def mdel(self, keys: list[str]) -> int:
        return self._client.delete(*[self._key(k) for k in keys])

    def ttl(self, key: str) -> int:
        remaining = self._client.ttl(self._key(key))
        return remaining * 1000 if remaining > 0 else remaining

    def size(self) -> int:
        return len(self._client.keys(f"{self._prefix}*"))

    def is_available(self) -> bool:
        try:
            return self._client.ping()
        except Exception:
            return False


# ─── PostgreSQL Backend ────────────────────────────────────────────

class PostgresMemory(MemoryBackend):
    """PostgreSQL-backed memory store with structured table."""

    def __init__(
        self,
        connection_string: str = "postgresql://localhost/mam",
        table: str = "mam_memory",
    ) -> None:
        self._connection_string = connection_string
        self._table = table
        self._pool: Any = None

    def connect(self) -> None:
        try:
            import psycopg2
            import psycopg2.pool

            self._pool = psycopg2.pool.ThreadedConnectionPool(
                1, 10, self._connection_string
            )
            conn = self._pool.getconn()
            try:
                cur = conn.cursor()
                cur.execute(f"""
                    CREATE TABLE IF NOT EXISTS {self._table} (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL,
                        expires_at BIGINT,
                        created_at BIGINT DEFAULT %s
                    )
                """, (int(time.time()),))
                cur.execute(f"""
                    CREATE INDEX IF NOT EXISTS idx_{self._table}_expires
                    ON {self._table}(expires_at)
                """)
                conn.commit()
            finally:
                self._pool.putconn(conn)
        except ImportError:
            raise ImportError("psycopg2 required: pip install psycopg2-binary")
        except Exception as e:
            raise ConnectionError(f"PostgreSQL connection failed: {e}")

    def disconnect(self) -> None:
        if self._pool:
            self._pool.closeall()

    def _get_conn(self) -> Any:
        return self._pool.getconn()

    def _put_conn(self, conn: Any) -> None:
        self._pool.putconn(conn)

    def get(self, key: str) -> str | None:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT value, expires_at FROM {self._table} WHERE key = %s",
                (key,),
            )
            row = cur.fetchone()
            if not row:
                return None
            value, expires_at = row
            if expires_at and time.time() > expires_at:
                self.delete(key)
                return None
            return value
        finally:
            self._put_conn(conn)

    def set(self, key: str, value: str, ttl_ms: int | None = None) -> None:
        expires_at = int(time.time() + ttl_ms / 1000) if ttl_ms else None
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                f"""INSERT INTO {self._table} (key, value, expires_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (key) DO UPDATE SET value = %s, expires_at = %s""",
                (key, value, expires_at, value, expires_at),
            )
            conn.commit()
        finally:
            self._put_conn(conn)

    def delete(self, key: str) -> bool:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(f"DELETE FROM {self._table} WHERE key = %s", (key,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            self._put_conn(conn)

    def has(self, key: str) -> bool:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT 1 FROM {self._table} WHERE key = %s AND (expires_at IS NULL OR expires_at > %s)",
                (key, int(time.time())),
            )
            return cur.fetchone() is not None
        finally:
            self._put_conn(conn)

    def clear(self) -> None:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(f"DELETE FROM {self._table}")
            conn.commit()
        finally:
            self._put_conn(conn)

    def keys(self, pattern: str | None = None) -> list[str]:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            now = int(time.time())
            if pattern:
                sql_pattern = pattern.replace("*", "%")
                cur.execute(
                    f"SELECT key FROM {self._table} WHERE (expires_at IS NULL OR expires_at > %s) AND key LIKE %s",
                    (now, sql_pattern),
                )
            else:
                cur.execute(
                    f"SELECT key FROM {self._table} WHERE expires_at IS NULL OR expires_at > %s",
                    (now,),
                )
            return [row[0] for row in cur.fetchall()]
        finally:
            self._put_conn(conn)

    def size(self) -> int:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT COUNT(*) FROM {self._table} WHERE expires_at IS NULL OR expires_at > %s",
                (int(time.time()),),
            )
            return cur.fetchone()[0]
        finally:
            self._put_conn(conn)

    def ttl(self, key: str) -> int:
        conn = self._get_conn()
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT expires_at FROM {self._table} WHERE key = %s",
                (key,),
            )
            row = cur.fetchone()
            if not row:
                return -2
            if row[0] is None:
                return -1
            remaining = int((row[0] - time.time()) * 1000)
            return max(remaining, -2)
        finally:
            self._put_conn(conn)

    def is_available(self) -> bool:
        try:
            conn = self._get_conn()
            try:
                cur = conn.cursor()
                cur.execute("SELECT 1")
                return True
            finally:
                self._put_conn(conn)
        except Exception:
            return False


# ─── Memory Manager ────────────────────────────────────────────────

class MemoryManager:
    """Manages multiple memory backends and routes operations."""

    def __init__(self) -> None:
        self._backends: dict[str, MemoryBackend] = {}
        self._default: str | None = None

    def register(self, name: str, backend: MemoryBackend, default: bool = False) -> None:
        """Register a memory backend."""
        self._backends[name] = backend
        if default or not self._default:
            self._default = name

    def get_backend(self, name: str | None = None) -> MemoryBackend:
        """Get a backend by name, or the default."""
        target = name or self._default
        if not target:
            raise ValueError("No memory backend configured")
        backend = self._backends.get(target)
        if not backend:
            raise ValueError(f"Unknown memory backend: {target}")
        return backend

    def connect_all(self) -> None:
        """Connect all registered backends."""
        for backend in self._backends.values():
            backend.connect()

    def disconnect_all(self) -> None:
        """Disconnect all registered backends."""
        for backend in self._backends.values():
            backend.disconnect()

    def list_backends(self) -> dict[str, bool]:
        """List all backends and their availability."""
        return {name: b.is_available() for name, b in self._backends.items()}


# ─── Tests ──────────────────────────────────────────────────────────

def test_in_memory_basic():
    m = InMemoryMemory()
    m.connect()
    m.set("foo", "bar")
    assert m.get("foo") == "bar"
    assert m.has("foo")
    m.delete("foo")
    assert not m.has("foo")
    m.disconnect()


def test_in_memory_ttl():
    m = InMemoryMemory()
    m.connect()
    m.set("temp", "value", ttl_ms=100)
    assert m.get("temp") == "value"
    time.sleep(0.15)
    assert m.get("temp") is None
    m.disconnect()


def test_in_memory_batch():
    m = InMemoryMemory()
    m.connect()
    m.mset([("a", "1", None), ("b", "2", None), ("c", "3", None)])
    assert m.mget(["a", "b", "c"]) == ["1", "2", "3"]
    assert m.mdel(["a", "c"]) == 2
    assert m.mget(["a", "b", "c"]) == [None, "2", None]
    m.disconnect()


def test_in_memory_keys():
    m = InMemoryMemory()
    m.connect()
    m.set("user:1", "alice")
    m.set("user:2", "bob")
    m.set("post:1", "hello")
    assert set(m.keys("user:*")) == {"user:1", "user:2"}
    assert len(m.keys()) == 3
    m.disconnect()


def test_in_memory_size():
    m = InMemoryMemory()
    m.connect()
    m.set("a", "1")
    m.set("b", "2")
    assert m.size() == 2
    m.delete("a")
    assert m.size() == 1
    m.disconnect()


def test_memory_manager():
    manager = MemoryManager()
    backend = InMemoryMemory()
    manager.register("test", backend, default=True)
    assert manager.get_backend() is backend
    assert "test" in manager.list_backends()


if __name__ == "__main__":
    test_in_memory_basic()
    test_in_memory_ttl()
    test_in_memory_batch()
    test_in_memory_keys()
    test_in_memory_size()
    test_memory_manager()
    print("All tests passed.")
```

## Usage

```bash
# Configure default backend in mam.config.json
{
  "memory": {
    "backend": "redis",
    "redis": { "url": "redis://localhost:6379", "prefix": "mam:" },
    "ttl": 3600000
  }
}

# Or use in-memory (default)
mam run my-module.mam.md
```

```typescript
// Programmatic usage
import { createBackend, registerBackend } from "./plugins/memory-plugin";

const redis = createBackend("redis", { url: "redis://localhost:6379" });
await redis.connect();

await redis.set("module:123:state", JSON.stringify({ step: 1 }), 3600000);
const state = await redis.get("module:123:state");
console.log(JSON.parse(state!));

// Batch operations
await redis.mset([
  { key: "k1", value: "v1" },
  { key: "k2", value: "v2", ttlMs: 60000 },
]);
const values = await redis.mget(["k1", "k2"]);
```

## What This Demonstrates

| Concept | Where |
|---------|-------|
| Backend interface | `MemoryBackend` abstract class with full CRUD + TTL |
| TTL management | Expiration tracking, automatic eviction, TTL queries |
| Namespaced isolation | Key prefixes for module-level data separation |
| Batch operations | `mget`, `mset`, `mdel` for efficient multi-key access |
| Connection pooling | PostgreSQL `ThreadedConnectionPool`, Redis pipeline |
| Thread safety | `threading.Lock` for in-memory concurrent access |
| Cleanup daemon | Background thread for expired key eviction |
| Factory pattern | `createBackend()` dispatching by type string |
| Plugin hooks | `onModuleLoad` namespace init, `onConfigChange` |
