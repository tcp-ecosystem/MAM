package tests

import (
	"testing"
	"time"

	mam "github.com/LifeJiggy/MAM/sdk/go/mam"
)

func TestCacheSetGet(t *testing.T) {
	c := mam.NewResultCache(0)
	c.Set("a", "value")
	got, ok := c.Get("a")
	if !ok || got != "value" {
		t.Errorf("Get() = %v, %v; want value, true", got, ok)
	}
	if c.Size() != 1 {
		t.Errorf("Size() = %d, want 1", c.Size())
	}
}

func TestCacheMissing(t *testing.T) {
	c := mam.NewResultCache(0)
	if _, ok := c.Get("missing"); ok {
		t.Error("expected miss for unknown key")
	}
	if c.Size() != 0 {
		t.Errorf("Size() = %d, want 0", c.Size())
	}
}

func TestCacheExpiry(t *testing.T) {
	c := mam.NewResultCache(time.Nanosecond)
	c.Set("a", "x")
	if _, ok := c.Get("a"); ok {
		t.Error("expected instant expiry with 1ns TTL")
	}
	steady := mam.NewResultCache(0)
	steady.Set("a", "x")
	if _, ok := steady.Get("a"); !ok {
		t.Error("non-positive TTL must disable expiry")
	}
}

func TestCacheDelete(t *testing.T) {
	c := mam.NewResultCache(0)
	c.Set("a", "x")
	if !c.Delete("a") {
		t.Error("Delete() = false, want true")
	}
	if c.Delete("a") {
		t.Error("second Delete() = true, want false")
	}
	if c.Delete("   ") {
		t.Error("blank key Delete() = true, want false")
	}
}

func TestCacheClear(t *testing.T) {
	c := mam.NewResultCache(0)
	c.Set("a", "x")
	c.Set("b", "y")
	c.Clear()
	if c.Size() != 0 {
		t.Errorf("Size() after Clear() = %d, want 0", c.Size())
	}
}

func TestCachePrune(t *testing.T) {
	c := mam.NewResultCache(time.Nanosecond)
	c.Set("a", "x")
	c.Set("b", "y")
	if removed := c.Prune(); removed != 2 {
		t.Errorf("Prune() = %d, want 2", removed)
	}
	if c.Size() != 0 {
		t.Errorf("Size() = %d, want 0", c.Size())
	}
}

func TestCacheStats(t *testing.T) {
	c := mam.NewResultCache(0)
	c.Get("missing")
	c.Set("a", "x")
	c.Get("a")
	stats := c.Stats()
	if stats.Hits != 1 || stats.Misses != 1 {
		t.Errorf("Stats() = %+v, want 1 hit 1 miss", stats)
	}
}

func TestCacheHitRate(t *testing.T) {
	c := mam.NewResultCache(0)
	if c.HitRate() != 0 {
		t.Errorf("fresh HitRate() = %v, want 0", c.HitRate())
	}
	c.Set("a", "x")
	c.Get("a")
	if c.HitRate() != 1 {
		t.Errorf("HitRate() = %v, want 1", c.HitRate())
	}
}

func TestCacheGetOrSet(t *testing.T) {
	c := mam.NewResultCache(0)
	calls := 0
	first := c.GetOrSet("a", func() interface{} { calls++; return "made" })
	second := c.GetOrSet("a", func() interface{} { calls++; return "other" })
	if first != "made" || second != "made" || calls != 1 {
		t.Errorf("GetOrSet() = %v, %v with %d calls; want made, made, 1", first, second, calls)
	}
}

func TestCacheInvalidKeys(t *testing.T) {
	c := mam.NewResultCache(0)
	c.Set("", "x")
	c.Set("  ", "x")
	c.Set("bad\nkey", "x")
	long := make([]byte, 2000)
	for i := range long {
		long[i] = 'k'
	}
	c.Set(string(long), "x")
	if c.Size() != 0 {
		t.Errorf("Size() = %d, want 0 after invalid sets", c.Size())
	}
	if _, ok := c.Get(""); ok {
		t.Error("expected miss for empty key")
	}
}

func TestCacheOverwrite(t *testing.T) {
	c := mam.NewResultCache(0)
	c.Set("a", "1")
	c.Set("a", "2")
	got, ok := c.Get("a")
	if !ok || got != "2" {
		t.Errorf("Get() after overwrite = %v, %v; want 2, true", got, ok)
	}
	if c.Size() != 1 {
		t.Errorf("Size() = %d, want 1", c.Size())
	}
}
