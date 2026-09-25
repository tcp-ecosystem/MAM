"""Tests for the result cache module."""

import json
import time

import pytest

from mam.cache import (
    DEFAULT_CACHE_TTL_SECONDS,
    CacheEntry,
    ResultCache,
    create_result_cache,
    format_cache_stats,
    hash_cache_key,
    is_valid_cache_key,
)


class TestBasics:
    def test_set_get_has(self) -> None:
        cache = create_result_cache()
        cache.set("a", "value")
        assert cache.get("a") == "value"
        assert cache.has("a") is True
        assert cache.get("missing") is None
        assert cache.get("missing", "default") == "default"

    def test_overwrites_existing_key(self) -> None:
        cache = create_result_cache()
        cache.set("a", 1)
        cache.set("a", 2)
        assert cache.get("a") == 2
        assert cache.size() == 1

    def test_delete_and_clear(self) -> None:
        cache = create_result_cache()
        cache.set("a", 1)
        cache.set("b", 2)
        assert cache.delete("a") is True
        assert cache.delete("a") is False
        cache.clear()
        assert cache.size() == 0

    def test_len_and_contains(self) -> None:
        cache = create_result_cache()
        cache.set("a", 1)
        assert len(cache) == 1
        assert "a" in cache
        assert "b" not in cache

    def test_iteration_and_keys(self) -> None:
        cache = create_result_cache()
        cache.set("a", 1)
        cache.set("b", 2)
        assert cache.keys() == ["a", "b"]
        assert list(cache) == ["a", "b"]
        assert dict(cache.items()) == {"a": 1, "b": 2}

    def test_rejects_negative_ttl(self) -> None:
        with pytest.raises(ValueError):
            ResultCache(ttl_seconds=-1)


class TestExpiry:
    def test_entries_expire(self) -> None:
        cache = ResultCache(ttl_seconds=0.05)
        cache.set("a", "x")
        assert cache.get("a") == "x"
        time.sleep(0.08)
        assert cache.get("a") is None
        assert cache.stats().evictions == 1

    def test_zero_ttl_never_expires(self) -> None:
        cache = ResultCache(ttl_seconds=0)
        cache.set("a", "x")
        assert cache.remaining_ttl("a") is None
        assert cache.get("a") == "x"

    def test_prune_removes_expired_only(self) -> None:
        cache = ResultCache(ttl_seconds=0.05)
        cache.set("stale", 1, ttl_seconds=0.01)
        cache.set("fresh", 2, ttl_seconds=100)
        time.sleep(0.03)
        assert cache.prune() == 1
        assert cache.has("fresh") is True
        assert cache.has("stale") is False

    def test_remaining_ttl_counts_down(self) -> None:
        cache = ResultCache(ttl_seconds=100)
        cache.set("a", 1)
        assert 0 < cache.remaining_ttl("a") <= 100
        assert cache.remaining_ttl("missing") is None

    def test_per_entry_ttl_override(self) -> None:
        cache = ResultCache(ttl_seconds=100)
        cache.set("a", 1, ttl_seconds=0.01)
        time.sleep(0.03)
        assert cache.get("a") is None


class TestGetOrSet:
    def test_computes_once(self) -> None:
        cache = create_result_cache()
        calls = []

        def factory() -> str:
            calls.append(1)
            return "made"

        assert cache.get_or_set("a", factory) == "made"
        assert cache.get_or_set("a", factory) == "made"
        assert len(calls) == 1

    def test_recomputes_after_expiry(self) -> None:
        cache = ResultCache(ttl_seconds=0.05)
        calls = []

        def factory() -> int:
            calls.append(1)
            return len(calls)

        assert cache.get_or_set("a", factory) == 1
        time.sleep(0.08)
        assert cache.get_or_set("a", factory) == 2


class TestStats:
    def test_hits_and_misses(self) -> None:
        cache = create_result_cache()
        cache.get("missing")
        cache.set("a", 1)
        cache.get("a")
        stats = cache.stats()
        assert stats.hits == 1
        assert stats.misses == 1
        assert stats.lookups == 2
        assert cache.hit_rate() == 0.5

    def test_empty_cache_hit_rate(self) -> None:
        assert create_result_cache().hit_rate() == 0.0

    def test_format_cache_stats(self) -> None:
        cache = create_result_cache()
        cache.get("missing")
        cache.set("a", 1)
        cache.get("a")
        text = format_cache_stats(cache.stats())
        assert "1 entries" in text
        assert "50.0% hit rate" in text
        assert format_cache_stats("junk") == "invalid cache stats"

    def test_format_cache_stats_from_dict(self) -> None:
        text = format_cache_stats({"entries": 2, "hits": 1, "misses": 1, "evictions": 0})
        assert "2 entries" in text


class TestKeyHandling:
    def test_valid_keys(self) -> None:
        assert is_valid_cache_key("ok-key") is True
        assert is_valid_cache_key("  ") is False
        assert is_valid_cache_key("bad\nkey") is False
        assert is_valid_cache_key("") is False
        assert is_valid_cache_key(123) is False

    def test_invalid_keys_raise_on_set(self) -> None:
        with pytest.raises(ValueError):
            create_result_cache().set("  ", 1)

    def test_invalid_keys_return_default_on_get(self) -> None:
        cache = create_result_cache()
        assert cache.get("bad\nkey", "fallback") == "fallback"
        assert cache.has("bad\nkey") is False


class TestHashing:
    def test_hash_is_stable_and_long(self) -> None:
        digest = hash_cache_key(["a", 1])
        assert digest == hash_cache_key(["a", 1])
        assert len(digest) == 64

    def test_different_inputs_differ(self) -> None:
        assert hash_cache_key(["a", 1]) != hash_cache_key(["a", 2])
        assert hash_cache_key("a") != hash_cache_key("b")

    def test_default_ttl_is_five_minutes(self) -> None:
        assert DEFAULT_CACHE_TTL_SECONDS == 300.0


class TestPersistence:
    def test_save_and_load_round_trip(self, tmp_path) -> None:
        path = tmp_path / "cache.json"
        cache = create_result_cache()
        cache.set("a", {"n": 1})
        cache.set("b", [1, 2, 3])
        written = cache.save_to_file(str(path))
        assert written == str(path)

        restored = create_result_cache()
        assert restored.load_from_file(str(path)) == 2
        assert restored.get("a") == {"n": 1}
        assert restored.get("b") == [1, 2, 3]

    def test_load_missing_file_raises(self, tmp_path) -> None:
        with pytest.raises(FileNotFoundError):
            create_result_cache().load_from_file(str(tmp_path / "nope.json"))

    def test_load_invalid_json_raises(self, tmp_path) -> None:
        path = tmp_path / "cache.json"
        path.write_text("{bad", encoding="utf-8")
        with pytest.raises(ValueError):
            create_result_cache().load_from_file(str(path))

    def test_load_wrong_shape_raises(self, tmp_path) -> None:
        path = tmp_path / "cache.json"
        path.write_text(json.dumps({"nope": 1}), encoding="utf-8")
        with pytest.raises(ValueError):
            create_result_cache().load_from_file(str(path))

    def test_entry_round_trip(self) -> None:
        entry = CacheEntry(key="a", value=1, created_at=10.0, expires_at=20.0, hits=3)
        restored = CacheEntry.from_dict(entry.to_dict())
        assert restored.key == "a"
        assert restored.hits == 3
        assert restored.age(now=12.0) == 2.0
