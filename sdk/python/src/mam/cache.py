"""
Result Cache for Python.

Provides a time-to-live cache for expensive computation results such as parsed
modules, validation reports, and execution outcomes. The cache supports hit/miss
statistics, pruning of expired entries, and JSON-backed persistence.

Example::

    from mam.cache import create_result_cache

    cache = create_result_cache(ttl_seconds=60)
    value = cache.get_or_set("module:a", lambda: expensive_parse())
    print(cache.hit_rate())
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional

__all__ = [
    "CacheEntry",
    "CacheStats",
    "ResultCache",
    "DEFAULT_CACHE_TTL_SECONDS",
    "create_result_cache",
    "hash_cache_key",
    "format_cache_stats",
    "is_valid_cache_key",
]

DEFAULT_CACHE_TTL_SECONDS = 300.0


@dataclass
class CacheEntry:
    """A single cached value with creation and expiry metadata."""

    key: str
    value: Any
    created_at: float
    expires_at: Optional[float] = None
    hits: int = 0

    def is_expired(self, now: Optional[float] = None) -> bool:
        """Return True when the entry has passed its expiry time."""

        if self.expires_at is None:
            return False
        return (time.time() if now is None else now) >= self.expires_at

    def age(self, now: Optional[float] = None) -> float:
        """Return the age of the entry in seconds."""

        return max(0.0, (time.time() if now is None else now) - self.created_at)

    def to_dict(self) -> Dict[str, Any]:
        """Return the entry as a plain dictionary."""

        return {
            "key": self.key,
            "value": self.value,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "hits": self.hits,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> CacheEntry:
        """Rebuild an entry from its dictionary form."""

        return cls(
            key=str(data.get("key", "")),
            value=data.get("value"),
            created_at=float(data.get("created_at", 0.0)),
            expires_at=data.get("expires_at"),
            hits=int(data.get("hits", 0)),
        )


@dataclass
class CacheStats:
    """Counters describing cache activity."""

    entries: int = 0
    hits: int = 0
    misses: int = 0
    evictions: int = 0
    sets: int = 0
    deletes: int = 0

    @property
    def lookups(self) -> int:
        """Return the total number of lookups performed."""

        return self.hits + self.misses

    @property
    def hit_rate(self) -> float:
        """Return the hit rate as a fraction between 0.0 and 1.0."""

        if self.lookups == 0:
            return 0.0
        return self.hits / self.lookups

    def to_dict(self) -> Dict[str, Any]:
        """Return the stats as a plain dictionary."""

        return {
            "entries": self.entries,
            "hits": self.hits,
            "misses": self.misses,
            "evictions": self.evictions,
            "sets": self.sets,
            "deletes": self.deletes,
            "lookups": self.lookups,
            "hit_rate": round(self.hit_rate, 6),
        }


def is_valid_cache_key(key: Any) -> bool:
    """Return True when the key is a usable non-empty single-line string."""

    if not isinstance(key, str):
        return False
    if not key.strip():
        return False
    return not ("\n" in key or "\r" in key or "\0" in key)


def hash_cache_key(parts: Any) -> str:
    """Return a stable SHA-256 hex digest for a composite cache key.

    Accepts a string, an iterable of parts, or any other JSON-serializable
    value. Parts are joined with a NUL delimiter so that ambiguous inputs such
    as ``["a:b"]`` and ``["a", "b"]`` still hash differently.
    """

    if isinstance(parts, str):
        payload = parts
    elif isinstance(parts, (list, tuple)):
        payload = "\0".join(str(part) for part in parts)
    else:
        try:
            payload = json.dumps(parts, sort_keys=True, default=str)
        except (TypeError, ValueError):
            payload = str(parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def format_cache_stats(stats: Any) -> str:
    """Render cache statistics as a single readable line."""

    if isinstance(stats, CacheStats):
        entries = stats.entries
        lookups = stats.lookups
        rate = stats.hit_rate
        evictions = stats.evictions
    elif isinstance(stats, dict):
        entries = int(stats.get("entries", 0))
        lookups = int(stats.get("lookups", 0)) or (
            int(stats.get("hits", 0)) + int(stats.get("misses", 0))
        )
        rate = float(stats.get("hit_rate", 0.0))
        evictions = int(stats.get("evictions", 0))
    else:
        return "invalid cache stats"
    if rate > 1.0:
        rate = 1.0
    line = f"{entries} entries, {lookups} lookups, {rate * 100:.1f}% hit rate"
    if evictions:
        line += f", {evictions} evictions"
    return line


class ResultCache:
    """A TTL cache for computed results.

    Args:
        ttl_seconds: Default lifetime for entries. Use 0 for entries that never
            expire.
    """

    def __init__(self, ttl_seconds: float = DEFAULT_CACHE_TTL_SECONDS):
        if ttl_seconds < 0:
            raise ValueError("ttl_seconds must be >= 0")
        self.ttl_seconds = float(ttl_seconds)
        self._entries: Dict[str, CacheEntry] = {}
        self._stats = CacheStats()

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, key: object) -> bool:
        if not is_valid_cache_key(key):
            return False
        entry = self._entries.get(str(key))
        if entry is None:
            return False
        return not entry.is_expired()

    def __iter__(self) -> Iterator[str]:
        return iter(list(self._entries.keys()))

    def __repr__(self) -> str:
        return (
            f"ResultCache(entries={len(self._entries)}, "
            f"ttl={self.ttl_seconds}s, hit_rate={self._stats.hit_rate:.2f})"
        )

    def size(self) -> int:
        """Return the number of entries currently held, including expired ones."""

        return len(self._entries)

    def keys(self) -> List[str]:
        """Return the cached keys in insertion order."""

        return list(self._entries.keys())

    def has(self, key: str) -> bool:
        """Return True when a live entry exists for the key."""

        return key in self

    def get(self, key: str, default: Any = None) -> Any:
        """Return the cached value, or ``default`` on a miss or expiry.

        Expiry is lazy: a stale entry is dropped and counted as an eviction.
        """

        if not is_valid_cache_key(key):
            return default
        entry = self._entries.get(key)
        if entry is None:
            self._stats.misses += 1
            return default
        if entry.is_expired():
            del self._entries[key]
            self._stats.evictions += 1
            self._stats.misses += 1
            return default
        entry.hits += 1
        self._stats.hits += 1
        return entry.value

    def set(self, key: str, value: Any, ttl_seconds: Optional[float] = None) -> None:
        """Store a value under the key.

        Raises:
            ValueError: When the key is not a usable cache key.
        """

        if not is_valid_cache_key(key):
            raise ValueError(f"Invalid cache key: {key!r}")
        ttl = self.ttl_seconds if ttl_seconds is None else float(ttl_seconds)
        if ttl < 0:
            raise ValueError("ttl_seconds must be >= 0")
        now = time.time()
        expires_at = now + ttl if ttl > 0 else None
        self._entries[key] = CacheEntry(
            key=key, value=value, created_at=now, expires_at=expires_at
        )
        self._stats.sets += 1

    def get_or_set(self, key: str, factory: Callable[[], Any]) -> Any:
        """Return the cached value, computing and storing it on a miss.

        The factory is called at most once per live entry, so concurrent
        callers of an already-populated key never recompute.
        """

        if not is_valid_cache_key(key):
            raise ValueError(f"Invalid cache key: {key!r}")
        entry = self._entries.get(key)
        if entry is not None and not entry.is_expired():
            entry.hits += 1
            self._stats.hits += 1
            return entry.value
        if entry is not None:
            del self._entries[key]
            self._stats.evictions += 1
        self._stats.misses += 1
        value = factory()
        self.set(key, value)
        return value

    def delete(self, key: str) -> bool:
        """Remove a key. Returns True when an entry was removed."""

        if key in self._entries:
            del self._entries[key]
            self._stats.deletes += 1
            return True
        return False

    def clear(self) -> None:
        """Remove every entry, keeping cumulative statistics."""

        self._entries.clear()

    def prune(self) -> int:
        """Remove all expired entries and return how many were removed."""

        stale = [key for key, entry in self._entries.items() if entry.is_expired()]
        for key in stale:
            del self._entries[key]
        self._stats.evictions += len(stale)
        return len(stale)

    def remaining_ttl(self, key: str) -> Optional[float]:
        """Return the seconds left before expiry, or None when non-expiring."""

        if not is_valid_cache_key(key):
            return None
        entry = self._entries.get(key)
        if entry is None or entry.expires_at is None:
            return None
        return max(0.0, entry.expires_at - time.time())

    def stats(self) -> CacheStats:
        """Return a snapshot of the cache statistics."""

        return CacheStats(
            entries=len(self._entries),
            hits=self._stats.hits,
            misses=self._stats.misses,
            evictions=self._stats.evictions,
            sets=self._stats.sets,
            deletes=self._stats.deletes,
        )

    def hit_rate(self) -> float:
        """Return the hit rate as a fraction between 0.0 and 1.0."""

        return self._stats.hit_rate

    def items(self) -> List[tuple]:
        """Return live ``(key, value)`` pairs."""

        return [
            (key, entry.value)
            for key, entry in self._entries.items()
            if not entry.is_expired()
        ]

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-serializable snapshot of the cache."""

        return {
            "ttl_seconds": self.ttl_seconds,
            "entries": [entry.to_dict() for entry in self._entries.values()],
            "stats": self._stats.to_dict(),
        }

    def save_to_file(self, path: str) -> str:
        """Write the cache to a JSON file and return the path written.

        Raises:
            OSError: When the file cannot be written.
        """

        destination = Path(path)
        if destination.parent and str(destination.parent):
            destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(self.to_dict(), indent=2, default=str), encoding="utf-8"
        )
        return str(destination)

    def load_from_file(self, path: str) -> int:
        """Replace the cache contents from a JSON file.

        Returns the number of entries restored.

        Raises:
            FileNotFoundError: When the file does not exist.
            ValueError: When the file is not valid JSON or has the wrong shape.
        """

        source = Path(path)
        if not source.is_file():
            raise FileNotFoundError(f"Cache file not found: {source}")
        try:
            data = json.loads(source.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Cache file {source} is not valid JSON: {exc}") from exc
        if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
            raise ValueError(f"Cache file {source} has an unsupported structure")

        self._entries.clear()
        for item in data["entries"]:
            if not isinstance(item, dict):
                continue
            entry = CacheEntry.from_dict(item)
            if is_valid_cache_key(entry.key):
                self._entries[entry.key] = entry
        return len(self._entries)


def create_result_cache(ttl_seconds: float = DEFAULT_CACHE_TTL_SECONDS) -> ResultCache:
    """Create a new :class:`ResultCache` with the given default TTL."""

    return ResultCache(ttl_seconds=ttl_seconds)
