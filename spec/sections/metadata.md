# Metadata (Front Matter)

## Description
Metadata is defined in YAML front matter at the top of the module. It provides essential information about the module including its identity, version, authorship, and configuration. This section is critical for module discovery, versioning, dependency resolution, and tooling support.

The metadata serves as:
- **Module identity**: Unique identification of the module
- **Version tracking**: Semantic versioning for releases
- **Authorship**: Attribution and contact information
- **Configuration**: Runtime settings and options
- **Discovery**: Tags and descriptions for search
- **Compatibility**: Specification version requirements

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier |
| version | string | Semantic version |
| name | string | Module name |
| author | string | Module author |
| runtime | string | Primary runtime |

### Field Specifications

#### id

Unique identifier for the module:

```yaml
id: authentication
```

**Rules:**
- Lowercase alphanumeric and hyphens only
- Maximum 64 characters
- Must start with a letter
- No consecutive hyphens
- Pattern: `^[a-z][a-z0-9-]{0,63}$`

**Examples:**
```yaml
# Valid
id: user-auth
id: data-processor
id: api-client

# Invalid
id: User-Auth  # Uppercase
id: 123-starts-with-number
id: has--consecutive-hyphens
```

#### version

Semantic version number:

```yaml
version: 1.0.0
```

**Rules:**
- Must follow Semantic Versioning 2.0.0
- Format: `MAJOR.MINOR.PATCH`
- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (backward compatible)

**Examples:**
```yaml
version: 1.0.0    # Initial release
version: 1.1.0    # New feature
version: 1.1.1    # Bug fix
version: 2.0.0    # Breaking change
```

#### name

Human-readable module name:

```yaml
name: Authentication Module
```

**Rules:**
- Maximum 128 characters
- Can contain any characters
- Should be descriptive
- Title case recommended

#### author

Module author information:

```yaml
author: LifeJiggy
```

**Rules:**
- Maximum 128 characters
- Can contain any characters
- Can include email in angle brackets

**Examples:**
```yaml
author: LifeJiggy
author: John Doe <john@example.com>
author: Acme Corporation
```

#### runtime

Primary runtime environment:

```yaml
runtime: python
```

**Valid Values:**
- `python` - Python runtime
- `javascript` - JavaScript/Node.js runtime
- `typescript` - TypeScript runtime
- `rust` - Rust runtime
- `go` - Go runtime
- `shell` - Shell/Bash runtime
- `mixed` - Multiple runtimes

## Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| tags | string[] | [] | Discovery tags |
| description | string | "" | Module description |
| dependencies | string[] | [] | Module dependencies |
| permissions | string[] | [] | Required permissions |
| license | string | "MIT" | License identifier |
| repository | string | "" | Source repository URL |
| mam_version | string | "1.0.0" | MAM spec version |

### Field Specifications

#### tags

Keywords for module discovery:

```yaml
tags:
  - auth
  - security
  - jwt
```

**Rules:**
- Array of strings
- Maximum 32 tags
- Lowercase recommended
- Maximum 32 characters per tag

#### description

Module description:

```yaml
description: Secure JWT authentication module with refresh tokens
```

**Rules:**
- Maximum 512 characters
- Plain text (no Markdown)
- Should be concise
- First sentence should be summary

#### dependencies

Required modules and packages:

```yaml
dependencies:
  - PyJWT >= 2.8.0
  - cryptography >= 41.0.0
```

**Rules:**
- Array of strings
- Package name and version constraint
- Follows pip/npm syntax

#### permissions

Security permissions required:

```yaml
permissions:
  - network
  - filesystem
```

**Valid Permissions:**
- `network` - HTTP/HTTPS access
- `filesystem` - File read/write access
- `environment` - Environment variable access
- `exec` - Process execution
- `memory` - Large memory allocation

#### license

License identifier:

```yaml
license: MIT
```

**Valid Values:**
- SPDX license identifiers
- Examples: `MIT`, `Apache-2.0`, `GPL-3.0`, `BSD-3-Clause`

#### repository

Source repository URL:

```yaml
repository: https://github.com/user/repo
```

**Rules:**
- Must be valid URL
- HTTPS recommended
- Maximum 256 characters

#### mam_version

MAM specification version:

```yaml
mam_version: 1.0.0
```

**Rules:**
- Must be valid semver
- Indicates spec compatibility
- Default: "1.0.0"

## Syntax

```markdown
---
id: module-id
version: 1.0.0
name: Module Name
author: Author Name
runtime: python
tags:
  - tag1
  - tag2
description: Module description
dependencies:
  - package >= 1.0.0
permissions:
  - network
license: MIT
repository: https://github.com/user/repo
mam_version: 1.0.0
---
```

### YAML Format Rules

1. **Delimiters**: Must start and end with `---`
2. **Indentation**: Use 2 spaces for indentation
3. **Strings**: Quote strings containing special characters
4. **Arrays**: Use `-` for array items
5. **Null values**: Use `null` or omit field

## Rules

1. **Must be present**: Every MAM module must have front matter
2. **Must be first**: Front matter must be the first content
3. **YAML format**: Must be valid YAML
4. **Required fields**: All required fields must be present
5. **Valid values**: All values must be valid for their field
6. **No secrets**: Never include secrets or credentials
7. **Consistent versioning**: Version must follow semver

### Validation Rules

| Rule | Description | Error Level |
|------|-------------|-------------|
| Required fields | All required fields must be present | Error |
| Valid ID | Must match pattern `^[a-z][a-z0-9-]{0,63}$` | Error |
| Valid version | Must be valid semver | Error |
| Valid runtime | Must be from valid runtime list | Error |
| Valid permissions | Must be from valid permission list | Warning |
| Valid license | Must be SPDX identifier | Warning |
| Valid URL | Repository must be valid URL | Error |

## Description

The metadata section provides essential module information:

### 1. Basic Module

Simple module metadata:

```yaml
---
id: hello-world
version: 1.0.0
name: Hello World
author: Developer
runtime: python
---
```

### 2. Complete Module

Full metadata with all fields:

```yaml
---
id: authentication
version: 2.1.0
name: Authentication Module
author: LifeJiggy
runtime: python
tags:
  - auth
  - security
  - jwt
  - tokens
description: Secure JWT authentication with refresh tokens and multi-factor support
dependencies:
  - PyJWT >= 2.8.0
  - cryptography >= 41.0.0
  - python-dateutil >= 2.8.0
permissions:
  - network
  - filesystem
license: MIT
repository: https://github.com/example/auth-module
mam_version: 1.0.0
---
```

### 3. Multi-Runtime Module

Module supporting multiple runtimes:

```yaml
---
id: api-client
version: 1.0.0
name: API Client
author: Team Name
runtime: mixed
tags:
  - api
  - http
  - client
description: REST API client supporting Python and JavaScript
dependencies:
  - requests >= 2.28.0
  - axios >= 1.4.0
permissions:
  - network
license: Apache-2.0
---
```

### 4. Configuration Module

Module for configuration management:

```yaml
---
id: config-manager
version: 1.2.0
name: Configuration Manager
author: DevOps Team
runtime: python
tags:
  - config
  - settings
  - environment
description: Manage application configuration from multiple sources
dependencies:
  - pyyaml >= 6.0
  - python-dotenv >= 1.0.0
permissions:
  - filesystem
  - environment
license: MIT
---
```

### 5. Data Processing Module

Module for data processing:

```yaml
---
id: data-processor
version: 1.0.0
name: Data Processor
author: Data Team
runtime: python
tags:
  - data
  - processing
  - etl
  - pipeline
description: Process and transform data from multiple sources
dependencies:
  - pandas >= 2.0.0
  - numpy >= 1.24.0
  - scikit-learn >= 1.3.0
permissions:
  - filesystem
  - memory
license: MIT
---
```

### 6. Web Scraping Module

Module for web scraping:

```yaml
---
id: web-scraper
version: 1.0.0
name: Web Scraper
author: Data Team
runtime: python
tags:
  - web
  - scraping
  - crawling
  - data-collection
description: Scrape and extract data from websites
dependencies:
  - requests >= 2.28.0
  - beautifulsoup4 >= 4.12.0
  - scrapy >= 2.11.0
permissions:
  - network
  - filesystem
license: MIT
---
```

### 7. CLI Tool Module

Module for command-line tools:

```yaml
---
id: cli-toolkit
version: 1.0.0
name: CLI Toolkit
author: Developer
runtime: python
tags:
  - cli
  - command-line
  - terminal
  - tools
description: Collection of command-line utilities
dependencies:
  - click >= 8.1.0
  - rich >= 13.0.0
permissions:
  - filesystem
license: MIT
---
```

### 8. Microservice Module

Module for microservices:

```yaml
---
id: user-service
version: 1.0.0
name: User Service
author: Platform Team
runtime: python
tags:
  - microservice
  - api
  - users
  - rest
description: User management microservice
dependencies:
  - fastapi >= 0.100.0
  - uvicorn >= 0.23.0
  - sqlalchemy >= 1.4.0
  - alembic >= 1.11.0
permissions:
  - network
  - filesystem
license: MIT
repository: https://github.com/company/user-service
---
```

## Examples

### Minimal Metadata

```yaml
---
id: minimal
version: 1.0.0
name: Minimal Module
author: Author
runtime: python
---
```

### Complete Metadata

```yaml
---
id: full-featured
version: 2.0.0
name: Full Featured Module
author: LifeJiggy <lifejiggy@example.com>
runtime: python
tags:
  - comprehensive
  - feature-rich
  - production-ready
description: A comprehensive module with all features enabled
dependencies:
  - fastapi >= 0.100.0
  - uvicorn >= 0.23.0
  - pydantic >= 2.0
  - sqlalchemy >= 1.4.0
permissions:
  - network
  - filesystem
  - environment
license: Apache-2.0
repository: https://github.com/example/full-featured
mam_version: 1.0.0
---
```

### Python Module

```yaml
---
id: python-toolkit
version: 1.0.0
name: Python Toolkit
author: Python Developer
runtime: python
tags:
  - python
  - toolkit
  - utilities
description: Collection of Python utility functions
dependencies:
  - requests >= 2.28.0
  - pydantic >= 2.0
permissions:
  - network
license: MIT
---
```

### JavaScript Module

```yaml
---
id: js-utils
version: 1.0.0
name: JavaScript Utilities
author: JS Developer
runtime: javascript
tags:
  - javascript
  - utilities
  - helpers
description: JavaScript utility functions
dependencies:
  - lodash >= 4.17.0
  - axios >= 1.4.0
permissions:
  - network
license: MIT
---
```

### TypeScript Module

```yaml
---
id: ts-api-client
version: 1.0.0
name: TypeScript API Client
author: TS Developer
runtime: typescript
tags:
  - typescript
  - api
  - client
description: Type-safe API client
dependencies:
  - axios >= 1.4.0
  - zod >= 3.22.0
permissions:
  - network
license: MIT
---
```

### Rust Module

```yaml
---
id: rust-cli
version: 1.0.0
name: Rust CLI Tool
author: Rust Developer
runtime: rust
tags:
  - rust
  - cli
  - performance
description: High-performance CLI tool
dependencies:
  - clap >= 4.0
  - serde >= 1.0
permissions:
  - filesystem
license: MIT
---
```

### Go Module

```yaml
---
id: go-service
version: 1.0.0
name: Go Microservice
author: Go Developer
runtime: go
tags:
  - go
  - microservice
  - api
description: Go microservice
dependencies:
  - gin >= 1.9.0
  - gorm >= 1.25.0
permissions:
  - network
  - filesystem
license: MIT
---
```

### Mixed Runtime Module

```yaml
---
id: cross-platform
version: 1.0.0
name: Cross-Platform Module
author: Platform Team
runtime: mixed
tags:
  - cross-platform
  - multi-runtime
  - universal
description: Works with Python, JavaScript, and Rust
dependencies:
  - requests >= 2.28.0
  - axios >= 1.4.0
  - reqwest >= 0.11
permissions:
  - network
license: MIT
---
```

## Edge Cases

### 1. Invalid ID Format

When ID doesn't match pattern:

```yaml
# Invalid
id: User-Auth  # Uppercase
id: 123-starts-with-number
id: has spaces
id: has--consecutive-hyphens

# Valid
id: user-auth
id: auth-123
id: my-module
```

### 2. Version Conflicts

When version doesn't follow semver:

```yaml
# Invalid
version: 1.0  # Missing patch
version: v1.0.0  # Has 'v' prefix
version: 1.0.0-beta  # Pre-release without proper format

# Valid
version: 1.0.0
version: 1.0.0-beta.1
version: 1.0.0-alpha.1
```

### 3. Missing Required Fields

When required fields are missing:

```yaml
# Invalid - missing id
---
version: 1.0.0
name: Module
author: Author
runtime: python
---

# Invalid - missing version
---
id: module
name: Module
author: Author
runtime: python
---
```

### 4. Invalid Runtime

When runtime is not in valid list:

```yaml
# Invalid
runtime: python3  # Not a valid runtime
runtime: nodejs   # Should be 'javascript'

# Valid
runtime: python
runtime: javascript
runtime: typescript
```

### 5. Invalid Permissions

When permissions are not valid:

```yaml
# Invalid
permissions:
  - internet  # Should be 'network'
  - files     # Should be 'filesystem'

# Valid
permissions:
  - network
  - filesystem
```

### 6. Duplicate Tags

When tags are duplicated:

```yaml
# Invalid
tags:
  - auth
  - security
  - auth  # Duplicate

# Valid
tags:
  - auth
  - security
  - jwt
```

### 7. Empty Description

When description is empty:

```yaml
# Invalid
description:  # Empty

# Valid
description: Module description here
```

### 8. Invalid License

When license is not SPDX:

```yaml
# Invalid
license: Custom License

# Valid
license: MIT
license: Apache-2.0
license: GPL-3.0
```

### 9. Invalid Repository URL

When repository is not a valid URL:

```yaml
# Invalid
repository: not-a-url
repository: ftp://invalid-protocol.com

# Valid
repository: https://github.com/user/repo
repository: git@github.com:user/repo.git
```

### 10. YAML Syntax Errors

When YAML is malformed:

```yaml
# Invalid
---
id: module
version: 1.0.0
name: Module
  author: Author  # Wrong indentation
runtime: python
---

# Valid
---
id: module
version: 1.0.0
name: Module
author: Author
runtime: python
---
```

## Best Practices

### 1. Use Descriptive IDs

Choose meaningful IDs:

```yaml
# Bad
id: mod1
id: util

# Good
id: user-authentication
id: data-processor
id: api-client
```

### 2. Follow Semantic Versioning

Always use proper semver:

```yaml
# Bad
version: 1.0
version: v1.0.0

# Good
version: 1.0.0
```

### 3. Write Clear Descriptions

Make descriptions informative:

```yaml
# Bad
description: A module

# Good
description: Secure JWT authentication with refresh tokens and MFA support
```

### 4. Use Relevant Tags

Choose tags for discoverability:

```yaml
# Bad
tags:
  - stuff
  - things

# Good
tags:
  - authentication
  - jwt
  - security
  - tokens
```

### 5. Document Dependencies

Include all dependencies:

```yaml
dependencies:
  - PyJWT >= 2.8.0
  - cryptography >= 41.0.0
  - python-dateutil >= 2.8.0
```

### 6. Request Only Needed Permissions

Only request necessary permissions:

```yaml
# Bad
permissions:
  - network
  - filesystem
  - environment
  - exec

# Good (if only network needed)
permissions:
  - network
```

### 7. Use SPDX Licenses

Use standard license identifiers:

```yaml
# Bad
license: Custom License

# Good
license: MIT
```

### 8. Include Repository URL

Always include repository for source code:

```yaml
repository: https://github.com/user/repo
```

### 9. Keep Metadata Updated

Update metadata with releases.

### 10. Validate Before Publishing

Always validate metadata before publishing.

## Common Patterns

### Pattern 1: Minimal Module

```yaml
---
id: minimal-module
version: 1.0.0
name: Minimal Module
author: Author
runtime: python
---
```

### Pattern 2: Library Module

```yaml
---
id: utility-library
version: 1.0.0
name: Utility Library
author: Author
runtime: python
tags:
  - utilities
  - helpers
description: Common utility functions
dependencies:
  - pydantic >= 2.0
license: MIT
---
```

### Pattern 3: API Module

```yaml
---
id: api-service
version: 1.0.0
name: API Service
author: Team
runtime: python
tags:
  - api
  - rest
  - web-service
description: REST API service
dependencies:
  - fastapi >= 0.100.0
  - uvicorn >= 0.23.0
permissions:
  - network
license: MIT
---
```

### Pattern 4: CLI Module

```yaml
---
id: cli-tool
version: 1.0.0
name: CLI Tool
author: Author
runtime: python
tags:
  - cli
  - command-line
description: Command-line utility
dependencies:
  - click >= 8.1.0
  - rich >= 13.0.0
permissions:
  - filesystem
license: MIT
---
```

### Pattern 5: Data Module

```yaml
---
id: data-processor
version: 1.0.0
name: Data Processor
author: Data Team
runtime: python
tags:
  - data
  - processing
  - etl
description: Data processing pipeline
dependencies:
  - pandas >= 2.0.0
  - numpy >= 1.24.0
permissions:
  - filesystem
  - memory
license: MIT
---
```

### Pattern 6: Security Module

```yaml
---
id: security-tools
version: 1.0.0
name: Security Tools
author: Security Team
runtime: python
tags:
  - security
  - authentication
  - encryption
description: Security utilities
dependencies:
  - cryptography >= 41.0.0
  - PyJWT >= 2.8.0
permissions:
  - filesystem
license: MIT
---
```

### Pattern 7: Integration Module

```yaml
---
id: third-party-integration
version: 1.0.0
name: Third-Party Integration
author: Integration Team
runtime: python
tags:
  - integration
  - third-party
  - api
description: Third-party service integration
dependencies:
  - requests >= 2.28.0
permissions:
  - network
license: MIT
---
```

### Pattern 8: Multi-Runtime Module

```yaml
---
id: cross-platform-module
version: 1.0.0
name: Cross-Platform Module
author: Platform Team
runtime: mixed
tags:
  - cross-platform
  - universal
description: Works with multiple runtimes
dependencies:
  - requests >= 2.28.0
  - axios >= 1.4.0
permissions:
  - network
license: MIT
---
```

### Pattern 9: Enterprise Module

```yaml
---
id: enterprise-module
version: 1.0.0
name: Enterprise Module
author: Enterprise Team
runtime: python
tags:
  - enterprise
  - production-ready
  - scalable
description: Enterprise-grade module
dependencies:
  - fastapi >= 0.100.0
  - sqlalchemy >= 1.4.0
  - redis >= 4.0
permissions:
  - network
  - filesystem
license: Apache-2.0
repository: https://github.com/enterprise/module
---
```

### Pattern 10: Plugin Module

```yaml
---
id: plugin-module
version: 1.0.0
name: Plugin Module
author: Plugin Author
runtime: python
tags:
  - plugin
  - extension
  - addon
description: Plugin for main application
dependencies:
  - main-app >= 2.0.0
license: MIT
---
```

## Validation Rules

### Rule 1: Valid YAML

Front matter must be valid YAML:

```python
import yaml

def validate_yaml(content: str) -> bool:
    try:
        yaml.safe_load(content)
        return True
    except yaml.YAMLError:
        return False
```

### Rule 2: Required Fields

All required fields must be present:

```python
REQUIRED_FIELDS = ['id', 'version', 'name', 'author', 'runtime']

def validate_required(data: dict) -> list[str]:
    missing = [field for field in REQUIRED_FIELDS if field not in data]
    return missing
```

### Rule 3: Valid ID

ID must match pattern:

```python
import re

def validate_id(id: str) -> bool:
    pattern = r'^[a-z][a-z0-9-]{0,63}$'
    return bool(re.match(pattern, id))
```

### Rule 4: Valid Version

Version must be valid semver:

```python
from packaging.version import Version

def validate_version(version: str) -> bool:
    try:
        Version(version)
        return True
    except:
        return False
```

### Rule 5: Valid Runtime

Runtime must be from valid list:

```python
VALID_RUNTIMES = {'python', 'javascript', 'typescript', 'rust', 'go', 'shell', 'mixed'}

def validate_runtime(runtime: str) -> bool:
    return runtime in VALID_RUNTIMES
```

### Rule 6: Valid Permissions

Permissions must be from valid list:

```python
VALID_PERMISSIONS = {'network', 'filesystem', 'environment', 'exec', 'memory'}

def validate_permissions(permissions: list[str]) -> bool:
    return all(p in VALID_PERMISSIONS for p in permissions)
```

### Rule 7: Valid License

License must be SPDX identifier:

```python
def validate_license(license: str) -> bool:
    # Simplified check
    valid = {'MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause'}
    return license in valid
```

### Rule 8: Valid URL

Repository must be valid URL:

```python
from urllib.parse import urlparse

def validate_url(url: str) -> bool:
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except:
        return False
```

## Related Sections

- **[Purpose](purpose.md)**: Module purpose
- **[Dependencies](dependencies.md)**: Module dependencies
- **[Permissions](permissions.md)**: Security permissions
- **[Capabilities](capabilities.md)**: System capabilities
- **[Exports](exports.md)**: Public interface
- **[Tests](tests.md)**: Validation tests

## FAQ

### Q: What's the difference between id and name?

**A:** `id` is a machine-readable unique identifier (lowercase, hyphens). `name` is a human-readable display name (can have spaces, mixed case).

### Q: Can I change the id after publishing?

**A:** No, the id should be stable. Changing it would break references.

### Q: How do I version my module?

**A:** Use semantic versioning:

```yaml
version: MAJOR.MINOR.PATCH
```

- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

### Q: Can I use uppercase in id?

**A:** No, ids must be lowercase: `^[a-z][a-z0-9-]{0,63}$`

### Q: How many tags should I include?

**A:** 3-10 relevant tags for discoverability.

### Q: Should I include all dependencies?

**A:** Yes, list all direct dependencies with version constraints.

### Q: Can I use custom permissions?

**A:** Use standard permissions when possible. Custom permissions should be documented.

### Q: How do I handle pre-release versions?

**A:** Use semver pre-release syntax:

```yaml
version: 1.0.0-beta.1
version: 1.0.0-alpha.1
```

### Q: Can I have multiple runtimes?

**A:** Yes, use `runtime: mixed` and document in description.

### Q: Should I include repository URL?

**A:** Yes, always include for source code access.

### Q: How do I validate my metadata?

**A:** Use MAM validation tools or check against this specification.

### Q: Can I use Markdown in description?

**A:** No, description should be plain text.

### Q: What if I don't need permissions?

**A:** Omit the permissions field or use empty array.

### Q: How do I update metadata?

**A:** Update version and relevant fields, then republish.

### Q: Can I use special characters in name?

**A:** Yes, name can contain any characters.

### Q: Should I quote strings with special characters?

**A:** Yes, in YAML:

```yaml
name: "Module: Special Characters"
```

### Q: How do I handle multiple authors?

**A:** Use a single author field with names separated by commas.

### Q: Can I use environment variables in metadata?

**A:** No, metadata must be static YAML.

### Q: How do I handle platform-specific modules?

**A:** Use tags or document in description.

### Q: Should I include mam_version?

**A:** Yes, to specify which MAM version you're targeting.

### Q: Can I have empty tags?

**A:** Yes, but include relevant tags for discoverability.

## Implementation Notes

### Metadata Extraction

```python
import yaml

def extract_metadata(content: str) -> dict:
    if not content.startswith('---'):
        return {}
    
    end = content.find('---', 3)
    if end == -1:
        return {}
    
    yaml_content = content[3:end]
    return yaml.safe_load(yaml_content)
```

### Metadata Validation

```python
def validate_metadata(metadata: dict) -> list[str]:
    errors = []
    
    # Check required fields
    required = ['id', 'version', 'name', 'author', 'runtime']
    for field in required:
        if field not in metadata:
            errors.append(f"Missing required field: {field}")
    
    # Validate id
    if 'id' in metadata and not validate_id(metadata['id']):
        errors.append(f"Invalid id: {metadata['id']}")
    
    # Validate version
    if 'version' in metadata and not validate_version(metadata['version']):
        errors.append(f"Invalid version: {metadata['version']}")
    
    return errors
```

### Metadata Documentation Generator

```python
def document_metadata(metadata: dict) -> str:
    docs = "# Module Metadata\n\n"
    
    for key, value in metadata.items():
        docs += f"- **{key}**: {value}\n"
    
    return docs
```

## References

- [MAM Specification - Metadata](../SPEC.md#metadata)
- [YAML Specification](https://yaml.org/)
- [Semantic Versioning](https://semver.org/)
- [SPDX License List](https://spdx.org/licenses/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable