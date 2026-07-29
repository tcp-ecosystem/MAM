# Capabilities Section

## Description
The Capabilities section declares system capabilities required by the module. It serves as a manifest of runtime features, hardware requirements, and environmental conditions that the module needs to function correctly. This section is critical for deployment planning, resource allocation, and ensuring compatibility across different execution environments.

Capabilities are declarative requirements that the MAM runtime must satisfy before executing the module. They enable automatic resource provisioning, environment validation, and capability-based access control. Unlike Permissions (which declare security grants), Capabilities declare functional prerequisites.

## Syntax

```markdown
## Capabilities

- Capability1
- Capability2
- Capability3
```

The Capabilities section uses a standard Markdown unordered list format. Each list item represents a single capability requirement. Capabilities are case-insensitive strings that follow the naming convention established in the MAM specification.

### Capability Format

Capabilities follow a structured naming pattern:

```
<category>:<specific-capability>
```

Categories include:
- `runtime` - Language runtime requirements
- `network` - Network access capabilities
- `storage` - Storage and persistence capabilities
- `compute` - Computational resource requirements
- `security` - Security-related capabilities
- `integration` - External service integrations
- `hardware` - Hardware-specific requirements

### Multi-line Capabilities

For complex capabilities, use a nested list:

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `json` - JSON parsing
  - `asyncio` - Async support
  - `typing` - Type hints
- network:https
- storage:sqlite:3.35+
```

## Rules

1. **Must be present**: If the module requires specific capabilities, this section must be included
2. **Case-insensitive**: Capability names are case-insensitive
3. **No duplicates**: Each capability should be listed only once
4. **Specificity**: More specific capabilities should be listed before general ones
5. **Version constraints**: Use semver-compatible version constraints where applicable
6. **Optional marking**: Use `(optional)` suffix for capabilities that enhance but aren't required

### Capability Naming Rules

| Rule | Example | Description |
|------|---------|-------------|
| Lowercase | `network:https` | All capability names must be lowercase |
| Colon-separated | `runtime:python` | Use colons to separate category from specific |
| No spaces | `storage:sqlite` | Capability names cannot contain spaces |
| Alphanumeric + hyphens | `integration:rest-api` | Only alphanumeric and hyphens allowed |
| Max 128 chars | - | Maximum capability name length |

### Version Constraint Syntax

```
capability:version>=1.0.0
capability:version==1.0.0
capability:version~=1.0
capability:version>=1.0,<2.0
```

## Description

The Capabilities section provides a machine-readable declaration of what the module needs from its execution environment. This enables:

1. **Automatic validation**: The runtime can verify all capabilities are met before execution
2. **Resource provisioning**: Cloud environments can automatically allocate required resources
3. **Capability-based security**: Modules only receive the capabilities they declare
4. **Dependency resolution**: The system can determine if a module can run in a given environment
5. **Documentation**: Humans can quickly understand module requirements

### Capability Categories

#### Runtime Capabilities

Runtime capabilities declare language and runtime requirements:

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:venv
- runtime:python:pip
```

Common runtime capabilities:
- `runtime:python:3.10+` - Python 3.10 or higher
- `runtime:python:3.11+` - Python 3.11 or higher
- `runtime:python:venv` - Virtual environment support
- `runtime:python:pip` - pip package manager
- `runtime:javascript:20+` - Node.js 20 or higher
- `runtime:typescript:5+` - TypeScript 5 or higher
- `runtime:rust:1.70+` - Rust 1.70 or higher
- `runtime:go:1.21+` - Go 1.21 or higher

#### Network Capabilities

Network capabilities declare internet and network access requirements:

```markdown
## Capabilities

- network:https
- network:dns
- network:websocket
- network:ipv4
```

Common network capabilities:
- `network:http` - HTTP/HTTPS access
- `network:https` - HTTPS-only access
- `network:dns` - DNS resolution
- `network:websocket` - WebSocket connections
- `network:ipv4` - IPv4 connectivity
- `network:ipv6` - IPv6 connectivity
- `network:multicast` - Multicast support

#### Storage Capabilities

Storage capabilities declare persistence and storage requirements:

```markdown
## Capabilities

- storage:sqlite:3.35+
- storage:filesystem:read
- storage:filesystem:write
- storage:redis
```

Common storage capabilities:
- `storage:sqlite` - SQLite database access
- `storage:sqlite:3.35+` - SQLite 3.35 or higher
- `storage:filesystem:read` - Filesystem read access
- `storage:filesystem:write` - Filesystem write access
- `storage:redis` - Redis cache access
- `storage:postgresql` - PostgreSQL access
- `storage:mongodb` - MongoDB access

#### Compute Capabilities

Compute capabilities declare computational resource requirements:

```markdown
## Capabilities

- compute:cpu:2cores
- compute:memory:512MB
- compute:gpu:cuda
- compute:timeout:30s
```

Common compute capabilities:
- `compute:cpu:1core` - At least 1 CPU core
- `compute:cpu:2cores` - At least 2 CPU cores
- `compute:cpu:4cores` - At least 4 CPU cores
- `compute:memory:256MB` - At least 256MB RAM
- `compute:memory:512MB` - At least 512MB RAM
- `compute:memory:1GB` - At least 1GB RAM
- `compute:gpu` - GPU support required
- `compute:gpu:cuda` - NVIDIA CUDA GPU
- `compute:gpu:rocm` - AMD ROCm GPU
- `compute:timeout:30s` - 30-second execution timeout

#### Security Capabilities

Security capabilities declare security-related requirements:

```markdown
## Capabilities

- security:tls:1.2+
- security:certificate-validation
- security:sandbox
```

Common security capabilities:
- `security:tls:1.2+` - TLS 1.2 or higher
- `security:tls:1.3` - TLS 1.3
- `security:certificate-validation` - Certificate validation required
- `security:sandbox` - Sandboxed execution
- `security:encryption:aes256` - AES-256 encryption support

#### Integration Capabilities

Integration capabilities declare external service requirements:

```markdown
## Capabilities

- integration:rest-api
- integration:graphql
- integration:grpc
- integration:mqtt
```

Common integration capabilities:
- `integration:rest-api` - REST API integration
- `integration:graphql` - GraphQL integration
- `integration:grpc` - gRPC integration
- `integration:mqtt` - MQTT messaging
- `integration:kafka` - Apache Kafka
- `integration:rabbitmq` - RabbitMQ

#### Hardware Capabilities

Hardware capabilities declare specific hardware requirements:

```markdown
## Capabilities

- hardware:arm64
- hardware:x86_64
- hardware:gpu:nvidia
- hardware:tpu
```

## Examples

### Basic Module

```markdown
## Capabilities

- runtime:python:3.10+
- network:https
- storage:sqlite
```

### Complex Module

```markdown
## Capabilities

- runtime:python:3.11+
- runtime:python:venv
- runtime:python:modules
  - `fastapi` - Web framework
  - `sqlalchemy` - ORM
  - `pydantic` - Data validation
- network:https
- network:websocket
- storage:postgresql:14+
- storage:redis:7+
- compute:cpu:2cores
- compute:memory:1GB
- compute:timeout:60s
- security:tls:1.2+
- integration:rest-api
```

### Minimal Module

```markdown
## Capabilities

- runtime:python:3.10+
```

### GPU Module

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `torch` - PyTorch
  - `transformers` - Hugging Face
- compute:gpu:cuda:11.8+
- compute:memory:16GB
- compute:timeout:300s
- storage:filesystem:write
```

### IoT Module

```markdown
## Capabilities

- runtime:python:3.10+
- hardware:arm64
- hardware:gpio
- network:mqtt
- compute:memory:64MB
- compute:timeout:10s
- security:tls:1.2+
```

### Web Scraping Module

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `requests` - HTTP client
  - `beautifulsoup4` - HTML parsing
- network:http
- network:dns
- storage:filesystem:write
- compute:timeout:120s
- security:certificate-validation
```

### Data Processing Module

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `pandas` - Data manipulation
  - `numpy` - Numerical computing
  - `scikit-learn` - Machine learning
- compute:cpu:4cores
- compute:memory:8GB
- storage:filesystem:read
- storage:filesystem:write
- integration:parquet
- integration:csv
```

## Edge Cases

### 1. Empty Capabilities

If a module has no specific capability requirements:

```markdown
## Capabilities

- none
```

Or omit the section entirely.

### 2. Conflicting Capabilities

When capabilities conflict (e.g., `network:http` and `network:none`), the runtime must reject the module:

```markdown
## Capabilities

- network:http
- network:none  # CONFLICT - module will be rejected
```

### 3. Version Conflicts

When a module requires incompatible versions:

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:3.9+  # Conflict if only 3.9 is available
```

### 4. Optional vs Required

Use `(optional)` for capabilities that enhance but aren't required:

```markdown
## Capabilities

- runtime:python:3.10+
- compute:gpu:cuda (optional)  # Enhances but not required
- storage:redis (optional)  # Caching layer
```

### 5. Platform-Specific Capabilities

Use conditional capabilities for platform-specific requirements:

```markdown
## Capabilities

- runtime:python:3.10+
- hardware:x86_64 (optional, windows)
- hardware:arm64 (optional, linux)
```

### 6. Deprecated Capabilities

When capabilities are deprecated, use `(deprecated)`:

```markdown
## Capabilities

- runtime:python:3.8+ (deprecated)
- runtime:python:3.10+ (recommended)
```

### 7. Complex Version Constraints

Use complex version constraints for precise requirements:

```markdown
## Capabilities

- runtime:python:>=3.10,<4.0
- storage:sqlite:>=3.35,<4.0
- network:tls:>=1.2
```

## Best Practices

### 1. Be Specific

Always specify exact version requirements:

```markdown
# Bad
- runtime:python

# Good
- runtime:python:3.10+
```

### 2. Use Hierarchical Naming

Use colon-separated hierarchical names:

```markdown
# Bad
- python310

# Good
- runtime:python:3.10+
```

### 3. List Critical Capabilities First

Order capabilities by importance:

```markdown
## Capabilities

- runtime:python:3.10+  # Critical
- network:https  # Important
- storage:redis (optional)  # Nice to have
```

### 4. Document Non-Obvious Capabilities

Add comments for non-obvious capabilities:

```markdown
## Capabilities

- compute:gpu:cuda  # Required for model inference
- security:tls:1.2+  # Required for API authentication
```

### 5. Use Consistent Naming

Follow the naming conventions consistently:

```markdown
# Good
- runtime:python:3.10+
- network:https
- storage:sqlite

# Bad
- Python 3.10+
- Network Access
- SQLite Database
```

### 6. Separate Required from Optional

Clearly distinguish required and optional capabilities:

```markdown
## Capabilities

# Required
- runtime:python:3.10+
- network:https

# Optional
- storage:redis (optional)
- compute:gpu (optional)
```

### 7. Validate Capability Names

Before publishing, validate capability names against the MAM capability registry.

### 8. Document Capabilities in Purpose

Reference capabilities in the Purpose section for clarity:

```markdown
## Purpose

This module requires Python 3.10+, network access, and SQLite storage.

## Capabilities

- runtime:python:3.10+
- network:https
- storage:sqlite
```

## Common Patterns

### Pattern 1: Web Service

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `fastapi`
  - `uvicorn`
  - `pydantic`
- network:http
- network:websocket
- storage:redis
- compute:cpu:2cores
- compute:memory:512MB
- compute:timeout:30s
```

### Pattern 2: Data Pipeline

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `pandas`
  - `numpy`
  - `scikit-learn`
- compute:cpu:4cores
- compute:memory:4GB
- compute:timeout:600s
- storage:filesystem:read
- storage:filesystem:write
- storage:parquet
```

### Pattern 3: CLI Tool

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `click`
  - `rich`
- storage:filesystem:read
- storage:filesystem:write
- compute:timeout:60s
```

### Pattern 4: AI/ML Module

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `torch`
  - `transformers`
  - `tokenizers`
- compute:gpu:cuda:11.8+
- compute:memory:16GB
- compute:timeout:300s
- storage:filesystem:write
- network:http
```

### Pattern 5: IoT Module

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `paho-mqtt`
  - `gpiozero`
- hardware:arm64
- hardware:gpio
- network:mqtt
- compute:memory:64MB
- compute:timeout:10s
- security:tls:1.2+
```

### Pattern 6: Microservice

```markdown
## Capabilities

- runtime:python:3.10+
- runtime:python:modules
  - `fastapi`
  - `uvicorn`
  - `sqlalchemy`
  - `alembic`
- network:http
- network:grpc
- storage:postgresql:14+
- storage:redis:7+
- compute:cpu:2cores
- compute:memory:1GB
- compute:timeout:30s
- security:tls:1.2+
```

## Validation Rules

### Rule 1: Valid Capability Format

Capability names must match the pattern: `^[a-z][a-z0-9:-]{0,127}$`

```python
import re

def validate_capability(name: str) -> bool:
    pattern = r'^[a-z][a-z0-9:-]{0,127}$'
    return bool(re.match(pattern, name))
```

### Rule 2: No Duplicate Capabilities

Each capability should be listed only once:

```python
def check_duplicates(capabilities: list[str]) -> list[str]:
    seen = set()
    duplicates = []
    for cap in capabilities:
        if cap in seen:
            duplicates.append(cap)
        seen.add(cap)
    return duplicates
```

### Rule 3: Valid Version Constraints

Version constraints must be valid semver:

```python
from packaging.version import Version

def validate_version_constraint(constraint: str) -> bool:
    try:
        # Parse version constraint
        return True
    except:
        return False
```

### Rule 4: Known Category

Capability categories must be from the predefined list:

```python
VALID_CATEGORIES = {
    'runtime', 'network', 'storage', 'compute',
    'security', 'integration', 'hardware'
}

def validate_category(category: str) -> bool:
    return category in VALID_CATEGORIES
```

### Rule 5: Platform Compatibility

Platform-specific capabilities must be valid:

```python
VALID_PLATFORMS = {'windows', 'linux', 'macos', 'ios', 'android'}

def validate_platform(platform: str) -> bool:
    return platform in VALID_PLATFORMS
```

## Related Sections

- **[Permissions](permissions.md)**: Security grants vs capability requirements
- **[Dependencies](dependencies.md)**: Module dependencies vs system capabilities
- **[Python](python.md)**: Runtime-specific code blocks
- **[JavaScript](javascript.md)**: Runtime-specific code blocks
- **[Metadata](metadata.md)**: Module-level capability declarations
- **[Tests](tests.md)**: Capability validation tests

## FAQ

### Q: What's the difference between Capabilities and Permissions?

**A:** Capabilities declare what the module *needs* from the environment (prerequisites). Permissions declare what the module is *allowed* to do (security grants). A module might have `network:https` capability (needs network) and `network` permission (allowed to use network).

### Q: Can I add custom capabilities?

**A:** Yes, but custom capabilities should use a namespace prefix: `custom:mycompany:my-capability`. The MAM runtime may not recognize custom capabilities, but they can be used by custom validators.

### Q: What happens if a capability isn't met?

**A:** The MAM runtime should reject the module before execution. The error message should indicate which capability is missing and what's required.

### Q: Are capabilities enforced at runtime?

**A:** Ideally yes, but enforcement depends on the runtime implementation. At minimum, capabilities should be validated at module load time.

### Q: Can capabilities be conditional?

**A:** Yes, using the `(optional, <platform>)` syntax:

```markdown
## Capabilities

- hardware:arm64 (optional, linux)
- hardware:x86_64 (optional, windows)
```

### Q: How do I list capabilities for a module that works everywhere?

**A:** Use minimal capabilities:

```markdown
## Capabilities

- runtime:python:3.10+
```

### Q: Should I list every Python module I use?

**A:** No, only list runtime-level requirements. Individual Python packages belong in the Dependencies section.

### Q: Can capabilities include version ranges?

**A:** Yes, use semver-compatible constraints:

```markdown
## Capabilities

- runtime:python:>=3.10,<4.0
- storage:sqlite:>=3.35
```

### Q: What if my module has optional features?

**A:** Use the `(optional)` marker:

```markdown
## Capabilities

- runtime:python:3.10+
- compute:gpu:cuda (optional)  # Enhances performance
- storage:redis (optional)  # Caching layer
```

### Q: How do I handle deprecated capabilities?

**A:** Mark them as deprecated and provide alternatives:

```markdown
## Capabilities

- runtime:python:3.8+ (deprecated, use 3.10+)
- runtime:python:3.10+ (recommended)
```

### Q: Should I include capabilities for development tools?

**A:** No, capabilities are for runtime requirements. Development tools belong in development documentation.

### Q: Can capabilities be inherited?

**A:** Not automatically. Each module must declare its own capabilities. However, you can reference parent module capabilities in documentation.

### Q: What if my module works with different configurations?

**A:** Document different capability profiles:

```markdown
## Capabilities

# Minimal configuration
- runtime:python:3.10+

# Full configuration
- runtime:python:3.10+
- compute:gpu:cuda (optional)
- storage:redis (optional)
```

### Q: How do I test capability validation?

**A:** Use the Tests section:

```markdown
## Tests

```python
def test_capabilities():
    caps = get_module_capabilities()
    assert 'runtime:python:3.10+' in caps
    assert 'network:https' in caps
```
```

### Q: Can I use capabilities for feature flags?

**A:** Capabilities are for system requirements, not feature flags. Use the Memory section for feature state.

### Q: What if I need capabilities not in the standard list?

**A:** Use custom capabilities with your namespace:

```markdown
## Capabilities

- custom:mycompany:special-hardware
```

### Q: Should capabilities be alphabetically sorted?

**A:** Not required, but sorting by category improves readability:

```markdown
## Capabilities

# Compute
- compute:cpu:2cores
- compute:memory:1GB

# Network
- network:https

# Runtime
- runtime:python:3.10+

# Storage
- storage:sqlite
```

### Q: Can capabilities be dynamically generated?

**A:** In static MAM modules, no. But MAM runtimes can generate capabilities from code analysis or configuration.

### Q: How do capabilities affect module discovery?

**A:** Capabilities help filter compatible modules. A module discovery system can match available capabilities against module requirements.

### Q: Should I list capabilities that are always available?

**A:** Only if they have specific version requirements. Basic capabilities like `runtime:python` are assumed.

### Q: Can capabilities reference other modules?

**A:** Not directly. Use the Dependencies section for module dependencies. Capabilities are for system-level requirements.

## Implementation Notes

### Runtime Validation

```python
class CapabilityValidator:
    def __init__(self, available_capabilities: dict[str, str]):
        self.available = available_capabilities
    
    def validate(self, required: list[str]) -> list[str]:
        errors = []
        for cap in required:
            if not self._is_available(cap):
                errors.append(f"Missing capability: {cap}")
        return errors
    
    def _is_available(self, capability: str) -> bool:
        # Check exact match
        if capability in self.available:
            return True
        
        # Check version constraint
        base, _, version = capability.rpartition(':')
        if base in self.available:
            return self._check_version(
                self.available[base], version
            )
        
        return False
```

### Capability Resolution

```python
def resolve_capabilities(capabilities: list[str]) -> dict[str, str]:
    resolved = {}
    for cap in capabilities:
        parts = cap.split(':')
        if len(parts) >= 2:
            category = parts[0]
            name = ':'.join(parts[1:])
            resolved[category] = name
    return resolved
```

### Capability Matching

```python
def capabilities_match(required: str, available: str) -> bool:
    # Exact match
    if required == available:
        return True
    
    # Version comparison
    required_base = required.split(':')[0]
    available_base = available.split(':')[0]
    
    if required_base != available_base:
        return False
    
    # Parse and compare versions
    required_version = parse_version(required)
    available_version = parse_version(available)
    
    return available_version >= required_version
```

## References

- [MAM Specification - Capabilities](../SPEC.md#capabilities)
- [Capability-Based Security](https://en.wikipedia.org/wiki/Capability-based_security)
- [Semantic Versioning](https://semver.org/)
- [MAM Capability Registry](https://mam.dev/capabilities)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable