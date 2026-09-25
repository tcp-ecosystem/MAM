//! Time-to-live result cache for the MAM Rust SDK.
//!
//! Caches expensive results such as parsed modules, validation reports, and
//! execution outcomes. Supports hit/miss statistics, pruning of expired
//! entries, and JSON-backed persistence.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Default entry lifetime, in seconds.
pub const DEFAULT_TTL_SECONDS: u64 = 300;

/// Returns the current Unix timestamp in seconds.
pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// Returns true when the key is a usable non-empty single-line string.
pub fn is_valid_cache_key(key: &str) -> bool {
    if key.trim().is_empty() {
        return false;
    }
    !key.contains('\n') && !key.contains('\r') && !key.contains('\0')
}

/// Returns a stable hex digest for a composite cache key.
///
/// This is a non-cryptographic FNV-1a hash, chosen so the crate keeps its
/// existing dependency set. Parts are joined with a NUL delimiter so that
/// `["a:b"]` and `["a", "b"]` do not collide.
pub fn hash_cache_key(parts: &[&str]) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash: u64 = OFFSET;
    for part in parts {
        for byte in part.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(PRIME);
        }
        hash ^= 0u8 as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{:016x}", hash)
}

/// A single cached value with timing metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct CacheEntry {
    /// The cache key.
    pub key: String,
    /// The cached value, stored as JSON.
    pub value: serde_json::Value,
    /// Creation time, in Unix seconds.
    pub created_at: u64,
    /// Expiry time, in Unix seconds; `None` means it never expires.
    pub expires_at: Option<u64>,
    /// Number of times this entry has been read.
    pub hits: u64,
}

impl CacheEntry {
    /// Creates a new entry.
    pub fn new(key: &str, value: serde_json::Value, ttl_seconds: u64) -> Self {
        let created_at = now_seconds();
        let expires_at = if ttl_seconds == 0 {
            None
        } else {
            Some(created_at + ttl_seconds)
        };
        Self {
            key: key.to_string(),
            value,
            created_at,
            expires_at,
            hits: 0,
        }
    }

    /// Returns true when the entry has passed its expiry time.
    pub fn is_expired(&self) -> bool {
        match self.expires_at {
            None => false,
            Some(expiry) => now_seconds() >= expiry,
        }
    }

    /// Returns the age of the entry in seconds.
    pub fn age_seconds(&self) -> u64 {
        now_seconds().saturating_sub(self.created_at)
    }

    /// Converts the entry to a JSON value.
    pub fn to_json_value(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        map.insert("key".to_string(), serde_json::Value::String(self.key.clone()));
        map.insert("value".to_string(), self.value.clone());
        map.insert("created_at".to_string(), serde_json::json!(self.created_at));
        map.insert("hits".to_string(), serde_json::json!(self.hits));
        match self.expires_at {
            Some(value) => {
                map.insert("expires_at".to_string(), serde_json::json!(value));
            }
            None => {
                map.insert("expires_at".to_string(), serde_json::Value::Null);
            }
        }
        serde_json::Value::Object(map)
    }
}

/// Cumulative cache counters.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CacheStats {
    /// Entries currently held.
    pub entries: usize,
    /// Successful lookups.
    pub hits: u64,
    /// Unsuccessful lookups, including expired entries.
    pub misses: u64,
    /// Entries removed because they expired.
    pub evictions: u64,
    /// Values written.
    pub sets: u64,
    /// Values deleted explicitly.
    pub deletes: u64,
}

impl CacheStats {
    /// Returns the total number of lookups.
    pub fn lookups(&self) -> u64 {
        self.hits + self.misses
    }

    /// Returns the hit rate as a fraction between 0.0 and 1.0.
    pub fn hit_rate(&self) -> f64 {
        if self.lookups() == 0 {
            return 0.0;
        }
        self.hits as f64 / self.lookups() as f64
    }
}

/// Errors produced by the cache.
#[derive(Debug)]
pub enum CacheError {
    /// The cache file does not exist.
    NotFound(String),
    /// The cache file could not be understood.
    Invalid(String),
    /// The cache file could not be read or written.
    Io(String),
}

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CacheError::NotFound(path) => write!(f, "Cache file not found: {}", path),
            CacheError::Invalid(message) => write!(f, "Invalid cache file: {}", message),
            CacheError::Io(message) => write!(f, "Cache IO error: {}", message),
        }
    }
}

impl std::error::Error for CacheError {}

/// A TTL cache for computed results.
#[derive(Debug, Clone, Default)]
pub struct ResultCache {
    entries: HashMap<String, CacheEntry>,
    stats: CacheStats,
    ttl_seconds: u64,
}

impl ResultCache {
    /// Creates a cache with the given default lifetime; 0 never expires.
    pub fn new(ttl_seconds: u64) -> Self {
        Self {
            entries: HashMap::new(),
            stats: CacheStats::default(),
            ttl_seconds,
        }
    }

    /// Returns the number of entries held, including expired ones.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Returns true when the cache holds no entries.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Returns the configured default lifetime.
    pub fn ttl_seconds(&self) -> u64 {
        self.ttl_seconds
    }

    /// Stores a value under the key.
    ///
    /// Returns an error when the key is not usable.
    pub fn set(&mut self, key: &str, value: serde_json::Value) -> Result<(), CacheError> {
        self.set_with_ttl(key, value, self.ttl_seconds)
    }

    /// Stores a value with an explicit lifetime.
    pub fn set_with_ttl(
        &mut self,
        key: &str,
        value: serde_json::Value,
        ttl_seconds: u64,
    ) -> Result<(), CacheError> {
        if !is_valid_cache_key(key) {
            return Err(CacheError::Invalid(format!("Invalid cache key: {:?}", key)));
        }
        self.entries
            .insert(key.to_string(), CacheEntry::new(key, value, ttl_seconds));
        self.stats.sets += 1;
        Ok(())
    }

    /// Returns the cached value, or `None` on a miss or expiry.
    ///
    /// Expiry is lazy: a stale entry is dropped and counted as an eviction.
    pub fn get(&mut self, key: &str) -> Option<serde_json::Value> {
        let expired = match self.entries.get(key) {
            Some(entry) => entry.is_expired(),
            None => {
                self.stats.misses += 1;
                return None;
            }
        };
        if expired {
            self.entries.remove(key);
            self.stats.evictions += 1;
            self.stats.misses += 1;
            return None;
        }
        if let Some(entry) = self.entries.get_mut(key) {
            entry.hits += 1;
        }
        self.stats.hits += 1;
        self.entries.get(key).map(|entry| entry.value.clone())
    }

    /// Returns true when a live entry exists for the key.
    pub fn has(&self, key: &str) -> bool {
        match self.entries.get(key) {
            Some(entry) => !entry.is_expired(),
            None => false,
        }
    }

    /// Returns the cached value, computing and storing it on a miss.
    pub fn get_or_set<F>(&mut self, key: &str, factory: F) -> Result<serde_json::Value, CacheError>
    where
        F: FnOnce() -> serde_json::Value,
    {
        if !is_valid_cache_key(key) {
            return Err(CacheError::Invalid(format!("Invalid cache key: {:?}", key)));
        }
        let live = match self.entries.get(key) {
            Some(entry) => !entry.is_expired(),
            None => false,
        };
        if live {
            if let Some(entry) = self.entries.get_mut(key) {
                entry.hits += 1;
            }
            self.stats.hits += 1;
            return Ok(self.entries.get(key).map(|e| e.value.clone()).unwrap_or(serde_json::Value::Null));
        }
        if self.entries.contains_key(key) {
            self.entries.remove(key);
            self.stats.evictions += 1;
        }
        self.stats.misses += 1;
        let value = factory();
        self.set(key, value.clone())?;
        Ok(value)
    }

    /// Removes a key, returning true when an entry was removed.
    pub fn delete(&mut self, key: &str) -> bool {
        if self.entries.remove(key).is_some() {
            self.stats.deletes += 1;
            true
        } else {
            false
        }
    }

    /// Removes every entry, keeping cumulative counters.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Removes all expired entries and returns how many were removed.
    pub fn prune(&mut self) -> usize {
        let stale: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| entry.is_expired())
            .map(|(key, _)| key.clone())
            .collect();
        for key in &stale {
            self.entries.remove(key);
        }
        self.stats.evictions += stale.len() as u64;
        stale.len()
    }

    /// Returns the seconds remaining before expiry, or `None` when not expiring.
    pub fn remaining_ttl(&self, key: &str) -> Option<u64> {
        let entry = self.entries.get(key)?;
        match entry.expires_at {
            None => None,
            Some(expiry) => Some(expiry.saturating_sub(now_seconds())),
        }
    }

    /// Returns the live keys, sorted.
    pub fn keys(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| !entry.is_expired())
            .map(|(key, _)| key.clone())
            .collect();
        names.sort();
        names
    }

    /// Returns a snapshot of the counters.
    pub fn stats(&self) -> CacheStats {
        let mut snapshot = self.stats.clone();
        snapshot.entries = self.entries.len();
        snapshot
    }

    /// Returns the hit rate as a fraction between 0.0 and 1.0.
    pub fn hit_rate(&self) -> f64 {
        self.stats.hit_rate()
    }

    /// Serializes the cache to a JSON value.
    pub fn to_json_value(&self) -> serde_json::Value {
        let entries: Vec<serde_json::Value> = self
            .entries
            .values()
            .map(|entry| entry.to_json_value())
            .collect();
        serde_json::json!({
            "ttl_seconds": self.ttl_seconds,
            "entries": entries,
        })
    }

    /// Writes the cache to disk and returns the path written.
    pub fn save_to_file(&self, path: &Path) -> Result<String, CacheError> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|error| CacheError::Io(format!("{}: {}", parent.display(), error)))?;
            }
        }
        let rendered = match serde_json::to_string_pretty(&self.to_json_value()) {
            Ok(text) => text,
            Err(error) => return Err(CacheError::Invalid(error.to_string())),
        };
        fs::write(path, format!("{}\n", rendered))
            .map_err(|error| CacheError::Io(format!("{}: {}", path.display(), error)))?;
        Ok(path.display().to_string())
    }

    /// Replaces the cache contents from a JSON file.
    ///
    /// Returns the number of entries restored.
    pub fn load_from_file(&mut self, path: &Path) -> Result<usize, CacheError> {
        if !path.is_file() {
            return Err(CacheError::NotFound(path.display().to_string()));
        }
        let raw = fs::read_to_string(path)
            .map_err(|error| CacheError::Io(format!("{}: {}", path.display(), error)))?;
        let value: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|error| CacheError::Invalid(format!("{}: {}", path.display(), error)))?;

        let entries = match value.get("entries").and_then(|item| item.as_array()) {
            Some(list) => list.clone(),
            None => {
                return Err(CacheError::Invalid(
                    "cache file has no 'entries' array".to_string(),
                ))
            }
        };

        self.entries.clear();
        for item in entries {
            let key = match item.get("key").and_then(|v| v.as_str()) {
                Some(text) => text.to_string(),
                None => continue,
            };
            if !is_valid_cache_key(&key) {
                continue;
            }
            let created_at = item
                .get("created_at")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let expires_at = item.get("expires_at").and_then(|v| v.as_u64());
            let hits = item.get("hits").and_then(|v| v.as_u64()).unwrap_or(0);
            let value = item.get("value").cloned().unwrap_or(serde_json::Value::Null);
            self.entries.insert(
                key.clone(),
                CacheEntry {
                    key,
                    value,
                    created_at,
                    expires_at,
                    hits,
                },
            );
        }
        if let Some(ttl) = value.get("ttl_seconds").and_then(|v| v.as_u64()) {
            self.ttl_seconds = ttl;
        }
        Ok(self.entries.len())
    }
}

/// Creates a cache with the given default lifetime.
pub fn create_result_cache(ttl_seconds: u64) -> ResultCache {
    ResultCache::new(ttl_seconds)
}

/// Renders cache statistics as a single readable line.
pub fn format_cache_stats(stats: &CacheStats) -> String {
    let mut rate = stats.hit_rate();
    if rate > 1.0 {
        rate = 1.0;
    }
    let mut line = format!(
        "{} entries, {} lookups, {:.1}% hit rate",
        stats.entries,
        stats.lookups(),
        rate * 100.0
    );
    if stats.evictions > 0 {
        line.push_str(&format!(", {} evictions", stats.evictions));
    }
    line
}

/// A conventional location for the cache file, honoring `MAM_CACHE_DIR`.
pub fn default_cache_path() -> PathBuf {
    if let Ok(dir) = std::env::var("MAM_CACHE_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir).join("mam.cache.json");
        }
    }
    match std::env::temp_dir() {
        Ok(_) => std::env::temp_dir().join("mam.cache.json"),
        Err(_) => PathBuf::from("mam.cache.json"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let unique = format!("mam-rust-cache-{}-{}", tag, now_seconds());
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_set_get_has() {
        let mut cache = ResultCache::new(60);
        cache.set("a", serde_json::json!("value")).unwrap();
        assert_eq!(cache.get("a"), Some(serde_json::json!("value")));
        assert!(cache.has("a"));
        assert_eq!(cache.get("missing"), None);
    }

    #[test]
    fn test_overwrite_and_len() {
        let mut cache = ResultCache::new(60);
        cache.set("a", serde_json::json!(1)).unwrap();
        cache.set("a", serde_json::json!(2)).unwrap();
        assert_eq!(cache.get("a"), Some(serde_json::json!(2)));
        assert_eq!(cache.len(), 1);
        assert!(!cache.is_empty());
    }

    #[test]
    fn test_delete_and_clear() {
        let mut cache = ResultCache::new(60);
        cache.set("a", serde_json::json!(1)).unwrap();
        cache.set("b", serde_json::json!(2)).unwrap();
        assert!(cache.delete("a"));
        assert!(!cache.delete("a"));
        cache.clear();
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn test_invalid_keys_are_rejected() {
        let mut cache = ResultCache::new(60);
        assert!(cache.set("   ", serde_json::json!(1)).is_err());
        assert!(cache.set("bad\nkey", serde_json::json!(1)).is_err());
        assert_eq!(cache.len(), 0);
        assert!(!is_valid_cache_key("ok-key"));
        assert!(is_valid_cache_key("ok-key"));
    }

    #[test]
    fn test_expiry_is_lazy() {
        let mut cache = ResultCache::new(60);
        cache.set_with_ttl("gone", serde_json::json!(1), 0).unwrap();
        // A zero lifetime means "never expires".
        assert!(cache.has("gone"));
        let mut expired = CacheEntry::new("x", serde_json::json!(1), 1);
        expired.expires_at = Some(0);
        assert!(expired.is_expired());
    }

    #[test]
    fn test_prune_removes_expired() {
        let mut cache = ResultCache::new(60);
        cache.set_with_ttl("stale", serde_json::json!(1), 1).unwrap();
        cache.set_with_ttl("fresh", serde_json::json!(2), 3600).unwrap();
        if let Some(entry) = cache.entries.get_mut("stale") {
            entry.expires_at = Some(0);
        }
        assert_eq!(cache.prune(), 1);
        assert!(cache.has("fresh"));
        assert!(!cache.has("stale"));
    }

    #[test]
    fn test_get_or_set_computes_once() {
        let mut cache = ResultCache::new(60);
        let first = cache
            .get_or_set("a", || serde_json::json!("made"))
            .unwrap();
        let second = cache
            .get_or_set("a", || serde_json::json!("other"))
            .unwrap();
        assert_eq!(first, serde_json::json!("made"));
        assert_eq!(second, serde_json::json!("made"));
    }

    #[test]
    fn test_stats_track_hits_and_misses() {
        let mut cache = ResultCache::new(60);
        cache.get("missing");
        cache.set("a", serde_json::json!(1)).unwrap();
        cache.get("a");
        let stats = cache.stats();
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 1);
        assert_eq!(stats.lookups(), 2);
        assert!((cache.hit_rate() - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_remaining_ttl_and_keys() {
        let mut cache = ResultCache::new(3600);
        cache.set("a", serde_json::json!(1)).unwrap();
        assert!(cache.remaining_ttl("a").unwrap() > 0);
        assert_eq!(cache.remaining_ttl("missing"), None);
        assert_eq!(cache.keys(), vec!["a".to_string()]);
    }

    #[test]
    fn test_hash_is_stable_and_delimited() {
        let a = hash_cache_key(&["a", "b"]);
        assert_eq!(a, hash_cache_key(&["a", "b"]));
        assert_ne!(a, hash_cache_key(&["a", "c"]));
        assert_ne!(hash_cache_key(&["a:b"]), hash_cache_key(&["a", "b"]));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn test_format_cache_stats() {
        let stats = CacheStats {
            entries: 3,
            hits: 2,
            misses: 2,
            evictions: 0,
            sets: 3,
            deletes: 0,
        };
        let text = format_cache_stats(&stats);
        assert!(text.contains("3 entries"));
        assert!(text.contains("50.0% hit rate"));
    }

    #[test]
    fn test_save_and_load_round_trip() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("cache.json");
        let mut cache = create_result_cache(3600);
        cache.set("a", serde_json::json!({ "n": 1 })).unwrap();
        cache.save_to_file(&path).unwrap();

        let mut restored = ResultCache::new(60);
        let count = restored.load_from_file(&path).unwrap();
        assert_eq!(count, 1);
        assert_eq!(restored.get("a"), Some(serde_json::json!({ "n": 1 })));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_errors() {
        let dir = temp_dir("errors");
        assert!(ResultCache::new(60).load_from_file(&dir.join("nope.json")).is_err());

        let bad = dir.join("bad.json");
        fs::write(&bad, "{not json").unwrap();
        assert!(ResultCache::new(60).load_from_file(&bad).is_err());

        let wrong_shape = dir.join("wrong.json");
        fs::write(&wrong_shape, "{\"nope\": 1}").unwrap();
        assert!(ResultCache::new(60).load_from_file(&wrong_shape).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
