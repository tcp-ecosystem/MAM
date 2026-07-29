# Python Section

## Description
The Python section contains Python code blocks for execution. It defines executable Python code that runs in a Python runtime environment. This section is critical for modules that need to execute Python code, implement business logic, or provide Python-based functionality.

The Python section supports:
- **Python 3.10+**: Modern Python with type hints
- **Async/Await**: Asynchronous programming
- **Type Annotations**: Static type checking
- **Context Managers**: Resource management
- **Decorators**: Code modification
- **Generators**: Lazy evaluation

## Syntax

```markdown
## Python

```python
def process(input):
    return result
```
```

### Language Identifiers

| Identifier | Runtime | Description |
|------------|---------|-------------|
| `python` | Python 3.10+ | Standard Python |
| `py` | Python 3.10+ | Python shorthand |

### Code Block Format

```markdown
## Python

```python
# @mam:timeout=30s
# @mam:memory=256MB
# @mam:requires=network

def fetch_data(url: str) -> dict:
    import requests
    return requests.get(url).json()
```
```

## Rules

1. **Language identifier**: Must specify language (python, py)
2. **Valid syntax**: Code must be syntactically valid Python
3. **Type hints**: Use type hints for better documentation
4. **Error handling**: Include proper error handling
5. **No secrets**: Never include secrets or API keys
6. **Use metadata**: Use `@mam:` comments for execution hints
7. **Follow PEP 8**: Follow Python style guidelines

### Metadata Comments

```python
# @mam:timeout=30s
# @mam:memory=256MB
# @mam:requires=network
# @mam:requires=redis
# @mam:env=DATABASE_URL
```

### Code Quality Rules

| Rule | Good | Bad |
|------|------|-----|
| Type hints | `def func(x: int) -> str:` | `def func(x):` |
| Docstrings | `"""Process data."""` | (missing) |
| Error handling | `try/except` | (no handling) |
| Constants | `MAX_SIZE = 100` | `max_size = 100` |
| Imports | At top of file | Scattered |

## Description

The Python section provides executable code blocks:

### 1. Basic Functions

Simple Python functions:

```python
def greet(name: str) -> str:
    """Greet a user by name."""
    return f"Hello, {name}!"

def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b
```

### 2. Classes

Object-oriented Python:

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class User:
    """User data class."""
    id: str
    name: str
    email: str
    is_active: bool = True
    
    def deactivate(self) -> None:
        """Deactivate user."""
        self.is_active = False
    
    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'is_active': self.is_active
        }
```

### 3. Async Code

Asynchronous Python:

```python
import asyncio
from typing import AsyncGenerator, List

async def fetch_all(urls: List[str]) -> List[dict]:
    """Fetch data from multiple URLs concurrently."""
    async def fetch_one(url: str) -> dict:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                return await response.json()
    
    tasks = [fetch_one(url) for url in urls]
    return await asyncio.gather(*tasks)

async def stream_data() -> AsyncGenerator[dict, None]:
    """Stream data asynchronously."""
    for i in range(10):
        await asyncio.sleep(0.1)
        yield {'index': i, 'data': f'item_{i}'}
```

### 4. Context Managers

Resource management:

```python
from contextlib import contextmanager
from typing import Generator

@contextmanager
def database_connection(url: str) -> Generator:
    """Context manager for database connections."""
    connection = create_connection(url)
    try:
        yield connection
    finally:
        connection.close()

# Usage
with database_connection("postgresql://localhost/db") as conn:
    result = conn.execute("SELECT * FROM users")
```

### 5. Decorators

Code modification:

```python
from functools import wraps
from typing import Callable, Any
import time

def timer(func: Callable) -> Callable:
    """Decorator to measure execution time."""
    @wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print(f"{func.__name__} took {end - start:.4f} seconds")
        return result
    return wrapper

def retry(max_attempts: int = 3) -> Callable:
    """Decorator to retry on failure."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts - 1:
                        raise
                    time.sleep(2 ** attempt)
        return wrapper
    return decorator
```

### 6. Generators

Lazy evaluation:

```python
from typing import Generator, List, Tuple

def fibonacci() -> Generator[int, None, None]:
    """Generate Fibonacci numbers."""
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

def chunked(iterable: List, size: int) -> Generator[Tuple, None, None]:
    """Yield successive chunks from iterable."""
    for i in range(0, len(iterable), size):
        yield tuple(iterable[i:i + size])
```

### 7. Data Processing

Data manipulation:

```python
from typing import List, Dict, Any
from collections import defaultdict

def group_by(items: List[Dict], key: str) -> Dict[str, List[Dict]]:
    """Group items by key."""
    groups = defaultdict(list)
    for item in items:
        groups[item[key]].append(item)
    return dict(groups)

def flatten(nested: List[List]) -> List:
    """Flatten nested list."""
    return [item for sublist in nested for item in sublist]

def unique_by(items: List[Dict], key: str) -> List[Dict]:
    """Get unique items by key."""
    seen = set()
    result = []
    for item in items:
        value = item[key]
        if value not in seen:
            seen.add(value)
            result.append(item)
    return result
```

### 8. Error Handling

Error patterns:

```python
from typing import Optional, Any
import logging

logger = logging.getLogger(__name__)

class AppError(Exception):
    """Base application error."""
    def __init__(self, message: str, code: str = None):
        super().__init__(message)
        self.code = code

class ValidationError(AppError):
    """Validation error."""
    pass

class NotFoundError(AppError):
    """Not found error."""
    pass

def safe_execute(func, *args, default=None, **kwargs) -> Any:
    """Safely execute function with error handling."""
    try:
        return func(*args, **kwargs)
    except Exception as e:
        logger.error(f"Error executing {func.__name__}: {e}")
        return default
```

### 9. Configuration

Configuration management:

```python
from dataclasses import dataclass
from typing import Optional
import os

@dataclass
class Config:
    """Application configuration."""
    database_url: str
    redis_url: Optional[str] = None
    debug: bool = False
    log_level: str = "INFO"
    
    @classmethod
    def from_env(cls) -> 'Config':
        """Load configuration from environment."""
        return cls(
            database_url=os.getenv("DATABASE_URL", "sqlite:///app.db"),
            redis_url=os.getenv("REDIS_URL"),
            debug=os.getenv("DEBUG", "false").lower() == "true",
            log_level=os.getenv("LOG_LEVEL", "INFO")
        )
    
    def validate(self) -> bool:
        """Validate configuration."""
        if not self.database_url:
            raise ValueError("DATABASE_URL is required")
        return True
```

### 10. Utilities

Common utilities:

```python
from typing import Any, Callable
import hashlib
import secrets
from datetime import datetime, timedelta

def generate_id(length: int = 16) -> str:
    """Generate random ID."""
    return secrets.token_urlsafe(length)

def hash_data(data: str, algorithm: str = "sha256") -> str:
    """Hash data using specified algorithm."""
    h = hashlib.new(algorithm)
    h.update(data.encode())
    return h.hexdigest()

def retry_with_backoff(func: Callable, max_retries: int = 3) -> Any:
    """Execute function with exponential backoff."""
    import time
    
    for attempt in range(max_retries):
        try:
            return func()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

## Examples

### Basic Module

```markdown
## Python

```python
def process(data: dict) -> dict:
    """Process input data."""
    result = {}
    for key, value in data.items():
        if isinstance(value, str):
            result[key] = value.strip()
        elif isinstance(value, (int, float)):
            result[key] = value
    return result
```
```

### API Client

```markdown
## Python

```python
import requests
from typing import Optional, Dict, Any

class APIClient:
    """REST API client."""
    
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers['Authorization'] = f'Bearer {api_key}'
    
    def get(self, path: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        """Make GET request."""
        response = self.session.get(f"{self.base_url}{path}", params=params)
        response.raise_for_status()
        return response.json()
    
    def post(self, path: str, data: Dict) -> Dict[str, Any]:
        """Make POST request."""
        response = self.session.post(f"{self.base_url}{path}", json=data)
        response.raise_for_status()
        return response.json()
```
```

### Data Processing

```markdown
## Python

```python
import pandas as pd
from typing import List, Dict

def process_csv(file_path: str) -> pd.DataFrame:
    """Process CSV file."""
    df = pd.read_csv(file_path)
    
    # Clean data
    df = df.dropna()
    df.columns = [col.lower().replace(' ', '_') for col in df.columns]
    
    return df

def aggregate_data(df: pd.DataFrame, group_by: str, agg_func: str = 'sum') -> pd.DataFrame:
    """Aggregate data by column."""
    return df.groupby(group_by).agg(agg_func).reset_index()
```
```

### CLI Tool

```markdown
## Python

```python
import click
from rich.console import Console
from rich.table import Table

console = Console()

@click.group()
def cli():
    """Command line tool."""
    pass

@cli.command()
@click.argument('name')
def greet(name: str):
    """Greet someone."""
    console.print(f"[bold green]Hello, {name}![/bold green]")

@cli.command()
def list_items():
    """List all items."""
    table = Table(title="Items")
    table.add_column("ID", style="cyan")
    table.add_column("Name", style="magenta")
    
    items = [{"id": 1, "name": "Item 1"}, {"id": 2, "name": "Item 2"}]
    for item in items:
        table.add_row(str(item["id"]), item["name"])
    
    console.print(table)
```
```

### Database Module

```markdown
## Python

```python
from sqlalchemy import create_engine, Column, String, Integer
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Optional, List

Base = declarative_base()

class User(Base):
    """User model."""
    __tablename__ = 'users'
    
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)
    
    def __repr__(self):
        return f"<User(id='{self.id}', name='{self.name}')>"

class Database:
    """Database manager."""
    
    def __init__(self, url: str):
        self.engine = create_engine(url)
        self.SessionLocal = sessionmaker(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
    
    def get_session(self) -> Session:
        """Get database session."""
        return self.SessionLocal()
    
    def get_user(self, user_id: str) -> Optional[User]:
        """Get user by ID."""
        with self.get_session() as session:
            return session.query(User).filter(User.id == user_id).first()
    
    def create_user(self, user_id: str, name: str, email: str) -> User:
        """Create new user."""
        with self.get_session() as session:
            user = User(id=user_id, name=name, email=email)
            session.add(user)
            session.commit()
            return user
```
```

### Machine Learning

```markdown
## Python

```python
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
from typing import Tuple, Dict

class Classifier:
    """Simple classifier wrapper."""
    
    def __init__(self, n_estimators: int = 100):
        self.model = RandomForestClassifier(n_estimators=n_estimators)
    
    def train(self, X: np.ndarray, y: np.ndarray) -> Dict:
        """Train the model."""
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        
        self.model.fit(X_train, y_train)
        predictions = self.model.predict(X_test)
        
        return {
            'accuracy': accuracy_score(y_test, predictions),
            'report': classification_report(y_test, predictions)
        }
    
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Make predictions."""
        return self.model.predict(X)
```
```

### Web Scraping

```markdown
## Python

```python
import requests
from bs4 import BeautifulSoup
from typing import List, Dict, Optional
import time

class WebScraper:
    """Web scraping utility."""
    
    def __init__(self, delay: float = 1.0):
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)'
        })
    
    def fetch(self, url: str) -> Optional[BeautifulSoup]:
        """Fetch and parse URL."""
        try:
            response = self.session.get(url, timeout=10)
            response.raise_for_status()
            time.sleep(self.delay)
            return BeautifulSoup(response.text, 'html.parser')
        except Exception as e:
            print(f"Error fetching {url}: {e}")
            return None
    
    def extract_links(self, soup: BeautifulSoup) -> List[str]:
        """Extract all links from page."""
        return [a['href'] for a in soup.find_all('a', href=True)]
```
```

### Testing

```markdown
## Python

```python
import pytest
from unittest.mock import Mock, patch, MagicMock
from mymodule import MyClass, process_data

class TestMyClass:
    """Test cases for MyClass."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.instance = MyClass()
    
    def test_process_data(self):
        """Test process_data function."""
        result = process_data({"key": "value"})
        assert result == {"key": "value"}
    
    def test_process_data_empty(self):
        """Test process_data with empty input."""
        result = process_data({})
        assert result == {}
    
    @patch('mymodule.external_api')
    def test_with_mock(self, mock_api):
        """Test with mocked external API."""
        mock_api.return_value = {"status": "ok"}
        result = self.instance.call_api()
        assert result["status"] == "ok"
        mock_api.assert_called_once()
```
```

## Edge Cases

### 1. Import Errors

When required packages aren't installed:

```python
import nonexistent_package  # ImportError
```

**Solution**: Use try/except for optional imports:

```python
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
```

### 2. Type Errors

When types don't match:

```python
def add(a: int, b: int) -> int:
    return a + b

add("1", 2)  # Type error
```

**Solution**: Use proper type hints and validation.

### 3. Runtime Errors

When code fails at runtime:

```python
def divide(a: int, b: int) -> float:
    return a / b  # ZeroDivisionError if b == 0
```

**Solution**: Add error handling:

```python
def divide(a: int, b: int) -> float:
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
```

### 4. Memory Issues

When processing large data:

```python
def process_large_file(file_path: str) -> list:
    with open(file_path) as f:
        return [line.strip() for line in f]  # Memory error for large files
```

**Solution**: Use generators:

```python
def process_large_file(file_path: str):
    with open(file_path) as f:
        for line in f:
            yield line.strip()
```

### 5. Concurrency Issues

When multiple threads access shared state:

```python
counter = 0

def increment():
    global counter
    counter += 1  # Not thread-safe
```

**Solution**: Use locks or thread-safe data structures.

### 6. Circular Imports

When modules import each other:

```python
# module_a.py
from module_b import function_b

# module_b.py
from module_a import function_a
```

**Solution**: Refactor to break the cycle.

### 7. Resource Leaks

When resources aren't properly closed:

```python
def read_file(path: str) -> str:
    f = open(path)  # Resource leak
    return f.read()
```

**Solution**: Use context managers:

```python
def read_file(path: str) -> str:
    with open(path) as f:
        return f.read()
```

### 8. Encoding Issues

When handling different encodings:

```python
with open('file.txt') as f:
    content = f.read()  # May fail on non-UTF-8 files
```

**Solution**: Specify encoding:

```python
with open('file.txt', encoding='utf-8') as f:
    content = f.read()
```

### 9. Performance Issues

When code is too slow:

```python
def slow_function(items: list) -> list:
    result = []
    for item in items:
        result.append(transform(item))  # Slow for large lists
    return result
```

**Solution**: Use list comprehensions or optimize.

### 10. Security Issues

When code has vulnerabilities:

```python
def execute_query(query: str) -> list:
    return db.execute(query)  # SQL injection vulnerability
```

**Solution**: Use parameterized queries.

## Best Practices

### 1. Use Type Hints

Always use type hints:

```python
# Bad
def process(data):
    return data

# Good
def process(data: dict) -> dict:
    return data
```

### 2. Write Docstrings

Document functions and classes:

```python
def process_data(data: dict) -> dict:
    """Process input data.
    
    Args:
        data: Input data dictionary
        
    Returns:
        Processed data dictionary
    """
    return data
```

### 3. Handle Errors

Always handle errors:

```python
try:
    result = risky_operation()
except Exception as e:
    logger.error(f"Operation failed: {e}")
    raise
```

### 4. Use Context Managers

Manage resources properly:

```python
with open('file.txt') as f:
    content = f.read()
```

### 5. Follow PEP 8

Follow Python style guidelines.

### 6. Use Constants

Define constants for magic numbers:

```python
# Bad
if retries > 3:

# Good
MAX_RETRIES = 3
if retries > MAX_RETRIES:
```

### 7. Write Tests

Include test cases:

```python
def test_process_data():
    result = process_data({"key": "value"})
    assert result == {"key": "value"}
```

### 8. Use Virtual Environments

Isolate dependencies.

### 9. Document Dependencies

List all required packages.

### 10. Use Linting

Run linters and formatters.

## Common Patterns

### Pattern 1: Simple Function

```python
def process(data: dict) -> dict:
    """Process data."""
    return {k: v.strip() if isinstance(v, str) else v for k, v in data.items()}
```

### Pattern 2: Class with Init

```python
class Processor:
    def __init__(self, config: dict):
        self.config = config
    
    def process(self, data: dict) -> dict:
        return data
```

### Pattern 3: Context Manager

```python
from contextlib import contextmanager

@contextmanager
def managed_resource():
    resource = acquire_resource()
    try:
        yield resource
    finally:
        release_resource(resource)
```

### Pattern 4: Decorator

```python
from functools import wraps

def log_calls(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        print(f"Calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper
```

### Pattern 5: Generator

```python
def fibonacci():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b
```

### Pattern 6: Async Function

```python
async def fetch_data(url: str) -> dict:
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()
```

### Pattern 7: Dataclass

```python
from dataclasses import dataclass

@dataclass
class User:
    id: str
    name: str
    email: str
```

### Pattern 8: Enum

```python
from enum import Enum

class Status(Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
```

### Pattern 9: Exception

```python
class AppError(Exception):
    def __init__(self, message: str, code: str = None):
        super().__init__(message)
        self.code = code
```

### Pattern 10: Configuration

```python
from dataclasses import dataclass
import os

@dataclass
class Config:
    database_url: str
    debug: bool = False
    
    @classmethod
    def from_env(cls):
        return cls(
            database_url=os.getenv("DATABASE_URL"),
            debug=os.getenv("DEBUG", "false").lower() == "true"
        )
```

## Validation Rules

### Rule 1: Valid Python Syntax

Code must be syntactically valid:

```python
import ast

def validate_syntax(code: str) -> bool:
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False
```

### Rule 2: No Secrets

Code must not contain secrets:

```python
def check_secrets(code: str) -> bool:
    secret_patterns = ['password', 'secret', 'token', 'key']
    return not any(p in code.lower() for p in secret_patterns)
```

### Rule 3: Valid Imports

Imports must be valid:

```python
def check_imports(code: str) -> list[str]:
    import ast
    tree = ast.parse(code)
    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
    return imports
```

### Rule 4: Type Hints Present

Functions should have type hints:

```python
def check_type_hints(code: str) -> bool:
    import ast
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            if node.returns is None:
                return False
    return True
```

### Rule 5: Docstrings Present

Functions should have docstrings:

```python
def check_docstrings(code: str) -> bool:
    import ast
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            if not (node.body and isinstance(node.body[0], ast.Expr) and 
                    isinstance(node.body[0].value, ast.Constant)):
                return False
    return True
```

## Related Sections

- **[JavaScript](javascript.md)**: JavaScript code blocks
- **[Imports](imports.md)**: Import declarations
- **[Exports](exports.md)**: Public interface
- **[Dependencies](dependencies.md)**: Package dependencies
- **[Tests](tests.md)**: Test cases
- **[Examples](examples.md)**: Usage examples

## FAQ

### Q: Should I use type hints?

**A:** Yes, type hints improve documentation and enable static analysis.

### Q: What Python version should I target?

**A:** Python 3.10+ is recommended for modern features.

### Q: How do I handle errors?

**A:** Use try/except blocks and log errors appropriately.

### Q: Should I use async/await?

**A:** Use async for I/O-bound operations, sync for CPU-bound.

### Q: How do I document my code?

**A:** Use docstrings for functions and classes.

### Q: Can I use third-party libraries?

**A:** Yes, document them in the Dependencies section.

### Q: How do I handle configuration?

**A:** Use environment variables or configuration files.

### Q: Should I write tests?

**A:** Yes, include tests in the Tests section.

### Q: How do I handle logging?

**A:** Use the logging module and document log levels.

### Q: Can I use decorators?

**A:** Yes, they're useful for cross-cutting concerns.

### Q: How do I handle async code?

**A:** Use async/await syntax and asyncio.

### Q: Should I use dataclasses?

**A:** Yes, for simple data containers.

### Q: How do I handle resource management?

**A:** Use context managers (with statements).

### Q: Can I use generators?

**A:** Yes, for memory-efficient iteration.

### Q: How do I handle concurrency?

**A:** Use threading, multiprocessing, or asyncio as appropriate.

### Q: Should I use type checking?

**A:** Yes, use mypy or pyright for static analysis.

### Q: How do I handle virtual environments?

**A:** Use venv or poetry for dependency isolation.

### Q: Can I use modern Python features?

**A:** Yes, use pattern matching, walrus operator, etc.

### Q: How do I handle security?

**A:** Never hardcode secrets, use environment variables.

### Q: Should I optimize for performance?

**A:** Only when needed. Profile first.

## Implementation Notes

### Code Extraction

```python
import re

def extract_python_blocks(content: str) -> list[str]:
    blocks = []
    pattern = r'```python\n(.*?)```'
    matches = re.findall(pattern, content, re.DOTALL)
    return matches
```

### Syntax Validation

```python
import ast

def validate_python(code: str) -> dict:
    try:
        ast.parse(code)
        return {'valid': True}
    except SyntaxError as e:
        return {'valid': False, 'error': str(e)}
```

### Type Checking

```python
def check_types(code: str) -> list[str]:
    # Use mypy or pyright for actual type checking
    return []
```

## References

- [MAM Specification - Python](../SPEC.md#python)
- [Python Documentation](https://docs.python.org/3/)
- [PEP 8](https://peps.python.org/pep-0008/)
- [Type Hints](https://docs.python.org/3/library/typing.html)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable