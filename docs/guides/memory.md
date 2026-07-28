# Memory Guide

> **Managing persistent state in MAM modules.**

---

## Overview

MAM modules can maintain state across executions using the Memory section. This guide covers memory management, persistence, and best practices.

---

## Basic Memory

Define memory in the Memory section:

```markdown
## Memory

```yaml
counter: 0
last_run: null
user_preferences:
  theme: dark
  language: en
```
```

---

## Memory Structure

Memory is stored as YAML:

```yaml
# Simple values
counter: 0
last_run: null
debug: false

# Nested objects
user_preferences:
  theme: dark
  language: en
  notifications: true

# Lists
recent_items:
  - item1
  - item2
  - item3

# Complex structures
sessions:
  session-1:
    user: "user123"
    start: "2026-01-15T10:30:00Z"
    active: true
  session-2:
    user: "user456"
    start: "2026-01-15T11:00:00Z"
    active: false
```

---

## Accessing Memory

### In Python

```python
def process_with_memory(data: str, memory: dict) -> dict:
    """Process data and update memory."""
    # Read from memory
    counter = memory.get("counter", 0)
    last_run = memory.get("last_run")
    
    # Process data
    result = data.upper()
    
    # Update memory
    memory["counter"] = counter + 1
    memory["last_run"] = "2026-01-15T12:00:00Z"
    
    # Add to list
    if "recent_items" not in memory:
        memory["recent_items"] = []
    memory["recent_items"].append(result)
    
    # Keep only last 10 items
    memory["recent_items"] = memory["recent_items"][-10:]
    
    return {"result": result, "counter": memory["counter"]}
```

### In JavaScript

```javascript
function processWithMemory(data, memory) {
  // Read from memory
  const counter = memory.counter || 0;
  const lastRun = memory.lastRun;
  
  // Process data
  const result = data.toUpperCase();
  
  // Update memory
  memory.counter = counter + 1;
  memory.lastRun = new Date().toISOString();
  
  // Add to list
  if (!memory.recentItems) {
    memory.recentItems = [];
  }
  memory.recentItems.push(result);
  
  // Keep only last 10 items
  memory.recentItems = memory.recentItems.slice(-10);
  
  return { result, counter: memory.counter };
}
```

---

## Memory Patterns

### Counter Pattern

Track execution count:

```yaml
execution_count: 0
```

```python
def execute(data: str, memory: dict) -> dict:
    memory["execution_count"] = memory.get("execution_count", 0) + 1
    return {"count": memory["execution_count"]}
```

### Cache Pattern

Cache expensive operations:

```yaml
cache: {}
cache_timestamps: {}
```

```python
import time

def get_cached_data(key: str, memory: dict) -> dict:
    """Get data from cache or fetch fresh."""
    cache = memory.get("cache", {})
    timestamps = memory.get("cache_timestamps", {})
    
    # Check cache (valid for 5 minutes)
    if key in cache:
        if time.time() - timestamps.get(key, 0) < 300:
            return cache[key]
    
    # Fetch fresh data
    data = fetch_expensive_data(key)
    
    # Update cache
    cache[key] = data
    timestamps[key] = time.time()
    
    memory["cache"] = cache
    memory["cache_timestamps"] = timestamps
    
    return data
```

### Session Pattern

Track user sessions:

```yaml
sessions: {}
active_sessions: 0
```

```python
import uuid
from datetime import datetime

def start_session(user_id: str, memory: dict) -> str:
    """Start a new session."""
    session_id = str(uuid.uuid4())
    
    memory["sessions"][session_id] = {
        "user_id": user_id,
        "start_time": datetime.now().isoformat(),
        "status": "active"
    }
    
    memory["active_sessions"] = memory.get("active_sessions", 0) + 1
    
    return session_id

def end_session(session_id: str, memory: dict) -> None:
    """End a session."""
    if session_id in memory["sessions"]:
        memory["sessions"][session_id]["status"] = "ended"
        memory["sessions"][session_id]["end_time"] = datetime.now().isoformat()
        memory["active_sessions"] = max(0, memory.get("active_sessions", 0) - 1)
```

### History Pattern

Track history of operations:

```yaml
history: []
max_history: 100
```

```python
def add_to_history(action: str, result: str, memory: dict) -> None:
    """Add action to history."""
    history = memory.get("history", [])
    max_history = memory.get("max_history", 100)
    
    history.append({
        "action": action,
        "result": result,
        "timestamp": datetime.now().isoformat()
    })
    
    # Keep only last N entries
    memory["history"] = history[-max_history:]
```

---

## Memory Best Practices

### 1. Initialize Defaults

```python
def process(data: str, memory: dict) -> dict:
    # Initialize defaults if not present
    memory.setdefault("counter", 0)
    memory.setdefault("history", [])
    memory.setdefault("cache", {})
    
    # Use memory
    memory["counter"] += 1
    memory["history"].append(data)
    
    return {"counter": memory["counter"]}
```

### 2. Limit Memory Size

```python
def add_item(item: str, memory: dict, max_items: int = 1000) -> None:
    """Add item with size limit."""
    items = memory.get("items", [])
    items.append(item)
    
    # Keep only last N items
    memory["items"] = items[-max_items:]
```

### 3. Use Timestamps

```python
def update_with_timestamp(key: str, value: any, memory: dict) -> None:
    """Update value with timestamp."""
    memory[key] = value
    memory[f"{key}_updated"] = datetime.now().isoformat()
```

### 4. Validate Before Access

```python
def safe_get(key: str, memory: dict, default=None):
    """Safely get value from memory."""
    return memory.get(key, default)
```

### 5. Clean Up Old Data

```python
def cleanup_old_sessions(memory: dict, max_age_hours: int = 24) -> None:
    """Clean up old sessions."""
    sessions = memory.get("sessions", {})
    cutoff = datetime.now() - timedelta(hours=max_age_hours)
    
    old_sessions = [
        sid for sid, session in sessions.items()
        if datetime.fromisoformat(session["start_time"]) < cutoff
    ]
    
    for sid in old_sessions:
        del sessions[sid]
    
    memory["sessions"] = sessions
```

---

## Memory Persistence

Memory is persisted between runs:

```
.mam/
├── memory/
│   ├── <module-id>/
│   │   ├── state.json
│   │   └── cache/
```

---

## Memory Limits

| Limit | Default | Description |
|-------|---------|-------------|
| Max size | 1MB | Maximum memory size |
| Max keys | 1000 | Maximum number of keys |
| Max depth | 10 | Maximum nesting depth |

---

## References

- [Writing Modules](./writing-modules.md)
- [Specification](../specification/sections.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
