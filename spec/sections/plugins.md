# Plugins Section

## Description
The Plugins section lists required plugins for the module. It specifies what extensions, add-ons, or additional functionality the module depends on. This section is critical for module extensibility, feature discovery, and dependency management.

The Plugins section serves as:
- **Extension declaration**: What plugins the module needs
- **Feature discovery**: Available plugin functionality
- **Dependency management**: Plugin version requirements
- **Configuration**: Plugin-specific settings
- **Compatibility**: Plugin compatibility information

## Syntax

```markdown
## Plugins

- @mam/plugin-name
- @mam/plugin-name@version
- plugin-name (optional)
```

### Plugin Format

Each plugin is a list item:

```markdown
## Plugins

- @mam/plugin-yaml
- @mam/plugin-mermaid
- @mam/plugin-python
```

### Version Constraints

```markdown
## Plugins

- @mam/plugin-yaml >= 1.0.0
- @mam/plugin-mermaid ~= 2.0
- @mam/plugin-python == 1.5.0
```

### Optional Plugins

```markdown
## Plugins

- @mam/plugin-yaml
- @mam/plugin-redis (optional)
- @mam/plugin-s3 (optional)
```

## Rules

1. **Valid plugin names**: Must use valid plugin naming conventions
2. **Version constraints**: Should include version constraints
3. **No duplicates**: Each plugin should be listed once
4. **Clear documentation**: Document what each plugin provides
5. **Optional marking**: Mark non-essential plugins as optional
6. **Compatibility**: Document compatibility requirements
7. **Configuration**: Document plugin configuration

### Plugin Naming Rules

| Rule | Valid | Invalid |
|------|-------|---------|
| @mam/ prefix | `@mam/plugin-yaml` | `plugin-yaml` |
| Lowercase | `@mam/plugin-json` | `@mam/plugin-JSON` |
| Hyphens | `@mam/plugin-data` | `@mam/plugin_data` |
| Max 64 chars | - | - |

### Plugin Categories

| Category | Description | Examples |
|----------|-------------|----------|
| `@mam/` | Official MAM plugins | `@mam/plugin-yaml` |
| `@community/` | Community plugins | `@community/plugin-redis` |
| Custom | Custom plugins | `my-plugin` |

## Description

The Plugins section defines module extensions:

### 1. Core Plugins

Essential plugins for basic functionality:

```markdown
## Plugins

- @mam/plugin-yaml - YAML parsing support
- @mam/plugin-json - JSON processing
- @mam/plugin-mermaid - Diagram rendering
```

### 2. Runtime Plugins

Runtime-specific plugins:

```markdown
## Plugins

- @mam/plugin-python - Python execution
- @mam/plugin-node - Node.js execution
- @mam/plugin-rust - Rust execution
```

### 3. Storage Plugins

Data storage plugins:

```markdown
## Plugins

- @mam/plugin-redis - Redis cache
- @mam/plugin-postgresql - PostgreSQL database
- @mam/plugin-s3 - AWS S3 storage
```

### 4. Integration Plugins

Third-party integration plugins:

```markdown
## Plugins

- @mam/plugin-slack - Slack notifications
- @mam/plugin-github - GitHub integration
- @mam/plugin-jira - Jira integration
```

### 5. Security Plugins

Security-related plugins:

```markdown
## Plugins

- @mam/plugin-auth - Authentication
- @mam/plugin-oauth - OAuth support
- @mam/plugin-jwt - JWT handling
```

### 6. Monitoring Plugins

Observability plugins:

```markdown
## Plugins

- @mam/plugin-prometheus - Metrics
- @mam/plugin-sentry - Error tracking
- @mam/plugin-logging - Structured logging
```

### 7. Testing Plugins

Testing and validation plugins:

```markdown
## Plugins

- @mam/plugin-pytest - Python testing
- @mam/plugin-jest - JavaScript testing
- @mam/plugin-mock - Mocking support
```

### 8. Optional Plugins

Non-essential plugins:

```markdown
## Plugins

- @mam/plugin-yaml
- @mam/plugin-redis (optional) - Caching layer
- @mam/plugin-s3 (optional) - Cloud storage
```

## Examples

### Basic Module

```markdown
## Plugins

- @mam/plugin-yaml
- @mam/plugin-json
```

### Web Application

```markdown
## Plugins

- @mam/plugin-yaml - Configuration
- @mam/plugin-auth - Authentication
- @mam/plugin-cache - Caching
- @mam/plugin-logging - Logging
```

### Data Pipeline

```markdown
## Plugins

- @mam/plugin-csv - CSV processing
- @mam/plugin-parquet - Parquet support
- @mam/plugin-s3 - S3 storage
- @mam/plugin-redis - Caching
```

### CLI Tool

```markdown
## Plugins

- @mam/plugin-click - CLI framework
- @mam/plugin-rich - Terminal formatting
- @mam/plugin-toml - Config files
```

### API Service

```markdown
## Plugins

- @mam/plugin-fastapi - Web framework
- @mam/plugin-sqlalchemy - Database ORM
- @mam/plugin-pydantic - Validation
- @mam/plugin-jwt - Authentication
```

### Microservice

```markdown
## Plugins

- @mam/plugin-fastapi - Web framework
- @mam/plugin-redis - Cache
- @mam/plugin-postgresql - Database
- @mam/plugin-prometheus - Metrics
- @mam/plugin-sentry - Error tracking
```

### Machine Learning

```markdown
## Plugins

- @mam/plugin-pytorch - Deep learning
- @mam/plugin-numpy - Numerical computing
- @mam/plugin-pandas - Data manipulation
- @mam/plugin-matplotlib - Visualization
```

### DevOps Module

```markdown
## Plugins

- @mam/plugin-docker - Docker integration
- @mam/plugin-kubernetes - K8s support
- @mam/plugin-terraform - Infrastructure
- @mam/plugin-ansible - Configuration
```

## Edge Cases

### 1. Missing Plugins

When required plugins aren't available:

```markdown
## Plugins

- @mam/plugin-required  # Must be installed
```

**Solution**: The runtime should fail with a clear error message.

### 2. Version Conflicts

When plugins have version conflicts:

```markdown
## Plugins

- @mam/plugin-a >= 2.0
- @mam/plugin-b >= 1.0, < 2.0  # Conflicts with plugin-a
```

**Solution**: The plugin resolver should detect conflicts.

### 3. Circular Dependencies

When plugins depend on each other:

```markdown
## Plugins

- @mam/plugin-a
- @mam/plugin-b  # Depends on plugin-a
```

**Solution**: Detect and report circular dependencies.

### 4. Optional vs Required

When plugins are optional:

```markdown
## Plugins

- @mam/plugin-required
- @mam/plugin-optional (optional)
```

**Solution**: Mark optional plugins clearly.

### 5. Platform-Specific

When plugins vary by platform:

```markdown
## Plugins

- @mam/plugin-windows  # Windows only
- @mam/plugin-linux    # Linux only
```

**Solution**: Document platform requirements.

### 6. Deprecated Plugins

When plugins are deprecated:

```markdown
## Plugins

- @mam/plugin-old (deprecated, use @mam/plugin-new)
- @mam/plugin-new
```

**Solution**: Mark as deprecated with alternative.

### 7. Custom Plugins

When using custom plugins:

```markdown
## Plugins

- @mam/plugin-yaml
- my-custom-plugin
```

**Solution**: Document custom plugin sources.

### 8. Plugin Configuration

When plugins need configuration:

```markdown
## Plugins

- @mam/plugin-redis
  - host: localhost
  - port: 6379
```

**Solution**: Document configuration options.

### 9. Plugin Conflicts

When plugins conflict:

```markdown
## Plugins

- @mam/plugin-a
- @mam/plugin-b  # Conflicts with plugin-a
```

**Solution**: Detect and resolve conflicts.

### 10. Plugin Updates

When plugins need updates:

```markdown
## Plugins

- @mam/plugin-old >= 1.0  # Deprecated
- @mam/plugin-new >= 2.0  # Recommended
```

**Solution**: Document migration path.

## Best Practices

### 1. Use Official Plugins

Prefer official `@mam/` plugins:

```markdown
# Bad
yaml-parser

# Good
@mam/plugin-yaml
```

### 2. Specify Versions

Always include version constraints:

```markdown
# Bad
@mam/plugin-yaml

# Good
@mam/plugin-yaml >= 1.0.0
```

### 3. Mark Optional Plugins

Clearly mark non-essential plugins:

```markdown
## Plugins

- @mam/plugin-required
- @mam/plugin-optional (optional)
```

### 4. Document Purpose

Explain what each plugin provides:

```markdown
## Plugins

- @mam/plugin-yaml - YAML parsing support
- @mam/plugin-json - JSON processing
```

### 5. Group Related Plugins

Organize plugins logically:

```markdown
## Plugins

# Core
- @mam/plugin-yaml
- @mam/plugin-json

# Storage
- @mam/plugin-redis
- @mam/plugin-s3
```

### 6. Validate Before Publishing

Ensure all plugins are available.

### 7. Document Configuration

Document plugin configuration options.

### 8. Handle Missing Plugins

Gracefully handle missing plugins.

### 9. Test Plugin Compatibility

Test with all declared plugins.

### 10. Document Migration Paths

When plugins change, document migration.

## Common Patterns

### Pattern 1: Minimal Module

```markdown
## Plugins

- @mam/plugin-yaml
```

### Pattern 2: Web Application

```markdown
## Plugins

- @mam/plugin-fastapi
- @mam/plugin-sqlalchemy
- @mam/plugin-pydantic
- @mam/plugin-jwt
```

### Pattern 3: Data Processing

```markdown
## Plugins

- @mam/plugin-pandas
- @mam/plugin-numpy
- @mam/plugin-scikit-learn
```

### Pattern 4: CLI Tool

```markdown
## Plugins

- @mam/plugin-click
- @mam/plugin-rich
- @mam/plugin-toml
```

### Pattern 5: Microservice

```markdown
## Plugins

- @mam/plugin-fastapi
- @mam/plugin-redis
- @mam/plugin-postgresql
- @mam/plugin-prometheus
```

### Pattern 6: Machine Learning

```markdown
## Plugins

- @mam/plugin-pytorch
- @mam/plugin-numpy
- @mam/plugin-pandas
- @mam/plugin-matplotlib
```

### Pattern 7: DevOps

```markdown
## Plugins

- @mam/plugin-docker
- @mam/plugin-kubernetes
- @mam/plugin-terraform
```

### Pattern 8: Security

```markdown
## Plugins

- @mam/plugin-auth
- @mam/plugin-oauth
- @mam/plugin-jwt
- @mam/plugin-crypto
```

### Pattern 9: Monitoring

```markdown
## Plugins

- @mam/plugin-prometheus
- @mam/plugin-sentry
- @mam/plugin-logging
```

### Pattern 10: Testing

```markdown
## Plugins

- @mam/plugin-pytest
- @mam/plugin-mock
- @mam/plugin-coverage
```

## Validation Rules

### Rule 1: Valid Plugin Names

Plugin names must follow conventions:

```python
import re

def validate_plugin_name(name: str) -> bool:
    # Check for @mam/ prefix
    if name.startswith('@mam/'):
        plugin_name = name[5:]
    elif name.startswith('@community/'):
        plugin_name = name[11:]
    else:
        plugin_name = name
    
    pattern = r'^[a-z][a-z0-9-]{0,63}$'
    return bool(re.match(pattern, plugin_name))
```

### Rule 2: Valid Version Constraints

Version constraints must be valid:

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

Each plugin should be listed once:

```python
def check_duplicates(plugins: list[str]) -> list[str]:
    seen = set()
    duplicates = []
    for plugin in plugins:
        name = plugin.split()[0]
        if name in seen:
            duplicates.append(name)
        seen.add(name)
    return duplicates
```

### Rule 4: Valid Categories

Plugins must use valid categories:

```python
VALID_CATEGORIES = {'@mam/', '@community/'}

def validate_category(plugin: str) -> bool:
    return any(plugin.startswith(cat) for cat in VALID_CATEGORIES) or \
           not plugin.startswith('@')
```

### Rule 5: Version Compatibility

Plugins must be compatible:

```python
def check_compatibility(plugins: list[str]) -> bool:
    # Simplified check
    return True
```

### Rule 6: Required Plugins Present

All required plugins must be available:

```python
def check_required_plugins(plugins: list[str], available: set[str]) -> list[str]:
    missing = []
    for plugin in plugins:
        if '(optional)' not in plugin:
            name = plugin.split()[0]
            if name not in available:
                missing.append(name)
    return missing
```

### Rule 7: Configuration Valid

Plugin configuration must be valid:

```python
def validate_config(config: dict) -> bool:
    # Simplified validation
    return True
```

### Rule 8: No Conflicts

Plugins must not conflict:

```python
def check_conflicts(plugins: list[str]) -> list[str]:
    conflicts = []
    # Simplified conflict detection
    return conflicts
```

## Related Sections

- **[Dependencies](dependencies.md)**: Package dependencies
- **[Capabilities](capabilities.md)**: System capabilities
- **[Permissions](permissions.md)**: Security permissions
- **[Python](python.md)**: Python implementation
- **[JavaScript](javascript.md)**: JavaScript implementation
- **[Tests](tests.md)**: Plugin testing

## FAQ

### Q: What's the difference between Plugins and Dependencies?

**A:** Plugins are MAM-specific extensions. Dependencies are general packages. Plugins extend MAM functionality; dependencies provide code libraries.

### Q: Should I use official plugins?

**A:** Yes, prefer `@mam/` plugins for better compatibility and support.

### Q: How do I specify plugin versions?

**A:** Use version constraints:

```markdown
- @mam/plugin-yaml >= 1.0.0
```

### Q: Can I use custom plugins?

**A:** Yes, but document the source and compatibility.

### Q: How do I mark plugins as optional?

**A:** Use `(optional)` suffix:

```markdown
- @mam/plugin-redis (optional)
```

### Q: What if a plugin is missing?

**A:** The runtime should fail with a clear error message.

### Q: Can plugins have configuration?

**A:** Yes, document configuration options:

```markdown
- @mam/plugin-redis
  - host: localhost
  - port: 6379
```

### Q: How do I handle plugin conflicts?

**A:** Detect and resolve conflicts before execution.

### Q: Can I use multiple versions?

**A:** No, only one version per plugin.

### Q: How do I update plugins?

**A:** Update version constraints and test compatibility.

### Q: Should I document plugin purpose?

**A:** Yes, explain what each plugin provides.

### Q: Can I use plugins from different sources?

**A:** Yes, but document compatibility.

### Q: How do I test plugin compatibility?

**A:** Test with all declared plugins.

### Q: Should I group plugins?

**A:** Yes, organize logically:

```markdown
# Core
- @mam/plugin-yaml

# Storage
- @mam/plugin-redis
```

### Q: Can I use deprecated plugins?

**A:** Avoid deprecated plugins. Document alternatives.

### Q: How do I handle plugin errors?

**A:** Document error handling behavior.

### Q: Should I validate plugins?

**A:** Yes, validate before publishing.

### Q: Can I use plugins in tests?

**A:** Yes, test plugin functionality.

### Q: How do I document plugin changes?

**A:** Document in changelog and version notes.

### Q: Should I include plugins in metadata?

**A:** Yes, plugins should be declared in the Plugins section.

### Q: Can I use plugins dynamically?

**A:** Not directly. Plugins must be declared statically.

### Q: How do I handle plugin updates?

**A:** Update version constraints and test.

### Q: Should I use specific plugin versions?

**A:** Use version constraints for compatibility:

```markdown
- @mam/plugin-yaml >= 1.0.0, < 2.0.0
```

### Q: Can I use plugins without @mam/ prefix?

**A:** Yes, but official plugins use `@mam/` prefix.

### Q: How do I handle plugin dependencies?

**A:** Plugins may have their own dependencies. Let the plugin manager handle them.

### Q: Should I document plugin limitations?

**A:** Yes, document any limitations or restrictions.

## Implementation Notes

### Plugin Extraction

```python
def extract_plugins(content: str) -> list[dict]:
    plugins = []
    in_plugins = False
    
    for line in content.split('\n'):
        if line.strip().startswith('## Plugins'):
            in_plugins = True
            continue
        
        if in_plugins and line.strip().startswith('- '):
            plugin_line = line.strip()[2:]
            parts = plugin_line.split(' - ')
            name = parts[0].strip()
            description = parts[1].strip() if len(parts) > 1 else ''
            
            plugins.append({
                'name': name,
                'description': description,
                'optional': '(optional)' in name
            })
        elif in_plugins and line.startswith('##'):
            break
    
    return plugins
```

### Plugin Validation

```python
def validate_plugins(plugins: list[dict]) -> list[str]:
    errors = []
    
    for plugin in plugins:
        if not validate_plugin_name(plugin['name']):
            errors.append(f"Invalid plugin name: {plugin['name']}")
    
    # Check for duplicates
    names = [p['name'].split()[0] for p in plugins]
    duplicates = [n for n in names if names.count(n) > 1]
    for dup in set(duplicates):
        errors.append(f"Duplicate plugin: {dup}")
    
    return errors
```

### Plugin Documentation Generator

```python
def document_plugins(plugins: list[dict]) -> str:
    docs = "# Required Plugins\n\n"
    
    for plugin in plugins:
        optional = " (optional)" if plugin['optional'] else ""
        docs += f"- `{plugin['name']}`{optional}"
        if plugin['description']:
            docs += f" - {plugin['description']}"
        docs += "\n"
    
    return docs
```

### Plugin Manager

```python
class PluginManager:
    def __init__(self):
        self.plugins = {}
    
    def register(self, name: str, plugin):
        self.plugins[name] = plugin
    
    def get(self, name: str):
        return self.plugins.get(name)
    
    def list_available(self) -> list[str]:
        return list(self.plugins.keys())
```

## References

- [MAM Specification - Plugins](../SPEC.md#plugins)
- [Plugin Architecture](https://en.wikipedia.org/wiki/Plug-in_(computing))
- [MAM Plugin Registry](https://mam.dev/plugins)
- [Plugin Development Guide](https://mam.dev/plugins/development)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable