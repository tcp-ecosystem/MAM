/**
 * @file cache.c
 * @brief A TTL cache for computed strings.
 *
 * The cache stores string values only, which keeps ownership trivial: each
 * entry owns exactly one key and one value, both released by mam_cache_free.
 * Expiry is lazy on read and eager on prune, so a stale entry is never handed
 * back to a caller even if nobody has pruned yet.
 */

#include "internal.h"

/** Finds an entry by key, or NULL. Borrowed. */
static mam_cache_entry_t *mam_cache_find(mam_cache_t *cache, const char *key)
{
    for (size_t i = 0u; i < cache->entry_count; i++) {
        if (strcmp(cache->entries[i].key, key) == 0) {
            return &cache->entries[i];
        }
    }
    return NULL;
}

/** Finds an entry by key for const use. Borrowed. */
static const mam_cache_entry_t *mam_cache_find_const(const mam_cache_t *cache, const char *key)
{
    for (size_t i = 0u; i < cache->entry_count; i++) {
        if (strcmp(cache->entries[i].key, key) == 0) {
            return &cache->entries[i];
        }
    }
    return NULL;
}

/** Returns true when the key is usable: non-empty, single line, no NUL. */
static bool mam_cache_key_ok(const char *key)
{
    if (key == NULL) {
        return false;
    }
    const char *trimmed = mam_str_trim(key);
    if (trimmed[0] == '\0') {
        return false;
    }
    for (const char *cursor = key; *cursor != '\0'; cursor++) {
        if (*cursor == '\n' || *cursor == '\r') {
            return false;
        }
    }
    return true;
}

/** Grows the entry array, returning false on allocation failure. */
static bool mam_cache_reserve(mam_cache_t *cache, size_t needed)
{
    if (needed <= cache->entry_capacity) {
        return true;
    }
    size_t wanted = cache->entry_capacity == 0u ? 8u : cache->entry_capacity;
    while (wanted < needed) {
        wanted *= 2u;
    }
    mam_cache_entry_t *grown =
        (mam_cache_entry_t *)realloc(cache->entries, wanted * sizeof(mam_cache_entry_t));
    if (grown == NULL) {
        return false;
    }
    cache->entries = grown;
    cache->entry_capacity = wanted;
    return true;
}

mam_cache_t *mam_cache_new(unsigned long ttl_seconds)
{
    mam_cache_t *cache = (mam_cache_t *)mam_calloc(1u, sizeof(mam_cache_t));
    if (cache == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate cache", 0u, 0u);
        return NULL;
    }
    cache->ttl_seconds = ttl_seconds;
    return cache;
}

void mam_cache_free(mam_cache_t *cache)
{
    if (cache == NULL) {
        return;
    }
    for (size_t i = 0u; i < cache->entry_count; i++) {
        free(cache->entries[i].key);
        free(cache->entries[i].value);
    }
    free(cache->entries);
    free(cache);
}

bool mam_cache_set_with_ttl(mam_cache_t *cache, const char *key, const char *value,
                            unsigned long ttl_seconds)
{
    if (cache == NULL || !mam_cache_key_ok(key) || value == NULL) {
        return false;
    }

    char *key_copy = mam_strdup(key);
    char *value_copy = mam_strdup(value);
    if (key_copy == NULL || value_copy == NULL) {
        free(key_copy);
        free(value_copy);
        return false;
    }

    unsigned long now = mam_now_seconds();
    unsigned long expires = ttl_seconds == 0ul ? 0ul : now + ttl_seconds;

    mam_cache_entry_t *existing = mam_cache_find(cache, key);
    if (existing != NULL) {
        free(existing->value);
        existing->value = value_copy;
        existing->created_at = now;
        existing->expires_at = expires;
        free(key_copy);
        cache->stats.sets++;
        return true;
    }

    if (!mam_cache_reserve(cache, cache->entry_count + 1u)) {
        free(key_copy);
        free(value_copy);
        return false;
    }
    mam_cache_entry_t *slot = &cache->entries[cache->entry_count];
    slot->key = key_copy;
    slot->value = value_copy;
    slot->created_at = now;
    slot->expires_at = expires;
    slot->hits = 0ul;
    cache->entry_count++;
    cache->stats.sets++;
    return true;
}

bool mam_cache_set(mam_cache_t *cache, const char *key, const char *value)
{
    if (cache == NULL) {
        return false;
    }
    return mam_cache_set_with_ttl(cache, key, value, cache->ttl_seconds);
}

const char *mam_cache_get(mam_cache_t *cache, const char *key)
{
    if (cache == NULL || !mam_cache_key_ok(key)) {
        return NULL;
    }
    mam_cache_entry_t *entry = mam_cache_find(cache, key);
    if (entry == NULL) {
        cache->stats.misses++;
        return NULL;
    }
    if (entry->expires_at != 0ul && mam_now_seconds() >= entry->expires_at) {
        free(entry->key);
        free(entry->value);
        size_t index = (size_t)(entry - cache->entries);
        for (size_t i = index + 1u; i < cache->entry_count; i++) {
            cache->entries[i - 1u] = cache->entries[i];
        }
        cache->entry_count--;
        cache->stats.evictions++;
        cache->stats.misses++;
        return NULL;
    }
    entry->hits++;
    cache->stats.hits++;
    return entry->value;
}

bool mam_cache_has(const mam_cache_t *cache, const char *key)
{
    if (cache == NULL || !mam_cache_key_ok(key)) {
        return false;
    }
    const mam_cache_entry_t *entry = mam_cache_find_const(cache, key);
    if (entry == NULL) {
        return false;
    }
    if (entry->expires_at != 0ul && mam_now_seconds() >= entry->expires_at) {
        return false;
    }
    return true;
}

bool mam_cache_delete(mam_cache_t *cache, const char *key)
{
    if (cache == NULL || key == NULL) {
        return false;
    }
    for (size_t i = 0u; i < cache->entry_count; i++) {
        if (strcmp(cache->entries[i].key, key) != 0) {
            continue;
        }
        free(cache->entries[i].key);
        free(cache->entries[i].value);
        for (size_t j = i + 1u; j < cache->entry_count; j++) {
            cache->entries[j - 1u] = cache->entries[j];
        }
        cache->entry_count--;
        cache->stats.deletes++;
        return true;
    }
    return false;
}

void mam_cache_clear(mam_cache_t *cache)
{
    if (cache == NULL) {
        return;
    }
    for (size_t i = 0u; i < cache->entry_count; i++) {
        free(cache->entries[i].key);
        free(cache->entries[i].value);
    }
    cache->entry_count = 0u;
}

size_t mam_cache_prune(mam_cache_t *cache)
{
    if (cache == NULL) {
        return 0u;
    }
    unsigned long now = mam_now_seconds();
    size_t removed = 0u;
    size_t i = 0u;
    while (i < cache->entry_count) {
        if (cache->entries[i].expires_at != 0ul && now >= cache->entries[i].expires_at) {
            free(cache->entries[i].key);
            free(cache->entries[i].value);
            for (size_t j = i + 1u; j < cache->entry_count; j++) {
                cache->entries[j - 1u] = cache->entries[j];
            }
            cache->entry_count--;
            removed++;
            continue;
        }
        i++;
    }
    cache->stats.evictions += (unsigned long)removed;
    return removed;
}

size_t mam_cache_size(const mam_cache_t *cache)
{
    if (cache == NULL) {
        return 0u;
    }
    return cache->entry_count;
}

void mam_cache_stats(const mam_cache_t *cache, mam_cache_stats_t *out_stats)
{
    if (out_stats == NULL) {
        return;
    }
    if (cache == NULL) {
        memset(out_stats, 0, sizeof(*out_stats));
        return;
    }
    *out_stats = cache->stats;
    out_stats->entries = cache->entry_count;
}

double mam_cache_hit_rate(const mam_cache_t *cache)
{
    if (cache == NULL) {
        return 0.0;
    }
    unsigned long lookups = cache->stats.hits + cache->stats.misses;
    if (lookups == 0ul) {
        return 0.0;
    }
    return (double)cache->stats.hits / (double)lookups;
}

char *mam_format_cache_stats(const mam_cache_t *cache)
{
    mam_cache_stats_t stats;
    mam_cache_stats(cache, &stats);
    unsigned long lookups = stats.hits + stats.misses;
    double rate = lookups == 0ul ? 0.0 : (double)stats.hits / (double)lookups;
    if (rate > 1.0) {
        rate = 1.0;
    }
    if (stats.evictions > 0ul) {
        return mam_format_alloc("%zu entries, %lu lookups, %.1f%% hit rate, %lu evictions",
                                stats.entries, lookups, rate * 100.0, stats.evictions);
    }
    return mam_format_alloc("%zu entries, %lu lookups, %.1f%% hit rate", stats.entries, lookups,
                            rate * 100.0);
}

char *mam_cache_hash_key(const char *const *parts, size_t part_count)
{
    /* FNV-1a, 64 bit. Not cryptographic; this only needs to be stable and to
     * avoid collisions between different part boundaries, which the NUL
     * delimiter guarantees. */
    unsigned long long hash = 1469598103934665603ull;
    for (size_t i = 0u; i < part_count; i++) {
        const char *part = parts != NULL ? parts[i] : NULL;
        if (part == NULL) {
            continue;
        }
        for (const char *cursor = part; *cursor != '\0'; cursor++) {
            hash ^= (unsigned long long)(unsigned char)*cursor;
            hash *= 1099511628211ull;
        }
        hash ^= 0ull;
        hash *= 1099511628211ull;
    }
    char *hex = (char *)mam_calloc(17u, 1u);
    if (hex == NULL) {
        return NULL;
    }
    for (int i = 15; i >= 0; i--) {
        static const char DIGITS[] = "0123456789abcdef";
        hex[i] = DIGITS[hash & 0xfull];
        hash >>= 4;
    }
    hex[16] = '\0';
    return hex;
}
