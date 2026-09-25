package mam

import (
	"strings"
	"sync"
	"time"
)

// defaultCacheMaxEntries bounds cache growth when callers never prune.
// Once reached, each further insert evicts the oldest entry first, so
// write throughput stays constant no matter how many distinct keys flow
// through the cache.
const defaultCacheMaxEntries = 4096

// maxCacheKeyLength rejects absurdly long keys before they enter the map.
// The limit is generous on purpose: it only stops programming mistakes
// (such as using whole file contents as keys), never legitimate use.
const maxCacheKeyLength = 1024

// cacheStats is a snapshot of cache counters.
type cacheStats struct {
	Hits      int
	Misses    int
	Evictions int
}

// cacheEntry is a single cached value with bookkeeping metadata.
type cacheEntry struct {
	value    interface{}
	storedAt time.Time
	ttl      time.Duration
}

// ResultCache is a concurrency-safe in-memory cache for execution results
// and other expensive values, keyed by string.
//
// Key handling:
//   - Keys are trimmed on every operation; empty keys never hit and are
//     rejected on write.
//   - Keys containing control characters (including newlines) are
//     rejected to keep debug output and any future persistence sane.
//   - Keys longer than an internal limit are rejected.
//
// Expiry and bounds:
//   - Entries expire after the cache TTL; a non-positive TTL disables
//     expiry entirely.
//   - Expired entries are removed eagerly on read and opportunistically
//     on write (Size always reports live entries only).
//   - When the cache grows past an internal cap, oldest entries are
//     evicted on insert to keep memory bounded.
//
// Hit, miss, and eviction counters accumulate for the cache lifetime;
// Clear resets them alongside the entries.
type ResultCache struct {
	mu         sync.RWMutex
	entries    map[string]cacheEntry
	hits       int
	misses     int
	evictions  int
	ttl        time.Duration
	maxEntries int
}

// NewResultCache creates an empty cache. A non-positive ttl disables
// expiry. The cache holds at most a few thousand entries; older entries
// are evicted first when the cap is exceeded.
func NewResultCache(ttl time.Duration) *ResultCache {
	return &ResultCache{
		entries:    make(map[string]cacheEntry),
		ttl:        clampCacheTTL(ttl),
		maxEntries: defaultCacheMaxEntries,
	}
}

// Get returns the cached value for key, or (nil, false) on miss, invalid
// key, or expiry.
//
// A lookup counts as a miss when the key is absent, fails validation, or
// holds an expired entry; expired entries are removed eagerly so a later
// Size call never observes them. A hit returns the stored value as-is —
// callers holding mutable values must treat them as shared.
func (c *ResultCache) Get(key string) (interface{}, bool) {
	norm, ok := normalizeCacheKey(key)
	if !ok {
		c.mu.Lock()
		c.misses++
		c.mu.Unlock()
		return nil, false
	}
	c.mu.RLock()
	entry, found := c.entries[norm]
	c.mu.RUnlock()
	if !found {
		c.mu.Lock()
		c.misses++
		c.mu.Unlock()
		return nil, false
	}
	if entryExpired(entry, time.Now()) {
		c.mu.Lock()
		delete(c.entries, norm)
		c.misses++
		c.mu.Unlock()
		return nil, false
	}
	c.mu.Lock()
	c.hits++
	c.mu.Unlock()
	return entry.value, true
}

// Set stores value under key with the cache default TTL, replacing any
// previous entry for that key.
//
// Invalid keys (empty after trimming, overlong, or containing control
// characters) are ignored. Before inserting, expired entries are purged
// opportunistically; when the cache still exceeds its cap, oldest entries
// are evicted first so a single hot loop cannot grow memory without
// bound. Re-setting an existing key refreshes its stored timestamp.
func (c *ResultCache) Set(key string, value interface{}) {
	norm, ok := normalizeCacheKey(key)
	if !ok {
		return
	}
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.purgeExpiredLocked(now)
	if _, exists := c.entries[norm]; !exists {
		for len(c.entries) >= c.maxEntries {
			before := len(c.entries)
			c.evictOldestLocked()
			if len(c.entries) >= before {
				break
			}
		}
	}
	c.entries[norm] = cacheEntry{value: value, storedAt: now, ttl: c.ttl}
}

// Delete removes a single entry, reporting whether it existed. Invalid
// keys report false without touching the map. Deleting an already
// expired entry still reports true when the entry was present.
func (c *ResultCache) Delete(key string) bool {
	norm, ok := normalizeCacheKey(key)
	if !ok {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[norm]; !exists {
		return false
	}
	delete(c.entries, norm)
	return true
}

// Clear drops every entry and resets hit/miss/eviction statistics, which
// makes the cache indistinguishable from a freshly constructed one.
func (c *ResultCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[string]cacheEntry)
	c.hits = 0
	c.misses = 0
	c.evictions = 0
}

// Size purges expired entries first, then returns the live entry count.
// Because of the purge, Size reflects entries a Get would actually hit,
// not just map occupancy.
func (c *ResultCache) Size() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	c.purgeExpiredLocked(now)
	return len(c.liveKeysLocked(now))
}

// Prune removes expired entries and returns how many were dropped. It
// is a no-op for caches constructed with a non-positive TTL. Call it
// periodically when keys are deleted rarely but Size is never queried,
// otherwise dead entries linger until the next write.
func (c *ResultCache) Prune() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.purgeExpiredLocked(time.Now())
}

// Stats returns a snapshot of hit, miss, and eviction counters. The
// snapshot is a copy; mutating it does not affect the cache.
func (c *ResultCache) Stats() cacheStats {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return cacheStats{Hits: c.hits, Misses: c.misses, Evictions: c.evictions}
}

// HitRate returns hits / (hits + misses), or 0 when nothing was looked
// up yet. A persistently low rate suggests keys churn faster than the
// TTL, or callers bypass the cache.
func (c *ResultCache) HitRate() float64 {
	stats := c.Stats()
	total := stats.Hits + stats.Misses
	if total == 0 {
		return 0
	}
	return float64(stats.Hits) / float64(total)
}

// GetOrSet returns the cached value, computing and storing it on miss.
//
// The factory runs outside the cache lock and its result is stored with
// the default TTL, so concurrent callers for the same missing key may
// each run the factory but only the last write wins. An invalid key
// skips the cache entirely and just returns the factory result.
func (c *ResultCache) GetOrSet(key string, factory func() interface{}) interface{} {
	if value, ok := c.Get(key); ok {
		return value
	}
	c.mu.Lock()
	norm, ok := normalizeCacheKey(key)
	if ok {
		if entry, found := c.entries[norm]; found && !entryExpired(entry, time.Now()) {
			c.hits++
			value := entry.value
			c.mu.Unlock()
			return value
		}
	}
	c.mu.Unlock()
	value := factory()
	if ok {
		c.Set(norm, value)
	}
	return value
}

func normalizeCacheKey(key string) (string, bool) {
	norm := strings.TrimSpace(key)
	if norm == "" || len(norm) > maxCacheKeyLength {
		return "", false
	}
	for i := 0; i < len(norm); i++ {
		if norm[i] < 0x20 || norm[i] == 0x7f {
			return "", false
		}
	}
	return norm, true
}

func entryExpired(entry cacheEntry, now time.Time) bool {
	if entry.ttl <= 0 {
		return false
	}
	return now.Sub(entry.storedAt) >= entry.ttl
}

func (c *ResultCache) purgeExpiredLocked(now time.Time) int {
	removed := 0
	for key, entry := range c.entries {
		if entryExpired(entry, now) {
			delete(c.entries, key)
			removed++
		}
	}
	return removed
}

func (c *ResultCache) evictOldestLocked() {
	var oldestKey string
	var oldestTime time.Time
	first := true
	for key, entry := range c.entries {
		if first || entry.storedAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = entry.storedAt
			first = false
		}
	}
	if !first {
		delete(c.entries, oldestKey)
		c.evictions++
	}
}

func (c *ResultCache) liveKeysLocked(now time.Time) []string {
	keys := make([]string, 0, len(c.entries))
	for key, entry := range c.entries {
		if !entryExpired(entry, now) {
			keys = append(keys, key)
		}
	}
	return keys
}

func clampCacheTTL(ttl time.Duration) time.Duration {
	if ttl < 0 {
		return 0
	}
	return ttl
}
