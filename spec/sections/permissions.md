# Permissions Section

## Description
The Permissions section declares required security permissions for the module. It specifies what system resources and capabilities the module needs access to, enabling capability-based security and resource management. This section is critical for sandboxing, access control, and security auditing.

The Permissions section serves as:
- **Security declaration**: What the module is allowed to do
- **Access control**: System resource access requirements
- **Sandboxing**: Defining execution boundaries
- **Auditing**: Security compliance documentation
- **User consent**: Informing users of access requirements

## Valid Permissions

| Permission | Description | Risk Level |
|------------|-------------|------------|
| `network` | HTTP/HTTPS access | Medium |
| `filesystem` | File read/write access | High |
| `environment` | Environment variable access | Medium |
| `exec` | Process execution | High |
| `memory` | Large memory allocation | Low |

### Permission Details

#### network

HTTP/HTTPS network access:

```markdown
## Permissions

- network
```

**Grants:**
- Outbound HTTP/HTTPS requests
- DNS resolution
- WebSocket connections
- TCP/UDP socket access

**Restrictions:**
- No inbound connections
- No raw socket manipulation
- No network interface configuration

**Risk:** Medium - Can exfiltrate data or connect to external services.

#### filesystem

File system read/write access:

```markdown
## Permissions

- filesystem
```

**Grants:**
- Read files in allowed directories
- Write files in allowed directories
- Create/delete files
- Directory operations

**Restrictions:**
- Limited to allowed paths
- No system file access
- No permission changes

**Risk:** High - Can read/write sensitive data.

#### environment

Environment variable access:

```markdown
## Permissions

- environment
```

**Grants:**
- Read environment variables
- Set environment variables
- Access configuration

**Restrictions:**
- No system variable modification
- No PATH manipulation

**Risk:** Medium - May expose secrets or configuration.

#### exec

Process execution:

```markdown
## Permissions

- exec
```

**Grants:**
- Execute system commands
- Run external programs
- Create subprocesses

**Restrictions:**
- Limited to allowed commands
- No privilege escalation
- No system service manipulation

**Risk:** High - Can execute arbitrary code.

#### memory

Large memory allocation:

```markdown
## Permissions

- memory
```

**Grants:**
- Allocate large memory blocks
- Memory-mapped files
- Shared memory

**Restrictions:**
- Memory limits enforced
- No memory access across processes

**Risk:** Low - May affect system performance.

## Syntax

```markdown
## Permissions

- permission1
- permission2
- permission3
```

### Permission Format

Each permission is a list item:

```markdown
## Permissions

- network
- filesystem
```

### Permission with Justification

```markdown
## Permissions

- `network` - Required for API calls
- `filesystem` - Required for data storage
```

## Rules

1. **Valid permissions only**: Must use valid permission names
2. **Minimal principle**: Only request necessary permissions
3. **Clear justification**: Document why each permission is needed
4. **No blanket permissions**: Be specific about access needs
5. **Risk documentation**: Document security implications
6. **User consent**: Users must be informed of permissions
7. **Audit trail**: Log permission usage

### Permission Naming Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| Lowercase | `network` | `Network` |
| No spaces | `filesystem` | `file system` |
| Alphanumeric | `exec1` | `exec-1` |
| Max 32 chars | - | - |

### Risk Assessment

| Permission | Risk | Justification Required |
|------------|------|------------------------|
| `network` | Medium | Yes |
| `filesystem` | High | Yes |
| `environment` | Medium | Yes |
| `exec` | High | Yes |
| `memory` | Low | Optional |

## Description

The Permissions section defines security boundaries:

### 1. Minimal Permissions

Module with minimal access:

```markdown
## Permissions

- network
```

### 2. Data Processing

Module that processes files:

```markdown
## Permissions

- filesystem
- memory
```

### 3. Web Application

Module that serves web content:

```markdown
## Permissions

- network
- filesystem
- environment
```

### 4. System Integration

Module that integrates with system:

```markdown
## Permissions

- network
- filesystem
- environment
- exec
```

### 5. Secure Module

Module with minimal, justified permissions:

```markdown
## Permissions

- `network` - Required for API authentication
- `filesystem` - Required for certificate storage
```

### 6. Development Module

Module for development/testing:

```markdown
## Permissions

- network
- filesystem
- environment
- exec
- memory
```

### 7. Production Module

Module with production-appropriate permissions:

```markdown
## Permissions

- network
- filesystem
```

### 8. Restricted Module

Module with highly restricted permissions:

```markdown
## Permissions

- network
```

## Examples

### Authentication Module

```markdown
## Permissions

- `network` - Required for OAuth callbacks
- `filesystem` - Required for key storage
```

### API Client

```markdown
## Permissions

- `network` - Required for API calls
```

### Data Processor

```markdown
## Permissions

- `filesystem` - Required for file I/O
- `memory` - Required for large datasets
```

### CLI Tool

```markdown
## Permissions

- `filesystem` - Required for config files
- `environment` - Required for environment variables
```

### Web Scraper

```markdown
## Permissions

- `network` - Required for HTTP requests
- `filesystem` - Required for data storage
```

### Database Module

```markdown
## Permissions

- `network` - Required for database connections
- `filesystem` - Required for local storage
```

### Email Module

```markdown
## Permissions

- `network` - Required for SMTP connections
```

### System Monitor

```markdown
## Permissions

- `environment` - Required for system info
- `exec` - Required for system commands
```

### File Converter

```markdown
## Permissions

- `filesystem` - Required for file operations
- `memory` - Required for large files
```

### Cache Module

```markdown
## Permissions

- `network` - Required for Redis/Memcached
- `filesystem` - Required for disk cache
```

## Edge Cases

### 1. No Permissions

When module needs no special permissions:

```markdown
## Permissions

(none)
```

Or omit the section.

### 2. Conditional Permissions

When permissions depend on configuration:

```markdown
## Permissions

- network  # Required if remote storage enabled
- filesystem  # Required if local storage enabled
```

### 3. Optional Permissions

When permissions are optional:

```markdown
## Permissions

- network  # Required
- filesystem  # Optional, for local caching
```

### 4. Platform-Specific

When permissions vary by platform:

```markdown
## Permissions

- network
- filesystem  # Not available on mobile
```

### 5. Permission Conflicts

When permissions conflict:

```markdown
## Permissions

- network
- network:none  # Conflict - module will be rejected
```

### 6. Elevated Permissions

When high-risk permissions are needed:

```markdown
## Permissions

- exec  # HIGH RISK - requires user approval
- filesystem  # HIGH RISK - requires user approval
```

### 7. Network Restrictions

When network access is restricted:

```markdown
## Permissions

- network:https  # HTTPS only
- network:api.example.com  # Specific domain only
```

### 8. Filesystem Restrictions

When filesystem access is restricted:

```markdown
## Permissions

- filesystem:read  # Read only
- filesystem:write  # Write only
- filesystem:/app/data  # Specific path only
```

### 9. Environment Restrictions

When environment access is restricted:

```markdown
## Permissions

- environment:MYAPP_*  # Specific variables only
- environment:read  # Read only
```

### 10. Execution Restrictions

When exec is restricted:

```markdown
## Permissions

- exec:python  # Python only
- exec:node  # Node.js only
- exec:git  # Git only
```

## Best Practices

### 1. Minimal Permissions

Only request necessary permissions:

```markdown
# Bad
- network
- filesystem
- environment
- exec
- memory

# Good (if only network needed)
- network
```

### 2. Document Justification

Explain why each permission is needed:

```markdown
## Permissions

- `network` - Required for OAuth authentication
- `filesystem` - Required for certificate storage
```

### 3. Use Specific Permissions

Be as specific as possible:

```markdown
# Bad
- filesystem

# Good
- filesystem:read:/app/config
- filesystem:write:/app/data
```

### 4. Group Related Permissions

Organize permissions logically:

```markdown
## Permissions

# Network
- network

# Storage
- filesystem
- memory
```

### 5. Document Risk Level

Document security implications:

```markdown
## Permissions

- `network` - MEDIUM RISK: Can connect to external services
- `filesystem` - HIGH RISK: Can read/write files
```

### 6. Use Consistent Naming

Follow permission naming conventions:

```markdown
# Bad
- net
- fs
- env

# Good
- network
- filesystem
- environment
```

### 7. Validate Permissions

Ensure permissions are valid before publishing.

### 8. Audit Permission Usage

Log when permissions are used.

### 9. Request at Runtime

Request permissions only when needed.

### 10. Document Exceptions

Document when permissions are denied.

## Common Patterns

### Pattern 1: Minimal Module

```markdown
## Permissions

- network
```

### Pattern 2: File Processing

```markdown
## Permissions

- filesystem
- memory
```

### Pattern 3: Web Application

```markdown
## Permissions

- network
- filesystem
- environment
```

### Pattern 4: System Integration

```markdown
## Permissions

- network
- filesystem
- environment
- exec
```

### Pattern 5: Data Pipeline

```markdown
## Permissions

- filesystem
- memory
- network
```

### Pattern 6: CLI Tool

```markdown
## Permissions

- filesystem
- environment
```

### Pattern 7: API Service

```markdown
## Permissions

- network
- filesystem
```

### Pattern 8: Secure Module

```markdown
## Permissions

- network
```

### Pattern 9: Development Module

```markdown
## Permissions

- network
- filesystem
- environment
- exec
- memory
```

### Pattern 10: Production Module

```markdown
## Permissions

- network
- filesystem
```

## Validation Rules

### Rule 1: Valid Permission Names

Permissions must be from valid list:

```python
VALID_PERMISSIONS = {'network', 'filesystem', 'environment', 'exec', 'memory'}

def validate_permission(permission: str) -> bool:
    base_permission = permission.split(':')[0]
    return base_permission in VALID_PERMISSIONS
```

### Rule 2: No Duplicates

Each permission should be listed once:

```python
def check_duplicates(permissions: list[str]) -> list[str]:
    seen = set()
    duplicates = []
    for perm in permissions:
        if perm in seen:
            duplicates.append(perm)
        seen.add(perm)
    return duplicates
```

### Rule 3: Valid Format

Permissions must follow format rules:

```python
import re

def validate_format(permission: str) -> bool:
    pattern = r'^[a-z][a-z0-9:]{0,31}$'
    return bool(re.match(pattern, permission))
```

### Rule 4: No Blanket Permissions

Permissions should be specific:

```python
def check_specificity(permission: str) -> bool:
    # Check for overly broad permissions
    broad = {'filesystem', 'network', 'exec'}
    return permission not in broad
```

### Rule 5: Justification Present

High-risk permissions should have justification:

```python
HIGH_RISK = {'filesystem', 'exec'}

def check_justification(permission: str, line: str) -> bool:
    if permission in HIGH_RISK:
        return ' - ' in line  # Has justification
    return True
```

### Rule 6: Risk Assessment

Document risk level for permissions:

```python
RISK_LEVELS = {
    'network': 'medium',
    'filesystem': 'high',
    'environment': 'medium',
    'exec': 'high',
    'memory': 'low'
}

def get_risk_level(permission: str) -> str:
    base = permission.split(':')[0]
    return RISK_LEVELS.get(base, 'unknown')
```

### Rule 7: No Conflicting Permissions

Permissions should not conflict:

```python
def check_conflicts(permissions: list[str]) -> list[str]:
    conflicts = []
    # Check for permission and its negation
    for perm in permissions:
        negation = f"{perm}:none"
        if negation in permissions:
            conflicts.append((perm, negation))
    return conflicts
```

### Rule 8: Platform Compatibility

Permissions should be compatible with platform:

```python
PLATFORM_PERMISSIONS = {
    'windows': {'network', 'filesystem', 'environment', 'exec', 'memory'},
    'linux': {'network', 'filesystem', 'environment', 'exec', 'memory'},
    'mobile': {'network', 'filesystem'}
}

def check_platform(permissions: list[str], platform: str) -> bool:
    allowed = PLATFORM_PERMISSIONS.get(platform, set())
    return all(p.split(':')[0] in allowed for p in permissions)
```

## Related Sections

- **[Capabilities](capabilities.md)**: System capabilities
- **[Dependencies](dependencies.md)**: Package dependencies
- **[Tests](tests.md)**: Permission testing
- **[Python](python.md)**: Code implementation
- **[JavaScript](javascript.md)**: Code implementation
- **[References](references.md)**: Security documentation

## FAQ

### Q: What's the difference between Permissions and Capabilities?

**A:** Permissions declare what the module is *allowed* to do (security grants). Capabilities declare what the module *needs* from the environment (prerequisites).

### Q: Should I request all permissions?

**A:** No, only request necessary permissions. Follow the principle of least privilege.

### Q: How do I document why a permission is needed?

**A:** Use the justification format:

```markdown
- `network` - Required for API authentication
```

### Q: Can I use restricted permissions?

**A:** Yes, use specific restrictions:

```markdown
- filesystem:read:/app/config
- network:https
```

### Q: What if a permission is denied?

**A:** Document the behavior when permissions are denied.

### Q: Can I request permissions at runtime?

**A:** Yes, but document the runtime permission requests.

### Q: How do I handle platform differences?

**A:** Document platform-specific permissions:

```markdown
- filesystem  # Not available on mobile
```

### Q: Should I group permissions?

**A:** Yes, group related permissions for clarity.

### Q: Can I use custom permissions?

**A:** Use standard permissions when possible. Custom permissions should be documented.

### Q: How do I handle high-risk permissions?

**A:** Document the risk and require user consent:

```markdown
- `exec` - HIGH RISK: Requires user approval
```

### Q: Should I log permission usage?

**A:** Yes, for security auditing.

### Q: Can I use wildcard permissions?

**A:** Avoid wildcards. Be specific about access needs.

### Q: How do I handle permission changes?

**A:** Document permission changes between versions.

### Q: Should I request permissions lazily?

**A:** Yes, request only when needed.

### Q: Can I use permission inheritance?

**A:** Not directly. Each module must declare its own permissions.

### Q: How do I test permission handling?

**A:** Test both granted and denied scenarios.

### Q: Should I include permissions in metadata?

**A:** Yes, permissions should be declared in the Permissions section.

### Q: Can I use permission scopes?

**A:** Yes, use specific scopes:

```markdown
- filesystem:read
- filesystem:write
```

### Q: How do I handle permission revocation?

**A:** Document behavior when permissions are revoked.

### Q: Should I document permission dependencies?

**A:** Yes, if one permission requires another.

### Q: Can I use conditional permissions?

**A:** Yes, document conditions:

```markdown
- network  # Required if remote storage enabled
```

### Q: How do I handle permission escalation?

**A:** Prevent escalation and document security model.

### Q: Should I audit permission changes?

**A:** Yes, track permission changes for security.

### Q: Can I use permission templates?

**A:** Yes, create templates for common permission sets.

### Q: How do I document permission exceptions?

**A:** Document when permissions are partially denied.

### Q: Should I include permissions in tests?

**A:** Yes, test permission handling.

### Q: Can I use permission negotiation?

**A:** Yes, document the negotiation process.

### Q: How do I handle permission conflicts?

**A:** Detect and resolve conflicts before execution.

### Q: Should I document permission limitations?

**A:** Yes, document what permissions don't grant.

### Q: Can I use permission caching?

**A:** Yes, but document caching behavior.

### Q: How do I handle permission timeouts?

**A:** Document timeout behavior for temporary permissions.

## Implementation Notes

### Permission Extraction

```python
def extract_permissions(content: str) -> list[str]:
    permissions = []
    in_permissions = False
    
    for line in content.split('\n'):
        if line.strip().startswith('## Permissions'):
            in_permissions = True
            continue
        
        if in_permissions and line.strip().startswith('- '):
            permission = line.strip()[2:].split(' - ')[0].strip('`')
            permissions.append(permission)
        elif in_permissions and line.startswith('##'):
            break
    
    return permissions
```

### Permission Validation

```python
def validate_permissions(permissions: list[str]) -> list[str]:
    errors = []
    
    for perm in permissions:
        if not validate_permission(perm):
            errors.append(f"Invalid permission: {perm}")
    
    # Check for duplicates
    duplicates = check_duplicates(permissions)
    for dup in duplicates:
        errors.append(f"Duplicate permission: {dup}")
    
    return errors
```

### Permission Documentation Generator

```python
def document_permissions(permissions: list[str]) -> str:
    docs = "# Required Permissions\n\n"
    
    for perm in permissions:
        risk = get_risk_level(perm)
        docs += f"- `{perm}` ({risk} risk)\n"
    
    return docs
```

### Permission Checker

```python
class PermissionChecker:
    def __init__(self, granted: set[str]):
        self.granted = granted
    
    def check(self, required: list[str]) -> list[str]:
        denied = []
        for perm in required:
            base = perm.split(':')[0]
            if base not in self.granted:
                denied.append(perm)
        return denied
```

## References

- [MAM Specification - Permissions](../SPEC.md#permissions)
- [Capability-Based Security](https://en.wikipedia.org/wiki/Capability-based_security)
- [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
- [Security Permissions](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable