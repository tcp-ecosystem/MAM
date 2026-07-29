# Memory Section

## Description
The Memory section defines persistent state and knowledge for the module. It specifies what data the module remembers across executions, how state is structured, and how it persists. This section is critical for modules that maintain user sessions, caches, counters, or any data that survives between invocations.

The Memory section serves as:
- **State declaration**: Defines what state the module maintains
- **Persistence contract**: Specifies how state is stored and retrieved
- **Knowledge base**: Documents what the module "knows"
- **Cache definition**: Defines caching strategies and data
- **Session management**: Specifies session storage requirements

## Syntax

```markdown
## Memory

- **key**: value
- **state**: idle
- **counter**: 0

```json
{
  "preferences": {},
  "history": []
}
```
```

### Memory Entry Format

Each memory entry follows the format:

```
- **key**: value
```

Or for structured data:

```markdown
- **key**: Description of what this stores

```json
{
  "nested": "data"
}
```
```

### Memory Types

| Type | Example | Description |
|------|---------|-------------|
| Primitive | `- **count**: 0` | Simple values |
| String | `- **name**: "default"` | Text values |
| Boolean | `- **active**: true` | True/false |
| Object | `- **config**: {}` | JSON objects |
| Array | `- **history**: []` | Lists |
| Null | `- **temp**: null` | Empty/unset |

## Rules

1. **Bold key format**: Must use `**key**` format for entries
2. **Clear descriptions**: Each entry must have a description
3. **Type consistency**: Values must be consistent types
4. **No secrets**: Never store secrets in memory
5. **Size limits**: Document size limits for collections
6. **Expiration**: Document TTL for temporary data
7. **Thread safety**: Document concurrent access patterns

### Naming Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| snake_case | `user_count` | `userCount`, `user-count` |
| Descriptive | `login_attempts` | `la`, `x` |
| No reserved words | `data` | `class`, `def` |
| Max 64 chars | - | - |

### Value Rules

- Primitives must be valid literals
- Objects must be valid JSON
- Arrays must have consistent element types
- Null values should have documentation
- Default values should be documented

## Description

The Memory section defines module state:

### 1. Simple State

Basic module state:

```markdown
## Memory

- **state**: idle  # Current module state
- **count**: 0  # Operation counter
- **last_run**: null  # Last execution timestamp
```

### 2. User Session

User session data:

```markdown
## Memory

- **session_id**: null  # Current session ID
- **user_id**: null  # Authenticated user ID
- **permissions**: []  # User permissions
- **preferences**: {}  # User preferences

```json
{
  "theme": "dark",
  "language": "en",
  "notifications": true
}
```
```

### 3. Cache Data

Cached information:

```markdown
## Memory

- **cache**: {}  # Response cache
- **cache_ttl**: 300  # Cache TTL in seconds
- **cache_hits**: 0  # Cache hit counter
- **cache_misses**: 0  # Cache miss counter

```json
{
  "api_users": {
    "data": [],
    "timestamp": 0,
    "ttl": 300
  }
}
```
```

### 4. Application Counters

Usage counters and metrics:

```markdown
## Memory

- **request_count**: 0  # Total requests processed
- **error_count**: 0  # Total errors encountered
- **success_count**: 0  # Successful operations
- **avg_response_time**: 0.0  # Average response time

```json
{
  "hourly_stats": {
    "2026-07-24T10": {"requests": 0, "errors": 0},
    "2026-07-24T11": {"requests": 0, "errors": 0}
  }
}
```
```

### 5. Configuration State

Runtime configuration:

```markdown
## Memory

- **config_version**: 1  # Configuration version
- **config_loaded**: false  # Config load status
- **runtime_config**: {}  # Runtime configuration

```json
{
  "database": {
    "host": "localhost",
    "port": 5432,
    "pool_size": 5
  },
  "cache": {
    "backend": "redis",
    "ttl": 3600
  }
}
```
```

### 6. Processing State

State for ongoing operations:

```markdown
## Memory

- **processing**: false  # Currently processing
- **queue**: []  # Pending items
- **current_item**: null  # Current item being processed
- **progress**: 0  # Processing progress (0-100)

```json
{
  "batch": {
    "id": "batch_123",
    "total": 100,
    "processed": 0,
    "failed": 0
  }
}
```
```

### 7. Historical Data

Historical records:

```markdown
## Memory

- **history**: []  # Operation history
- **max_history**: 1000  # Maximum history entries
- **last_cleanup**: null  # Last cleanup timestamp

```json
{
  "operations": [
    {
      "id": "op_001",
      "type": "process",
      "timestamp": "2026-07-24T10:00:00Z",
      "status": "success"
    }
  ]
}
```
```

### 8. Error State

Error tracking:

```markdown
## Memory

- **errors**: []  # Recent errors
- **max_errors**: 100  # Maximum error entries
- **last_error**: null  # Last error message
- **error_rate**: 0.0  # Error rate (0-1)

```json
{
  "recent_errors": [
    {
      "message": "Connection timeout",
      "timestamp": "2026-07-24T10:00:00Z",
      "count": 5
    }
  ]
}
```
```

## Examples

### Authentication Module

```markdown
## Memory

- **sessions**: {}  # Active user sessions
- **session_ttl**: 3600  # Session TTL in seconds
- **max_sessions**: 1000  # Maximum concurrent sessions
- **failed_attempts**: {}  # Failed login attempts
- **lockout_duration**: 900  # Account lockout duration (15 minutes)

```json
{
  "sessions": {
    "sess_abc123": {
      "user_id": "user_123",
      "created_at": "2026-07-24T10:00:00Z",
      "expires_at": "2026-07-24T11:00:00Z",
      "ip": "192.168.1.1",
      "user_agent": "Mozilla/5.0..."
    }
  },
  "failed_attempts": {
    "user_123": {
      "count": 0,
      "last_attempt": null,
      "locked_until": null
    }
  }
}
```
```

### API Cache

```markdown
## Memory

- **cache**: {}  # API response cache
- **cache_config**: {}  # Cache configuration
- **stats**: {}  # Cache statistics

```json
{
  "cache": {
    "users": {
      "data": [],
      "timestamp": 1690000000,
      "ttl": 300,
      "hits": 0,
      "misses": 0
    },
    "products": {
      "data": [],
      "timestamp": 1690000000,
      "ttl": 600,
      "hits": 0,
      "misses": 0
    }
  },
  "stats": {
    "total_hits": 0,
    "total_misses": 0,
    "hit_rate": 0.0,
    "memory_usage": 0
  }
}
```
```

### Task Queue

```markdown
## Memory

- **queue**: []  # Task queue
- **processing**: false  # Processing status
- **current_task**: null  # Current task
- **completed**: []  # Completed tasks
- **failed**: []  # Failed tasks

```json
{
  "queue": [
    {
      "id": "task_001",
      "type": "email",
      "data": {"to": "user@example.com"},
      "priority": 1,
      "created_at": "2026-07-24T10:00:00Z"
    }
  ],
  "stats": {
    "total_processed": 0,
    "total_failed": 0,
    "avg_processing_time": 0
  }
}
```
```

### Rate Limiter

```markdown
## Memory

- **buckets**: {}  # Rate limit buckets
- **window_size**: 60  # Time window in seconds
- **max_requests**: 100  # Maximum requests per window

```json
{
  "buckets": {
    "user_123": {
      "count": 0,
      "window_start": 1690000000,
      "remaining": 100
    },
    "ip_192.168.1.1": {
      "count": 0,
      "window_start": 1690000000,
      "remaining": 100
    }
  }
}
```
```

### Web Scraper

```markdown
## Memory

- **visited_urls**: []  # Already visited URLs
- **url_queue**: []  # URLs to visit
- **scraped_data**: []  # Scraped data
- **rate_limit**: {}  # Rate limiting per domain

```json
{
  "visited_urls": [
    "https://example.com",
    "https://example.com/page1"
  ],
  "rate_limit": {
    "example.com": {
      "last_request": 1690000000,
      "request_count": 5
    }
  },
  "stats": {
    "total_scraped": 0,
    "total_errors": 0,
    "avg_response_time": 0
  }
}
```
```

### Chat Bot

```markdown
## Memory

- **conversations**: {}  # Active conversations
- **user_profiles**: {}  # User profile data
- **context_window**: 10  # Context window size

```json
{
  "conversations": {
    "conv_123": {
      "user_id": "user_123",
      "messages": [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"}
      ],
      "started_at": "2026-07-24T10:00:00Z",
      "last_message_at": "2026-07-24T10:05:00Z"
    }
  },
  "user_profiles": {
    "user_123": {
      "name": "John",
      "preferences": {"language": "en"},
      "message_count": 0
    }
  }
}
```
```

### Machine Learning

```markdown
## Memory

- **model_state**: {}  # Model training state
- **training_data**: []  # Training data buffer
- **metrics**: {}  # Training metrics

```json
{
  "model_state": {
    "version": 1,
    "trained_at": null,
    "accuracy": 0.0,
    "loss": 0.0
  },
  "training_data": [],
  "metrics": {
    "epochs": 0,
    "batch_size": 32,
    "learning_rate": 0.001,
    "history": []
  }
}
```
```

## Edge Cases

### 1. Memory Overflow

When memory grows too large:

```markdown
## Memory

- **data**: []  # Unbounded growth - BAD!
- **max_size**: 1000  # Size limit

# Better
- **data**: []  # Bounded collection
- **max_size**: 1000  # Maximum entries
- **overflow_strategy**: "oldest"  # Remove oldest when full
```

### 2. Concurrent Access

When multiple processes access memory:

```markdown
## Memory

- **counter**: 0  # Not thread-safe!

# Better
- **counter**: 0  # Atomic counter
- **lock**: false  # Access lock
- **atomic**: true  # Use atomic operations
```

### 3. Stale Data

When cached data becomes stale:

```markdown
## Memory

- **cache**: {}  # No TTL - stale data!

# Better
- **cache**: {}  # Cached data
- **cache_ttl**: 300  # TTL in seconds
- **cache_timestamps**: {}  # When data was cached
```

### 4. Schema Evolution

When data structure changes:

```markdown
## Memory

# v1.0
- **data**: {}  # Old format

# v2.0
- **data**: {}  # New format
- **data_version**: 2  # Schema version
- **migration_complete**: false  # Migration status
```

### 5. Serialization Issues

When data can't be serialized:

```markdown
## Memory

- **data**: {}  # May contain non-serializable data!

# Better
- **data**: {}  # Only serializable data
- **serialization_format**: "json"  # Serialization format
```

### 6. Missing Initialization

When memory isn't properly initialized:

```markdown
## Memory

- **count**: null  # Not initialized!

# Better
- **count**: 0  # Initialized with default
- **initialized**: false  # Initialization status
```

### 7. Inconsistent State

When memory is partially updated:

```markdown
## Memory

- **state**: {}  # Complex state

# Better with transactions
- **pending_changes**: {}  # Changes not yet applied
- **committed**: false  # Transaction status
```

### 8. Memory Leaks

When references aren't released:

```markdown
## Memory

- **objects**: []  # May leak references!

# Better
- **objects**: []  # Weak references or bounded
- **weak_refs**: true  # Use weak references
- **max_objects**: 1000  # Limit collection size
```

### 9. Thread Safety

When using in multi-threaded environment:

```markdown
## Memory

- **shared_data**: {}  # Not thread-safe!

# Better
- **shared_data**: {}  # Thread-safe data
- **lock**: false  # Access lock
- **atomic_operations**: true  # Use atomic ops
```

### 10. Persistence Failure

When persistence fails:

```markdown
## Memory

- **data**: {}  # In-memory only!

# Better
- **data**: {}  # Data to persist
- **persist**: true  # Enable persistence
- **fallback_memory**: true  # Use memory if persistence fails
```

## Best Practices

### 1. Document All Entries

Every memory entry must have a description:

```markdown
# Bad
- **data**: {}

# Good
- **data**: {}  # Cached API responses
```

### 2. Set Size Limits

Always set limits for collections:

```markdown
## Memory

- **history**: []  # Operation history
- **max_history**: 1000  # Maximum entries
```

### 3. Document TTLs

Document time-to-live for temporary data:

```markdown
## Memory

- **cache**: {}  # Cached data
- **cache_ttl**: 300  # TTL in seconds
```

### 4. Use Consistent Naming

Use snake_case for all keys:

```markdown
# Bad
- **userCount**: 0
- **userId**: null

# Good
- **user_count**: 0
- **user_id**: null
```

### 5. Initialize Defaults

Always initialize with sensible defaults:

```markdown
## Memory

- **count**: 0  # Default to 0
- **enabled**: true  # Default to true
- **config**: {}  # Default to empty object
```

### 6. Document Data Structures

Use JSON blocks for complex data:

```markdown
## Memory

- **config**: {}  # Configuration object

```json
{
  "database": {
    "host": "localhost",
    "port": 5432
  }
}
```
```

### 7. Separate Concerns

Group related memory entries:

```markdown
## Memory

# Session state
- **session_id**: null
- **user_id**: null

# Cache
- **cache**: {}
- **cache_ttl**: 300

# Statistics
- **request_count**: 0
- **error_count**: 0
```

### 8. Document Access Patterns

Document how memory is accessed:

```markdown
## Memory

- **counter**: 0  # Atomic increment only
- **flag**: false  # Set once, read many
```

### 9. Handle Edge Cases

Document edge case handling:

```markdown
## Memory

- **queue**: []  # Task queue
- **max_queue_size**: 1000  # Reject when full
- **overflow_strategy**: "drop_oldest"  # What to do when full
```

### 10. Version Your Schema

Use version numbers for schema changes:

```markdown
## Memory

- **schema_version**: 2  # Schema version
- **data**: {}  # Data following schema v2
```

## Common Patterns

### Pattern 1: Simple Cache

```markdown
## Memory

- **cache**: {}  # Key-value cache
- **cache_ttl**: 300  # TTL in seconds
- **cache_timestamps**: {}  # When entries were cached

```json
{
  "cache": {},
  "cache_timestamps": {},
  "stats": {
    "hits": 0,
    "misses": 0
  }
}
```
```

### Pattern 2: Session Storage

```markdown
## Memory

- **sessions**: {}  # Active sessions
- **session_config**: {}  # Session configuration

```json
{
  "sessions": {},
  "config": {
    "ttl": 3600,
    "max_per_user": 5,
    "rotate_on_login": true
  }
}
```
```

### Pattern 3: Rate Limiter

```markdown
## Memory

- **buckets**: {}  # Rate limit buckets
- **window_config**: {}  # Window configuration

```json
{
  "buckets": {},
  "config": {
    "window_size": 60,
    "max_requests": 100,
    "strategy": "sliding_window"
  }
}
```
```

### Pattern 4: Task Queue

```markdown
## Memory

- **queue**: []  # Pending tasks
- **processing**: {}  # Currently processing
- **completed**: []  # Completed tasks
- **failed**: []  # Failed tasks

```json
{
  "queue": [],
  "processing": {},
  "completed": [],
  "failed": [],
  "stats": {
    "total_processed": 0,
    "total_failed": 0
  }
}
```
```

### Pattern 5: User Preferences

```markdown
## Memory

- **user_preferences**: {}  # Per-user preferences
- **default_preferences**: {}  # Default preferences

```json
{
  "default_preferences": {
    "theme": "light",
    "language": "en",
    "notifications": true
  },
  "user_preferences": {}
}
```
```

### Pattern 6: Application State

```markdown
## Memory

- **app_state**: {}  # Application state
- **state_history**: []  # State change history

```json
{
  "app_state": {
    "status": "running",
    "started_at": null,
    "uptime": 0
  },
  "state_history": []
}
```
```

### Pattern 7: Metrics Collection

```markdown
## Memory

- **metrics**: {}  # Collected metrics
- **metrics_config**: {}  # Metrics configuration

```json
{
  "metrics": {
    "request_count": 0,
    "error_count": 0,
    "response_times": []
  },
  "config": {
    "retention_period": 86400,
    "aggregation_interval": 300
  }
}
```
```

### Pattern 8: Feature Flags

```markdown
## Memory

- **feature_flags**: {}  # Feature flag states
- **flag_overrides**: {}  # Manual overrides

```json
{
  "feature_flags": {
    "new_ui": true,
    "beta_features": false,
    "maintenance_mode": false
  },
  "overrides": {}
}
```
```

### Pattern 9: Audit Log

```markdown
## Memory

- **audit_log**: []  # Audit trail
- **max_log_entries**: 10000  # Maximum entries

```json
{
  "audit_log": [],
  "config": {
    "retention_days": 90,
    "log_level": "info"
  }
}
```
```

### Pattern 10: Multi-tenant State

```markdown
## Memory

- **tenant_data**: {}  # Per-tenant data
- **tenant_config**: {}  # Tenant configuration

```json
{
  "tenant_data": {
    "tenant_1": {
      "quota": 1000,
      "used": 0,
      "settings": {}
    }
  },
  "config": {
    "isolation_level": "strict",
    "max_tenants": 100
  }
}
```
```

## Validation Rules

### Rule 1: Valid Key Format

Keys must follow naming rules:

```python
import re

def validate_key(key: str) -> bool:
    pattern = r'^[a-z][a-z0-9_]{0,63}$'
    return bool(re.match(pattern, key))
```

### Rule 2: No Secrets

Memory must not contain secrets:

```python
def check_secrets(data: dict) -> list[str]:
    secrets = []
    secret_patterns = ['password', 'secret', 'token', 'key', 'credential']
    
    for key in data.keys():
        if any(pattern in key.lower() for pattern in secret_patterns):
            secrets.append(key)
    
    return secrets
```

### Rule 3: Valid JSON

Structured data must be valid JSON:

```python
import json

def validate_json(data: str) -> bool:
    try:
        json.loads(data)
        return True
    except json.JSONDecodeError:
        return False
```

### Rule 4: Size Limits

Collections must respect size limits:

```python
def validate_size(data: list, max_size: int) -> bool:
    return len(data) <= max_size
```

### Rule 5: Type Consistency

Values must be consistent types:

```python
def validate_type_consistency(data: list) -> bool:
    if not data:
        return True
    
    first_type = type(data[0])
    return all(isinstance(item, first_type) for item in data)
```

### Rule 6: Required Fields

Required fields must be present:

```python
def validate_required_fields(data: dict, required: list[str]) -> bool:
    return all(field in data for field in required)
```

### Rule 7: Valid Defaults

Default values must be valid:

```python
def validate_default(value: any, expected_type: type) -> bool:
    return isinstance(value, expected_type)
```

### Rule 8: No Circular References

Data must not have circular references:

```python
def check_circular_refs(data: dict, seen: set = None) -> bool:
    if seen is None:
        seen = set()
    
    for key, value in data.items():
        if isinstance(value, dict):
            if id(value) in seen:
                return False
            seen.add(id(value))
            if not check_circular_refs(value, seen):
                return False
    
    return True
```

## Related Sections

- **[Memory](memory.md)**: Persistent state definition
- **[Inputs](inputs.md)**: Input parameters
- **[Outputs](outputs.md)**: Output values
- **[Tests](tests.md)**: Memory tests
- **[Python](python.md)**: Python implementation
- **[JavaScript](javascript.md)**: JavaScript implementation

## FAQ

### Q: What's the difference between Memory and Variables?

**A:** Memory persists across executions. Variables are temporary and lost between runs.

### Q: How do I handle concurrent access?

**A:** Use locks or atomic operations:

```markdown
## Memory

- **counter**: 0  # Use atomic operations
- **lock**: false  # Access lock
```

### Q: Should I store secrets in Memory?

**A:** Never store secrets in Memory. Use environment variables or secure vaults.

### Q: How do I handle large data?

**A:** Set size limits and document overflow behavior:

```markdown
## Memory

- **data**: []
- **max_size**: 1000
- **overflow_strategy**: "drop_oldest"
```

### Q: How do I version my memory schema?

**A:** Use a version field:

```markdown
## Memory

- **schema_version**: 2
- **data**: {}
```

### Q: Can I use nested objects?

**A:** Yes, document the structure:

```markdown
## Memory

- **config**: {}

```json
{
  "database": {
    "host": "localhost",
    "port": 5432
  }
}
```
```

### Q: How do I handle TTL?

**A:** Document TTL and timestamps:

```markdown
## Memory

- **cache**: {}
- **cache_ttl**: 300
- **cache_timestamps**: {}
```

### Q: Can I share memory between modules?

**A:** Not directly. Use external storage or message passing.

### Q: How do I initialize memory?

**A:** Set sensible defaults:

```markdown
## Memory

- **count**: 0  # Default to 0
- **enabled**: true  # Default to true
```

### Q: How do I handle memory limits?

**A:** Set limits and document behavior:

```markdown
## Memory

- **data**: []
- **max_size**: 1000
- **overflow_strategy**: "reject"
```

### Q: Can I use weak references?

**A:** Yes, for caching:

```markdown
## Memory

- **cache**: {}  # Weak references
- **weak_refs**: true
```

### Q: How do I handle persistence?

**A:** Document persistence requirements:

```markdown
## Memory

- **data**: {}
- **persist**: true
- **storage**: "redis"
```

### Q: Can I use memory for logging?

**A:** Yes, with size limits:

```markdown
## Memory

- **logs**: []
- **max_logs**: 1000
- **log_level**: "info"
```

### Q: How do I handle memory migration?

**A:** Use version numbers and migration logic.

### Q: Can I use memory for feature flags?

**A:** Yes:

```markdown
## Memory

- **feature_flags**: {}

```json
{
  "new_ui": true,
  "beta": false
}
```
```

### Q: How do I handle multi-tenancy?

**A:** Use tenant-scoped keys:

```markdown
## Memory

- **tenant_data**: {}

```json
{
  "tenant_1": {},
  "tenant_2": {}
}
```
```

### Q: Can I use memory for session management?

**A:** Yes, with proper TTL and cleanup.

### Q: How do I audit memory changes?

**A:** Keep an audit log:

```markdown
## Memory

- **audit_log**: []
- **max_audit_entries**: 10000
```

### Q: Can I use memory for metrics?

**A:** Yes:

```markdown
## Memory

- **metrics**: {}

```json
{
  "request_count": 0,
  "error_count": 0
}
```
```

### Q: How do I handle memory cleanup?

**A:** Document cleanup policies:

```markdown
## Memory

- **data**: []
- **cleanup_interval**: 3600
- **retention_period**: 86400
```

## Implementation Notes

### Memory Extraction

```python
def extract_memory(content: str) -> dict:
    memory = {}
    in_json = False
    json_data = {}
    
    for line in content.split('\n'):
        if line.strip().startswith('- **'):
            # Extract key-value pair
            key = line.split('**')[1]
            value = line.split(': **')[1].split('**')[0] if ': **' in line else ''
            memory[key] = value
        elif line.strip().startswith('```json'):
            in_json = True
        elif line.strip() == '```' and in_json:
            in_json = False
        elif in_json:
            # Accumulate JSON
            pass
    
    return memory
```

### Memory Validation

```python
def validate_memory(memory: dict) -> list[str]:
    errors = []
    
    for key, value in memory.items():
        # Validate key format
        if not validate_key(key):
            errors.append(f"Invalid key format: {key}")
        
        # Check for secrets
        if any(secret in key.lower() for secret in ['password', 'secret', 'token']):
            errors.append(f"Potential secret in memory: {key}")
    
    return errors
```

### Memory Documentation Generator

```python
def document_memory(memory: dict) -> str:
    docs = "# Memory\n\n"
    
    for key, value in memory.items():
        docs += f"- **{key}**: {value}\n"
    
    return docs
```

## References

- [MAM Specification - Memory](../SPEC.md#memory)
- [State Management Patterns](https://en.wikipedia.org/wiki/State_management)
- [Caching Strategies](https://aws.amazon.com/caching/strategies/)
- [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable