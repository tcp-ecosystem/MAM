# Imports Section

## Description
The Imports section specifies required imports and dependencies that the module's code blocks need. It declares what modules, packages, and specific symbols must be available for the code to execute correctly. This section is distinct from Dependencies (which lists packages) and Exports (which defines the public API).

The Imports section serves as:
- **Code documentation**: Shows what the code relies on
- **Execution prerequisite**: Ensures imports are available before code runs
- **Dependency verification**: Validates that required packages are installed
- **Type checking**: Provides type information for static analysis

## Syntax

```markdown
## Imports

```python
import module_name
from module_name import symbol
from module_name import symbol1, symbol2
```
```

### Import Formats

#### Python Imports

```python
# Standard library
import os
import sys
from pathlib import Path
from typing import Optional, Dict, Any

# Third-party
import requests
from flask import Flask, request
from sqlalchemy import create_engine

# Local
from . import mymodule
from .utils import helper_function
```

#### JavaScript Imports

```javascript
// ES6 modules
import React from 'react';
import { useState, useEffect } from 'react';
import axios from 'axios';

// CommonJS
const express = require('express');
const { Pool } = require('pg');
```

#### TypeScript Imports

```typescript
import { Component } from '@angular/core';
import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
```

### Import Metadata

Add metadata to imports:

```python
# @mam:install=requests>=2.28.0
import requests

# @mam:optional=redis
import redis
```

## Rules

1. **Required imports only**: Only list imports that are actually used
2. **Complete imports**: Include all necessary imports for code blocks
3. **Standard before third-party**: Order: stdlib, third-party, local
4. **Group imports**: Use blank lines to separate import groups
5. **Specific imports**: Use specific imports when possible
6. **No wildcard imports**: Avoid `from module import *`
7. **Version constraints**: Use metadata for version requirements

### Import Order

Follow PEP 8 import ordering:

```python
# 1. Standard library imports
import os
import sys
from pathlib import Path

# 2. Related third-party imports
import requests
from flask import Flask

# 3. Local application/library specific imports
from . import mymodule
from .utils import helper
```

### Import Style Rules

| Style | Example | When to Use |
|-------|---------|-------------|
| `import module` | `import os` | When using module namespace |
| `from module import name` | `from os import path` | When using specific symbols |
| `from module import name as alias` | `from os import path as p` | When name conflicts |

## Description

The Imports section provides critical information for module execution:

### 1. Standard Library Imports

Python standard library modules:

```python
import os
import sys
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from pathlib import Path
from collections import defaultdict
```

### 2. Third-Party Imports

External packages from PyPI, npm, etc.:

```python
import requests
from flask import Flask, request, jsonify
from sqlalchemy import create_engine, Column, String, Integer
from pydantic import BaseModel, validator
```

### 3. Local Imports

Internal module imports:

```python
from . import auth
from .utils import validate_token, hash_password
from .models import User, Token
from .config import settings
```

### 4. Conditional Imports

Imports that depend on conditions:

```python
import sys

if sys.platform == 'win32':
    import winreg
elif sys.platform == 'darwin':
    import objc
```

### 5. Try/Except Imports

Optional imports with fallbacks:

```python
try:
    import ujson as json
except ImportError:
    import json

try:
    from redis import Redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
```

### 6. Type-Only Imports

Imports used only for type checking:

```python
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import User
    from .database import Database
```

### 7. Import Metadata

Additional import information:

```python
# @mam:install=requests>=2.28.0
import requests

# @mam:optional=redis
import redis

# @mam:platform=win32
import winreg
```

## Examples

### Basic Module

```markdown
## Imports

```python
import os
import json
from typing import Dict, Any

import requests
from pydantic import BaseModel

from . import config
from .utils import validate_response
```
```

### Web Application

```markdown
## Imports

```python
# Standard library
import os
import logging
from datetime import datetime
from typing import Optional

# Third-party
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, validator
from sqlalchemy import create_engine, Column, String, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Local
from .config import settings
from .database import get_db
from .auth import verify_token
```
```

### Data Science

```markdown
## Imports

```python
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import matplotlib.pyplot as plt
import seaborn as sns
```
```

### CLI Tool

```markdown
## Imports

```python
import sys
import click
from rich.console import Console
from rich.table import Table
from rich.progress import Progress
import toml
```
```

### Async Module

```markdown
## Imports

```python
import asyncio
import aiohttp
from aiohttp import web
import asyncpg
from typing import AsyncGenerator
```
```

### Testing

```markdown
## Imports

```python
import pytest
from unittest.mock import Mock, patch, MagicMock
from mymodule import MyClass
from mymodule.utils import helper_function
```
```

### Type Hints

```markdown
## Imports

```python
from __future__ import annotations
from typing import (
    TYPE_CHECKING,
    Any,
    Dict,
    List,
    Optional,
    Tuple,
    Union,
)

if TYPE_CHECKING:
    from .models import User
    from .database import Database
    from .config import Settings
```
```

### Conditional Imports

```markdown
## Imports

```python
import sys
import platform

# Platform-specific imports
if sys.platform == 'win32':
    import winreg
    import msvcrt
elif sys.platform == 'darwin':
    import objc
    import Foundation
else:
    import fcntl
    import termios

# Optional dependencies
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

try:
    import ujson as json
    JSON_LIBRARY = 'ujson'
except ImportError:
    import json
    JSON_LIBRARY = 'json'
```
```

### Complex Application

```markdown
## Imports

```python
# Standard library
import os
import sys
import json
import logging
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Union
from pathlib import Path
from contextlib import contextmanager
from functools import lru_cache

# Third-party
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, validator, Field
from sqlalchemy import create_engine, Column, String, Integer, DateTime, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from redis import Redis
from prometheus_client import Counter, Histogram, Gauge

# Local
from .config import settings
from .database import get_db, engine
from .models import User, Token, APIKey
from .auth import verify_token, create_token, hash_password
from .utils import validate_input, sanitize_output
from .exceptions import AuthenticationError, ValidationError, NotFoundError
```
```

## Edge Cases

### 1. Circular Imports

When modules import each other:

```python
# module_a.py
from module_b import function_b

# module_b.py
from module_a import function_a
```

**Solution**: Use lazy imports or refactor structure.

### 2. Missing Imports

When required packages aren't installed:

```python
import nonexistent_package  # ImportError
```

**Solution**: Use try/except or document in Dependencies.

### 3. Version Conflicts

When imported packages have version conflicts:

```python
# Package A requires requests>=2.28
# Package B requires requests<2.28
import requests
```

**Solution**: Resolve version conflicts or use separate environments.

### 4. Platform-Specific Imports

When imports vary by platform:

```python
import sys

if sys.platform == 'win32':
    import winreg  # Windows only
```

**Solution**: Use conditional imports with documentation.

### 5. Optional Imports

When imports are optional:

```python
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
```

**Solution**: Use try/except with availability flags.

### 6. Import Aliases

When import names conflict:

```python
from module1 import utility as util1
from module2 import utility as util2
```

**Solution**: Use descriptive aliases.

### 7. Wildcard Imports

When using wildcard imports:

```python
from module import *  # Bad practice
```

**Solution**: Use specific imports.

### 8. Circular Dependencies

When modules have circular dependencies:

```python
# A imports B
# B imports C
# C imports A
```

**Solution**: Refactor to break the cycle.

### 9. Import Side Effects

When imports have side effects:

```python
import logging  # Configures logging
import os  # May set environment variables
```

**Solution**: Document side effects in comments.

### 10. Type-Only Imports

When imports are only for type checking:

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import User  # Only imported for type checking
```

**Solution**: Use TYPE_CHECKING guard.

## Best Practices

### 1. Follow PEP 8

Follow Python import conventions:

```python
# Good
import os
import sys

import requests
from flask import Flask

from . import mymodule

# Bad
import os,sys
import requests;from flask import Flask
```

### 2. Use Specific Imports

Import specific symbols when possible:

```python
# Good
from os import path
from typing import Optional

# Bad
import os
import typing
```

### 3. Group Imports

Separate import groups with blank lines:

```python
# Standard library
import os
import sys

# Third-party
import requests

# Local
from . import config
```

### 4. Document Import Requirements

Use metadata for version requirements:

```python
# @mam:install=requests>=2.28.0
import requests
```

### 5. Handle Missing Imports

Use try/except for optional imports:

```python
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
```

### 6. Avoid Wildcard Imports

Never use `from module import *`:

```python
# Bad
from module import *

# Good
from module import specific_function
```

### 7. Use Import Aliases

When names conflict or are long:

```python
import numpy as np
import pandas as pd
from sqlalchemy.orm import Session as DBSession
```

### 8. Document Conditional Imports

Explain why imports are conditional:

```python
# Platform-specific import
import sys
if sys.platform == 'win32':
    import winreg  # Windows registry access
```

### 9. Lazy Imports

Use lazy imports for performance:

```python
def heavy_function():
    import heavy_module  # Import only when needed
    return heavy_module.process()
```

### 10. Type-Only Imports

Use TYPE_CHECKING for type hints only:

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import User  # For type hints only
```

## Common Patterns

### Pattern 1: Standard Application

```python
# Standard library
import os
import sys
import json
import logging
from typing import Optional, Dict, Any

# Third-party
import requests
from flask import Flask, request, jsonify
from pydantic import BaseModel

# Local
from . import config
from .utils import helper
```

### Pattern 2: Web API

```python
# Standard library
import os
import logging
from datetime import datetime
from typing import Optional

# Third-party
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, validator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Local
from .config import settings
from .database import get_db
from .auth import verify_token
```

### Pattern 3: Data Processing

```python
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
import matplotlib.pyplot as plt
```

### Pattern 4: Async Application

```python
import asyncio
import aiohttp
from aiohttp import web
import asyncpg
from typing import AsyncGenerator
```

### Pattern 5: CLI Tool

```python
import sys
import click
from rich.console import Console
from rich.table import Table
import toml
```

### Pattern 6: Testing

```python
import pytest
from unittest.mock import Mock, patch, MagicMock
from mymodule import MyClass
from mymodule.utils import helper
```

### Pattern 7: Type Hints

```python
from __future__ import annotations
from typing import (
    TYPE_CHECKING,
    Any,
    Dict,
    List,
    Optional,
    Union,
)

if TYPE_CHECKING:
    from .models import User
    from .database import Database
```

### Pattern 8: Optional Dependencies

```python
import sys

# Required
import requests
from pydantic import BaseModel

# Optional
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

try:
    import ujson as json
except ImportError:
    import json
```

### Pattern 9: Platform-Specific

```python
import sys
import platform

if sys.platform == 'win32':
    import winreg
elif sys.platform == 'darwin':
    import objc
else:
    import fcntl
```

### Pattern 10: Complex Application

```python
# Standard library
import os
import sys
import json
import logging
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from pathlib import Path
from contextlib import contextmanager
from functools import lru_cache

# Third-party
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, validator
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from redis import Redis

# Local
from .config import settings
from .database import get_db
from .models import User, Token
from .auth import verify_token, create_token
from .utils import validate_input
from .exceptions import AuthError, ValidationError
```

## Validation Rules

### Rule 1: Valid Import Syntax

All imports must be syntactically valid:

```python
import ast

def validate_import_syntax(code: str) -> bool:
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False
```

### Rule 2: No Duplicate Imports

Each module should be imported only once:

```python
def check_duplicate_imports(code: str) -> list[str]:
    imports = []
    duplicates = []
    for line in code.split('\n'):
        line = line.strip()
        if line.startswith('import ') or line.startswith('from '):
            if line in imports:
                duplicates.append(line)
            imports.append(line)
    return duplicates
```

### Rule 3: Required Imports Present

Check that all used modules are imported:

```python
def check_missing_imports(code: str) -> list[str]:
    # Simple heuristic: check for undefined names
    # In practice, use AST analysis
    missing = []
    return missing
```

### Rule 4: Import Order

Validate import ordering follows conventions:

```python
def validate_import_order(code: str) -> bool:
    # Check for stdlib, third-party, local ordering
    return True  # Simplified
```

### Rule 5: No Wildcard Imports

Check for wildcard imports:

```python
def check_wildcard_imports(code: str) -> list[str]:
    wildcards = []
    for line in code.split('\n'):
        if 'import *' in line:
            wildcards.append(line.strip())
    return wildcards
```

## Related Sections

- **[Dependencies](dependencies.md)**: Package requirements
- **[Exports](exports.md)**: Public API definition
- **[Python](python.md)**: Python code blocks
- **[JavaScript](javascript.md)**: JavaScript code blocks
- **[Tests](tests.md)**: Test imports
- **[Capabilities](capabilities.md)**: Runtime capabilities

## FAQ

### Q: What's the difference between Imports and Dependencies?

**A:** Dependencies list *packages* that must be installed. Imports list *code* that must be available within those packages. Dependencies are at package level; imports are at code level.

### Q: Should I list all imports?

**A:** Yes, list all imports used in code blocks. This helps with execution and documentation.

### Q: Can I use wildcard imports?

**A:** No, avoid `from module import *`. Use specific imports for clarity.

### Q: How do I handle optional imports?

**A:** Use try/except:

```python
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
```

### Q: Should I import from __future__?

**A:** Use `from __future__ import annotations` for modern type hints:

```python
from __future__ import annotations
```

### Q: How do I handle platform-specific imports?

**A:** Use conditional imports:

```python
import sys
if sys.platform == 'win32':
    import winreg
```

### Q: Can I use import aliases?

**A:** Yes, especially for long names or conflicts:

```python
import numpy as np
from sqlalchemy.orm import Session as DBSession
```

### Q: Should I document import requirements?

**A:** Yes, use metadata comments:

```python
# @mam:install=requests>=2.28.0
import requests
```

### Q: How do I handle circular imports?

**A:** Refactor to break the cycle, or use lazy imports.

### Q: Can I import inside functions?

**A:** Yes, for performance or conditional imports:

```python
def heavy_function():
    import heavy_module  # Import only when needed
    return heavy_module.process()
```

### Q: Should I use TYPE_CHECKING?

**A:** Yes, for type-only imports:

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import User
```

### Q: How do I handle import errors?

**A:** Use try/except with fallbacks:

```python
try:
    import ujson as json
except ImportError:
    import json
```

### Q: Can I import from relative paths?

**A:** Yes, use relative imports:

```python
from . import mymodule
from .utils import helper
from ..base import BaseClass
```

### Q: Should I group imports?

**A:** Yes, group by: stdlib, third-party, local. Separate with blank lines.

### Q: How do I document import side effects?

**A:** Use comments:

```python
import logging  # Configures root logger
import os  # May set environment variables
```

### Q: Can I use lazy imports?

**A:** Yes, for performance:

```python
def get_redis():
    import redis  # Import only when needed
    return redis.Redis()
```

### Q: Should I import type hints?

**A:** Yes, for better documentation and tooling support.

### Q: How do I handle version conflicts?

**A:** Resolve in Dependencies section or use separate environments.

### Q: Can I import from external URLs?

**A:** Not directly. Use package managers for external dependencies.

### Q: Should I use `import module` or `from module import name`?

**A:** Use `import module` when using module namespace, `from module import name` when using specific symbols.

## Implementation Notes

### Import Extraction

```python
import ast

def extract_imports(code: str) -> list[dict]:
    tree = ast.parse(code)
    imports = []
    
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({
                    'module': alias.name,
                    'alias': alias.asname,
                    'type': 'import'
                })
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                imports.append({
                    'module': node.module,
                    'name': alias.name,
                    'alias': alias.asname,
                    'type': 'from'
                })
    
    return imports
```

### Import Validation

```python
def validate_imports(code: str) -> list[str]:
    errors = []
    imports = extract_imports(code)
    
    # Check for wildcard imports
    for imp in imports:
        if imp.get('name') == '*':
            errors.append(f"Wildcard import from {imp['module']}")
    
    # Check for duplicate imports
    seen = set()
    for imp in imports:
        key = (imp['module'], imp.get('name', ''))
        if key in seen:
            errors.append(f"Duplicate import: {imp}")
        seen.add(key)
    
    return errors
```

### Import Documentation Generator

```python
def document_imports(imports: list[dict]) -> str:
    docs = "# Imports\n\n"
    for imp in imports:
        if imp['type'] == 'import':
            docs += f"- `import {imp['module']}`\n"
        else:
            docs += f"- `from {imp['module']} import {imp['name']}`\n"
    return docs
```

## References

- [MAM Specification - Imports](../SPEC.md#imports)
- [PEP 8 - Imports](https://peps.python.org/pep-0008/#imports)
- [Python Import System](https://docs.python.org/3/reference/import.html)
- [TypeScript Import Documentation](https://www.typescriptlang.org/docs/handbook/modules.html)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable