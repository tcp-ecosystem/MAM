# Dependencies Section

## Description
The Dependencies section lists required modules and packages that the current module depends on. It serves as a manifest of external libraries, frameworks, and other MAM modules that must be available for the module to function correctly. This section is critical for package management, version resolution, and deployment automation.

Dependencies are declared as a structured list that includes package names, version constraints, and optional metadata about the dependency's purpose. The MAM runtime uses this information to automatically install, update, and manage dependencies.

## Syntax

```markdown
## Dependencies

- PackageName >= version
- PackageName ~= version
- PackageName == version
- PackageName
```

### Version Constraint Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `>=` | Greater than or equal to | `requests >= 2.28.0` |
| `<=` | Less than or equal to | `flask <= 2.3.0` |
| `==` | Exact version | `numpy == 1.24.0` |
| `!=` | Not equal to | `pandas != 1.5.0` |
| `~=` | Compatible release | `pydantic ~= 2.0` |
| `>` | Greater than | `python > 3.9` |
| `<` | Less than | `sqlalchemy < 2.0` |

### Version Range Syntax

```markdown
- Package >= 1.0, < 2.0
- Package >= 1.0, != 1.5
- Package >= 1.0, < 1.5, != 1.2
```

### Dependency Groups

```markdown
## Dependencies

# Core
- requests >= 2.28.0
- pydantic >= 2.0

# Optional
- redis >= 4.0 (optional)
- celery >= 5.0 (optional)

# Development
- pytest >= 7.0 (dev)
- black >= 23.0 (dev)
```

## Rules

1. **Package names**: Must be valid package names (lowercase, hyphens, underscores)
2. **Version constraints**: Must follow semver-compatible syntax
3. **No duplicates**: Each package should be listed only once
4. **Grouping**: Use comments to group related dependencies
5. **Specificity**: Pin critical dependencies with exact versions
6. **Optional marking**: Use `(optional)` for non-critical dependencies
7. **Dev marking**: Use `(dev)` for development-only dependencies

### Package Name Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| Lowercase | `requests` | `Requests` |
| Hyphens | `my-package` | `my package` |
| Underscores | `my_package` | `my.package` |
| Numbers | `package1` | `1package` |
| Max 214 chars | - | - |

### Version Constraint Rules

- Must be valid semver or semver range
- No leading zeros in version numbers
- Major version should be specified for stability
- Use `~=` for compatible updates
- Use `>=` with upper bound for safety

## Description

The Dependencies section provides several critical functions:

1. **Automatic Installation**: The MAM runtime can automatically install required packages
2. **Version Resolution**: Dependency solvers can resolve compatible versions
3. **Conflict Detection**: The system can detect version conflicts before execution
4. **Reproducibility**: Dependencies enable reproducible builds and deployments
5. **Documentation**: Humans can understand module requirements

### Dependency Types

#### External Packages

Third-party packages from package repositories:

```markdown
## Dependencies

- requests >= 2.28.0
- flask >= 2.3.0
- sqlalchemy >= 1.4.0
```

#### Internal Modules

Other MAM modules in the same project:

```markdown
## Dependencies

- @myorg/auth-module >= 1.0.0
- @myorg/utils >= 2.0.0
```

#### System Packages

Operating system packages (when applicable):

```markdown
## Dependencies

# System packages (apt)
- libssl-dev
- libffi-dev

# System packages (yum)
- openssl-devel
- libffi-devel
```

#### Runtime Dependencies

Runtime-specific requirements:

```markdown
## Dependencies

# Python packages
- requests >= 2.28.0

# Node.js packages
- express >= 4.18.0

# Rust crates
- serde >= 1.0
```

### Version Resolution

The MAM runtime uses semantic versioning to resolve dependencies:

1. **Major version changes**: May introduce breaking changes
2. **Minor version changes**: Add features, backward compatible
3. **Patch version changes**: Bug fixes, backward compatible

Resolution algorithm:
1. Parse all version constraints
2. Find compatible versions for each package
3. Check for conflicts between packages
4. Select optimal versions
5. Return resolved dependency tree

## Examples

### Basic Web Application

```markdown
## Dependencies

- fastapi >= 0.100.0
- uvicorn >= 0.23.0
- pydantic >= 2.0
- sqlalchemy >= 1.4.0
- python-jose >= 3.3.0
- passlib >= 1.7.0
- bcrypt >= 4.0.0
```

### Data Science Project

```markdown
## Dependencies

- numpy >= 1.24.0
- pandas >= 2.0.0
- scikit-learn >= 1.3.0
- matplotlib >= 3.7.0
- seaborn >= 0.12.0
- jupyter >= 1.0.0

# Optional
- xgboost >= 1.7.0 (optional)
- lightgbm >= 4.0.0 (optional)
- tensorflow >= 2.13.0 (optional)
```

### CLI Tool

```markdown
## Dependencies

- click >= 8.1.0
- rich >= 13.0.0
- pyyaml >= 6.0
- toml >= 0.10.0
```

### Microservice

```markdown
## Dependencies

# Core
- fastapi >= 0.100.0
- uvicorn >= 0.23.0
- pydantic >= 2.0

# Database
- sqlalchemy >= 1.4.0
- alembic >= 1.11.0
- psycopg2-binary >= 2.9.0

# Cache
- redis >= 4.5.0
- aioredis >= 2.0.0

# Monitoring
- prometheus-client >= 0.17.0
- structlog >= 23.0.0

# Testing
- pytest >= 7.4.0 (dev)
- httpx >= 0.24.0 (dev)
```

### MAM Module Dependencies

```markdown
## Dependencies

# Internal MAM modules
- @myorg/auth-module >= 1.0.0
- @myorg/utils >= 2.0.0
- @myorg/database >= 1.5.0

# External packages
- pydantic >= 2.0
- httpx >= 0.24.0
```

### Multi-Runtime Module

```markdown
## Dependencies

# Python runtime
- requests >= 2.28.0
- pydantic >= 2.0

# JavaScript runtime
- express >= 4.18.0
- axios >= 1.4.0

# Rust runtime
- serde >= 1.0
- tokio >= 1.28
```

### Minimal Module

```markdown
## Dependencies

- pydantic >= 2.0
```

### Enterprise Module

```markdown
## Dependencies

# Core
- fastapi >= 0.100.0
- uvicorn >= 0.23.0
- pydantic >= 2.0

# Security
- python-jose >= 3.3.0
- passlib >= 1.7.0
- bcrypt >= 4.0.0
- cryptography >= 41.0.0

# Database
- sqlalchemy >= 1.4.0
- alembic >= 1.11.0
- asyncpg >= 0.28.0

# Monitoring
- structlog >= 23.0.0
- prometheus-client >= 0.17.0
- sentry-sdk >= 1.28.0

# Testing
- pytest >= 7.4.0 (dev)
- pytest-asyncio >= 0.21.0 (dev)
- httpx >= 0.24.0 (dev)
- black >= 23.0 (dev)
- ruff >= 0.0.280 (dev)
```

## Edge Cases

### 1. Circular Dependencies

When modules depend on each other:

```markdown
# Module A depends on Module B
## Dependencies

- @myorg/module-b >= 1.0.0

# Module B depends on Module A
## Dependencies

- @myorg/module-a >= 1.0.0
```

**Solution**: The MAM runtime should detect and reject circular dependencies.

### 2. Conflicting Version Requirements

When different dependencies require incompatible versions:

```markdown
## Dependencies

- package-a >= 2.0
- package-b >= 1.0, < 2.0  # Conflicts with package-a
```

**Solution**: The dependency resolver should detect conflicts and report them.

### 3. Missing Dependencies

When a required package isn't available:

```markdown
## Dependencies

- nonexistent-package >= 1.0.0
```

**Solution**: The runtime should fail with a clear error message.

### 4. Deprecated Packages

When a dependency is deprecated:

```markdown
## Dependencies

- old-package >= 1.0.0 (deprecated, use new-package)
- new-package >= 2.0.0
```

**Solution**: Mark as deprecated and provide migration path.

### 5. Platform-Specific Dependencies

When dependencies vary by platform:

```markdown
## Dependencies

# All platforms
- requests >= 2.28.0

# Windows only
- pywin32 >= 306 (platform=win32)

# macOS only
- pyobjc >= 10.0 (platform=darwin)
```

### 6. Optional Dependencies

When dependencies are optional:

```markdown
## Dependencies

# Required
- requests >= 2.28.0

# Optional (for enhanced features)
- redis >= 4.0 (optional)
- celery >= 5.0 (optional)
```

### 7. Development Dependencies

When dependencies are only for development:

```markdown
## Dependencies

# Runtime
- requests >= 2.28.0

# Development
- pytest >= 7.0 (dev)
- black >= 23.0 (dev)
- mypy >= 1.4.0 (dev)
```

### 8. Version Pinning

When exact versions are required:

```markdown
## Dependencies

- requests == 2.28.0
- pydantic == 2.0.0
```

### 9. Pre-release Versions

When pre-release versions are needed:

```markdown
## Dependencies

- package >= 2.0.0a1
- package >= 2.0.0b1
- package >= 2.0.0rc1
```

### 10. Local Dependencies

When dependencies are local packages:

```markdown
## Dependencies

- ./local-package >= 1.0.0
- git+https://github.com/user/repo.git@main
```

## Best Practices

### 1. Pin Major Versions

Always specify major version to avoid breaking changes:

```markdown
# Good
- requests >= 2.28.0

# Bad
- requests
```

### 2. Use Compatible Release Operator

Use `~=` for compatible updates:

```markdown
# Good
- pydantic ~= 2.0

# Bad
- pydantic >= 2.0
```

### 3. Group Related Dependencies

Use comments to organize dependencies:

```markdown
## Dependencies

# Web framework
- fastapi >= 0.100.0
- uvicorn >= 0.23.0

# Database
- sqlalchemy >= 1.4.0
- alembic >= 1.11.0

# Testing
- pytest >= 7.4.0 (dev)
```

### 4. Document Purpose

Add comments explaining why each dependency is needed:

```markdown
## Dependencies

- requests >= 2.28.0  # HTTP client for API calls
- pydantic >= 2.0  # Data validation
- sqlalchemy >= 1.4.0  # Database ORM
```

### 5. Separate Runtime from Dev

Keep runtime and development dependencies separate:

```markdown
## Dependencies

# Runtime
- requests >= 2.28.0

# Development
- pytest >= 7.0 (dev)
- black >= 23.0 (dev)
```

### 6. Use Exact Versions for Critical Dependencies

For critical dependencies, pin exact versions:

```markdown
## Dependencies

- cryptography >= 41.0.0  # Security-critical
- python-jose >= 3.3.0  # Security-critical
```

### 7. Regular Updates

Review and update dependencies regularly:

```markdown
## Dependencies

# Updated 2026-07-24
- requests >= 2.31.0
- pydantic >= 2.4.0
```

### 8. Document Known Issues

Note any known issues with dependencies:

```markdown
## Dependencies

- package >= 1.0.0  # Known issue: slow startup on Windows
```

### 9. Use Version Ranges for Stability

Use version ranges to balance stability and updates:

```markdown
## Dependencies

- requests >= 2.28.0, < 3.0.0
- pydantic >= 2.0, < 3.0.0
```

### 10. Test Dependencies Separately

Test dependency resolution separately from module logic.

## Common Patterns

### Pattern 1: Minimal Dependencies

```markdown
## Dependencies

- pydantic >= 2.0
```

### Pattern 2: Web Framework Stack

```markdown
## Dependencies

# Core
- fastapi >= 0.100.0
- uvicorn >= 0.23.0
- pydantic >= 2.0

# Database
- sqlalchemy >= 1.4.0
- alembic >= 1.11.0

# Cache
- redis >= 4.0
```

### Pattern 3: Data Science Stack

```markdown
## Dependencies

- numpy >= 1.24.0
- pandas >= 2.0.0
- scikit-learn >= 1.3.0
- matplotlib >= 3.7.0
```

### Pattern 4: Security Stack

```markdown
## Dependencies

- cryptography >= 41.0.0
- python-jose >= 3.3.0
- passlib >= 1.7.0
- bcrypt >= 4.0.0
```

### Pattern 5: Testing Stack

```markdown
## Dependencies

# Runtime
- requests >= 2.28.0

# Testing
- pytest >= 7.4.0 (dev)
- pytest-asyncio >= 0.21.0 (dev)
- httpx >= 0.24.0 (dev)
- pytest-cov >= 4.1.0 (dev)
```

### Pattern 6: Microservice Stack

```markdown
## Dependencies

# Core
- fastapi >= 0.100.0
- uvicorn >= 0.23.0
- pydantic >= 2.0

# Database
- sqlalchemy >= 1.4.0
- alembic >= 1.11.0
- asyncpg >= 0.28.0

# Cache
- redis >= 4.5.0

# Monitoring
- structlog >= 23.0.0
- prometheus-client >= 0.17.0

# Security
- python-jose >= 3.3.0
- passlib >= 1.7.0
```

### Pattern 7: CLI Tool Stack

```markdown
## Dependencies

- click >= 8.1.0
- rich >= 13.0.0
- pyyaml >= 6.0
- toml >= 0.10.0
```

### Pattern 8: API Client Stack

```markdown
## Dependencies

- httpx >= 0.24.0
- pydantic >= 2.0
- tenacity >= 8.2.0
```

## Validation Rules

### Rule 1: Valid Package Names

Package names must match: `^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$`

```python
import re

def validate_package_name(name: str) -> bool:
    pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$'
    return bool(re.match(pattern, name)) and len(name) <= 214
```

### Rule 2: Valid Version Constraints

Version constraints must be valid semver:

```python
from packaging.specifiers import SpecifierSet

def validate_version_constraint(constraint: str) -> bool:
    try:
        SpecifierSet(constraint)
        return True
    except:
        return False
```

### Rule 3: No Duplicates

Each package should be listed only once:

```python
def check_duplicates(dependencies: list[str]) -> list[str]:
    seen = set()
    duplicates = []
    for dep in dependencies:
        name = dep.split()[0]
        if name in seen:
            duplicates.append(name)
        seen.add(name)
    return duplicates
```

### Rule 4: Valid Group Markers

Group markers must be from: `optional`, `dev`, `test`, `docs`

```python
VALID_GROUPS = {'optional', 'dev', 'test', 'docs'}

def validate_group_marker(marker: str) -> bool:
    return marker in VALID_GROUPS
```

### Rule 5: Version Range Consistency

Version ranges must not be contradictory:

```python
def check_version_consistency(constraints: list[str]) -> bool:
    # Check for contradictory constraints
    # Example: >= 2.0, < 1.0
    return True  # Simplified
```

## Related Sections

- **[Capabilities](capabilities.md)**: System capabilities vs package dependencies
- **[Imports](imports.md)**: Code imports vs package dependencies
- **[Plugins](plugins.md)**: Plugin dependencies
- **[Metadata](metadata.md)**: Dependency declarations in front matter
- **[Tests](tests.md)**: Dependency testing
- **[Python](python.md)**: Python-specific dependencies
- **[JavaScript](javascript.md)**: JavaScript-specific dependencies

## FAQ

### Q: What's the difference between Dependencies and Imports?

**A:** Dependencies declare *packages* that must be installed. Imports declare *code* that must be available within those packages. Dependencies are at the package level; imports are at the code level.

### Q: Should I pin exact versions?

**A:** For critical dependencies, yes. For others, use version ranges to allow updates. Example:

```markdown
## Dependencies

- cryptography == 41.0.0  # Pin exact for security
- requests >= 2.28.0  # Range for updates
```

### Q: How do I handle transitive dependencies?

**A:** Don't list transitive dependencies directly. Let the package manager resolve them. Only list direct dependencies.

### Q: Can I use local packages?

**A:** Yes, with file paths or git URLs:

```markdown
## Dependencies

- ./local-package >= 1.0.0
- git+https://github.com/user/repo.git@main
```

### Q: What about platform-specific dependencies?

**A:** Use platform markers:

```markdown
## Dependencies

- requests >= 2.28.0
- pywin32 >= 306 (platform=win32)
```

### Q: How do I handle optional dependencies?

**A:** Mark them as optional:

```markdown
## Dependencies

# Required
- requests >= 2.28.0

# Optional
- redis >= 4.0 (optional)
```

### Q: Should I list development dependencies?

**A:** Yes, but mark them as dev:

```markdown
## Dependencies

# Runtime
- requests >= 2.28.0

# Development
- pytest >= 7.0 (dev)
- black >= 23.0 (dev)
```

### Q: How do I handle version conflicts?

**A:** The MAM runtime should detect and report conflicts. You may need to adjust version constraints.

### Q: Can I use dependencies from multiple sources?

**A:** Yes, specify the source:

```markdown
## Dependencies

- package >= 1.0.0  # PyPI
- ./local-package  # Local
- git+https://github.com/user/repo.git  # Git
```

### Q: How do I document why a dependency is needed?

**A:** Use comments:

```markdown
## Dependencies

- requests >= 2.28.0  # HTTP client for API calls
- pydantic >= 2.0  # Data validation
```

### Q: What if a dependency becomes deprecated?

**A:** Mark as deprecated and provide alternative:

```markdown
## Dependencies

- old-package >= 1.0.0 (deprecated, use new-package)
- new-package >= 2.0.0
```

### Q: How do I handle pre-release versions?

**A:** Specify pre-release in version constraint:

```markdown
## Dependencies

- package >= 2.0.0a1
- package >= 2.0.0b1
```

### Q: Can I use wildcards in versions?

**A:** Not directly. Use version ranges instead:

```markdown
## Dependencies

# Bad
- package >= 1.*

# Good
- package >= 1.0, < 2.0
```

### Q: How do I handle dependencies with different names?

**A:** Use the PyPI/npm/cargo name:

```markdown
## Dependencies

- Pillow >= 10.0.0  # PyPI name, not PIL
- scikit-learn >= 1.3.0  # PyPI name, not sklearn
```

### Q: Should I list runtime and dev dependencies separately?

**A:** Yes, use comments to separate:

```markdown
## Dependencies

# Runtime
- requests >= 2.28.0

# Development
- pytest >= 7.0 (dev)
```

### Q: How do I handle dependencies that conflict with system packages?

**A:** Document the conflict and provide solutions:

```markdown
## Dependencies

- package >= 1.0.0  # May conflict with system package
```

### Q: Can I use dependencies from private repositories?

**A:** Yes, specify the repository:

```markdown
## Dependencies

- private-package >= 1.0.0  # from private-pypi.example.com
```

### Q: How do I handle dependencies with security vulnerabilities?

**A:** Pin to fixed versions and document:

```markdown
## Dependencies

- package >= 1.0.1  # Security fix for CVE-2026-1234
```

### Q: Should I list every sub-dependency?

**A:** No, only list direct dependencies. Let the package manager handle transitive dependencies.

## Implementation Notes

### Dependency Resolution

```python
class DependencyResolver:
    def __init__(self):
        self.packages = {}
    
    def resolve(self, dependencies: list[str]) -> dict[str, str]:
        resolved = {}
        for dep in dependencies:
            name, version = self.parse_dependency(dep)
            if name in resolved:
                # Check compatibility
                if not self.compatible(resolved[name], version):
                    raise ConflictError(f"Conflict: {name}")
            resolved[name] = version
        return resolved
    
    def parse_dependency(self, dep: str) -> tuple[str, str]:
        parts = dep.split()
        name = parts[0]
        version = parts[1] if len(parts) > 1 else "*"
        return name, version
```

### Version Comparison

```python
from packaging.version import Version

def compare_versions(v1: str, v2: str) -> int:
    ver1 = Version(v1)
    ver2 = Version(v2)
    if ver1 < ver2:
        return -1
    elif ver1 > ver2:
        return 1
    else:
        return 0
```

### Dependency Installation

```python
import subprocess

def install_dependency(name: str, version: str) -> bool:
    try:
        subprocess.run(
            ["pip", "install", f"{name}>={version}"],
            check=True,
            capture_output=True
        )
        return True
    except subprocess.CalledProcessError:
        return False
```

## References

- [MAM Specification - Dependencies](../SPEC.md#dependencies)
- [Semantic Versioning](https://semver.org/)
- [Python Packaging](https://packaging.python.org/)
- [npm Documentation](https://docs.npmjs.com/)
- [Cargo Documentation](https://doc.rust-lang.org/cargo/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable