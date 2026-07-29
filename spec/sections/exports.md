# Exports Section

## Description
The Exports section defines the public interface of the module. It declares what classes, functions, variables, and types are available for external use. This section serves as the module's API contract, specifying what consumers can import and use.

The Exports section is critical for:
- **API Documentation**: Clearly defines the public surface area
- **Encapsulation**: Distinguishes public from private implementation
- **Type Safety**: Provides type information for static analysis
- **Tooling Support**: Enables IDE autocompletion and documentation
- **Module Discovery**: Helps tools understand module capabilities

## Syntax

```markdown
## Exports

- `ClassName` - Class description
- `function_name` - Function description
- `CONSTANT_NAME` - Constant description
- `TypeName` - Type alias description
```

### Export Format

Each export follows the pattern:

```
- `name` - Description
```

Or with additional metadata:

```
- `name` (type) - Description
```

### Advanced Export Syntax

```markdown
## Exports

# Classes
- `Authenticator` - Main authentication class
- `TokenManager` - JWT token management

# Functions
- `verify_token(token: str) -> bool` - Verify JWT token
- `hash_password(password: str) -> str` - Hash password

# Constants
- `DEFAULT_TIMEOUT` - Default timeout in seconds
- `API_VERSION` - API version string

# Types
- `UserDict` - User data dictionary type
- `TokenPair` - Access/refresh token pair
```

## Rules

1. **Public only**: Only export public API, not internal implementation
2. **Clear naming**: Use descriptive names that follow language conventions
3. **Complete documentation**: Each export must have a description
4. **Type information**: Include type signatures when possible
5. **Consistent formatting**: Follow consistent format for all exports
6. **No duplicates**: Each export should be listed only once
7. **Alphabetical ordering**: Optional but recommended for readability

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Classes | PascalCase | `Authenticator` |
| Functions | snake_case | `verify_token` |
| Constants | UPPER_SNAKE_CASE | `DEFAULT_TIMEOUT` |
| Types | PascalCase | `UserDict` |
| Variables | snake_case | `api_version` |

### Type Annotations

Include type annotations for better documentation:

```markdown
- `verify_token(token: str, secret: str) -> bool` - Verify JWT token
- `hash_password(password: str, salt: bytes = None) -> str` - Hash password
- `UserDict = Dict[str, Any]` - User data dictionary type
```

## Description

The Exports section serves as the module's public API contract. It defines:

### 1. Classes

Classes are the primary building blocks:

```markdown
## Exports

- `Authenticator` - Handles JWT authentication
- `TokenManager` - Manages token lifecycle
- `PermissionChecker` - Checks user permissions
```

### 2. Functions

Functions provide specific functionality:

```markdown
## Exports

- `verify_token(token: str) -> bool` - Verify token validity
- `hash_password(password: str) -> str` - Hash password securely
- `generate_salt() -> bytes` - Generate random salt
```

### 3. Constants

Constants define fixed values:

```markdown
## Exports

- `DEFAULT_TIMEOUT` - Default timeout (30 seconds)
- `MAX_RETRY_ATTEMPTS` - Maximum retry attempts (3)
- `API_VERSION` - API version string ("1.0.0")
```

### 4. Type Aliases

Type aliases simplify complex types:

```markdown
## Exports

- `UserDict = Dict[str, Any]` - User data dictionary
- `TokenPair = Tuple[str, str]` - Access/refresh token pair
- `Callback = Callable[[Event], None]` - Event callback type
```

### 5. Enums

Enums define named constants:

```markdown
## Exports

- `UserRole` - User role enumeration (ADMIN, USER, GUEST)
- `TokenStatus` - Token status (ACTIVE, EXPIRED, REVOKED)
```

### 6. Exceptions

Exceptions define error types:

```markdown
## Exports

- `AuthenticationError` - Authentication failure
- `TokenExpiredError` - Token has expired
- `PermissionDeniedError` - Insufficient permissions
```

## Examples

### Authentication Module

```markdown
## Exports

# Classes
- `Authenticator` - Main authentication class
- `JWTManager` - JWT token management
- `PasswordHasher` - Password hashing utilities

# Functions
- `verify_token(token: str, secret: str) -> bool` - Verify JWT token
- `hash_password(password: str) -> str` - Hash password with bcrypt
- `check_password(password: str, hashed: str) -> bool` - Check password against hash
- `generate_secret(length: int = 32) -> str` - Generate random secret

# Constants
- `DEFAULT_ALGORITHM` - JWT algorithm (HS256)
- `TOKEN_EXPIRY` - Default token expiry (3600 seconds)

# Types
- `Claims = Dict[str, Any]` - JWT claims dictionary
- `TokenPair = Tuple[str, str]` - Access/refresh token pair

# Exceptions
- `AuthenticationError` - Authentication failure
- `TokenExpiredError` - Token has expired
```

### API Client Module

```markdown
## Exports

# Classes
- `APIClient` - REST API client
- `RequestBuilder` - HTTP request builder
- `ResponseParser` - HTTP response parser

# Functions
- `create_client(base_url: str, api_key: str) -> APIClient` - Create API client
- `build_request(method: str, path: str) -> RequestBuilder` - Build HTTP request
- `parse_response(response: Response) -> dict` - Parse HTTP response

# Constants
- `DEFAULT_TIMEOUT` - Default timeout (30 seconds)
- `MAX_RETRIES` - Maximum retry attempts (3)
- `API_VERSION` - API version ("v1")

# Types
- `RequestMethod = Literal["GET", "POST", "PUT", "DELETE"]` - HTTP methods
- `Headers = Dict[str, str]` - HTTP headers type
- `QueryParams = Dict[str, Union[str, int, float]]` - Query parameters

# Exceptions
- `APIError` - API request error
- `ConnectionError` - Connection failure
- `TimeoutError` - Request timeout
- `RateLimitError` - Rate limit exceeded
```

### Data Processing Module

```markdown
## Exports

# Classes
- `DataFrame` - Data frame wrapper
- `Series` - Data series wrapper
- `Processor` - Data processor

# Functions
- `read_csv(path: str) -> DataFrame` - Read CSV file
- `read_json(path: str) -> DataFrame` - Read JSON file
- `write_csv(df: DataFrame, path: str) -> None` - Write CSV file
- `merge(left: DataFrame, right: DataFrame, on: str) -> DataFrame` - Merge data frames
- `aggregate(df: DataFrame, group_by: str, agg_func: str) -> DataFrame` - Aggregate data

# Constants
- `SUPPORTED_FORMATS` - Supported file formats
- `DEFAULT_ENCODING` - Default file encoding (utf-8)

# Types
- `Column = str` - Column name type
- `AggFunction = Literal["sum", "mean", "count", "min", "max"]` - Aggregation functions
- `DataFrameDict = Dict[str, List[Any]]` - DataFrame as dictionary

# Exceptions
- `FileNotFoundError` - File not found
- `ValidationError` - Data validation error
- `FormatError` - Unsupported file format
```

### Webhook Module

```markdown
## Exports

# Classes
- `WebhookHandler` - Webhook request handler
- `WebhookVerifier` - Webhook signature verifier
- `WebhookDispatcher` - Event dispatcher

# Functions
- `verify_signature(payload: bytes, signature: str, secret: str) -> bool` - Verify webhook signature
- `parse_event(payload: str) -> Event` - Parse webhook event
- `dispatch_event(event: Event) -> None` - Dispatch event to handlers

# Constants
- `SIGNATURE_HEADER` - Signature header name
- `DEFAULT_TOLERANCE` - Timestamp tolerance (300 seconds)

# Types
- `Event = Dict[str, Any]` - Webhook event type
- `EventHandler = Callable[[Event], None]` - Event handler type
- `Signature = str` - Webhook signature type

# Exceptions
- `SignatureError` - Invalid signature
- `EventError` - Invalid event format
- `DispatchError` - Event dispatch failure
```

### Cache Module

```markdown
## Exports

# Classes
- `Cache` - Cache interface
- `RedisCache` - Redis cache implementation
- `MemoryCache` - In-memory cache implementation

# Functions
- `create_cache(backend: str, **kwargs) -> Cache` - Create cache instance
- `cache_key(*args, **kwargs) -> str` - Generate cache key
- `serialize(value: Any) -> bytes` - Serialize value
- `deserialize(data: bytes) -> Any` - Deserialize value

# Constants
- `DEFAULT_TTL` - Default time-to-live (3600 seconds)
- `MAX_KEY_LENGTH` - Maximum key length (250 characters)

# Types
- `CacheKey = str` - Cache key type
- `CacheValue = Any` - Cache value type
- `TTL = int` - Time-to-live type

# Exceptions
- `CacheError` - Cache operation error
- `KeyError` - Cache key not found
- `ConnectionError` - Cache connection error
```

### Database Module

```markdown
## Exports

# Classes
- `Database` - Database connection
- `Model` - Base model class
- `Query` - Query builder

# Functions
- `connect(url: str) -> Database` - Connect to database
- `create_table(model: Model) -> None` - Create database table
- `drop_table(model: Model) -> None` - Drop database table
- `migrate(version: str) -> None` - Run database migration

# Constants
- `DEFAULT_POOL_SIZE` - Connection pool size (5)
- `DEFAULT_TIMEOUT` - Query timeout (30 seconds)

# Types
- `TableName = str` - Table name type
- `Column = Dict[str, Any]` - Column definition
- `Row = Dict[str, Any]` - Database row type

# Exceptions
- `DatabaseError` - Database operation error
- `ConnectionError` - Connection failure
- `QueryError` - Query execution error
- `MigrationError` - Migration failure
```

## Edge Cases

### 1. Exporting Private Implementation

Don't export internal implementation details:

```markdown
## Exports

# Bad: Exporting internal class
- `_InternalAuth` - Internal authentication class

# Good: Only export public API
- `Authenticator` - Public authentication class
```

### 2. Circular Dependencies

When exports create circular dependencies:

```markdown
# Module A exports
- `ClassA` - Uses ClassB from Module B

# Module B exports
- `ClassB` - Uses ClassA from Module A
```

**Solution**: Refactor to break circular dependency.

### 3. Versioned Exports

When exports change between versions:

```markdown
## Exports

# v2.0 (Current)
- `Client` - New API client

# v1.x (Legacy, deprecated)
- `LegacyClient` - Old API client (deprecated)
```

### 4. Conditional Exports

When exports vary by platform:

```markdown
## Exports

# All platforms
- `Client` - API client

# Windows only
- `WindowsClient` - Windows-specific client (platform=win32)
```

### 5. Export Conflicts

When different exports have the same name:

```markdown
## Exports

# This will cause conflicts
- `utils` - Utility module (v1)
- `utils` - Utility module (v2)
```

**Solution**: Use unique names or versioning.

### 6. Type Aliases vs Classes

When to use type aliases vs classes:

```markdown
## Exports

# Type alias (for simple types)
- `UserID = str` - User identifier type

# Class (for complex types)
- `User` - User class with methods
```

### 7. Exception Hierarchy

When defining exception hierarchy:

```markdown
## Exports

# Base exception
- `APIError` - Base API error

# Specific exceptions
- `AuthenticationError(APIError)` - Authentication failure
- `RateLimitError(APIError)` - Rate limit exceeded
```

### 8. Constants vs Configuration

When to use constants vs configuration:

```markdown
## Exports

# Constants (fixed values)
- `MAX_RETRIES = 3` - Maximum retry attempts

# Configuration (configurable)
- `DEFAULT_TIMEOUT` - Default timeout (configurable)
```

### 9. Deprecated Exports

When exports are deprecated:

```markdown
## Exports

# Current
- `new_function` - New function (recommended)

# Deprecated
- `old_function` - Old function (deprecated, use new_function)
```

### 10. Export Aliases

When exporting the same thing with different names:

```markdown
## Exports

# Primary name
- `authenticate` - Authenticate user

# Alias
- `login` - Alias for authenticate
```

## Best Practices

### 1. Document Every Export

Each export must have a clear description:

```markdown
# Bad
- `verify_token`

# Good
- `verify_token(token: str, secret: str) -> bool` - Verify JWT token validity
```

### 2. Include Type Signatures

Provide type information for better documentation:

```markdown
# Bad
- `process` - Process data

# Good
- `process(data: Dict[str, Any], options: Optional[Dict] = None) -> Dict[str, Any]` - Process data with options
```

### 3. Group Related Exports

Organize exports by functionality:

```markdown
## Exports

# Authentication
- `Authenticator` - Main auth class
- `verify_token` - Verify token
- `hash_password` - Hash password

# API Client
- `APIClient` - API client
- `create_client` - Create client instance
- `APIError` - API error
```

### 4. Use Consistent Naming

Follow language conventions consistently:

```markdown
# Classes: PascalCase
- `Authenticator`

# Functions: snake_case
- `verify_token`

# Constants: UPPER_SNAKE_CASE
- `DEFAULT_TIMEOUT`
```

### 5. Document Return Types

Always document what functions return:

```markdown
- `get_user(user_id: str) -> Dict[str, Any]` - Get user by ID, returns user dict
- `verify_token(token: str) -> bool` - Verify token, returns True if valid
```

### 6. Document Exceptions

Document when functions raise exceptions:

```markdown
- `get_user(user_id: str) -> Dict[str, Any]` - Get user by ID
  - Raises `UserNotFoundError` if user not found
  - Raises `PermissionError` if unauthorized
```

### 7. Use Enums for Fixed Values

Use enums for fixed sets of values:

```markdown
# Bad
- `ROLE_ADMIN = "admin"` - Admin role
- `ROLE_USER = "user"` - User role

# Good
- `UserRole` - User role enum (ADMIN, USER, GUEST)
```

### 8. Document Constants

Explain what constants represent:

```markdown
# Bad
- `MAX_SIZE` - Maximum size

# Good
- `MAX_SIZE` - Maximum file size in bytes (10485760)
```

### 9. Provide Examples

Include usage examples in descriptions:

```markdown
- `create_client(url: str, key: str) -> APIClient` - Create client
  ```python
  client = create_client("https://api.example.com", "your-key")
  ```
```

### 10. Version Your API

Use versioning for breaking changes:

```markdown
## Exports

# v2.0 API
- `Client` - New client (recommended)

# v1.x API (deprecated)
- `LegacyClient` - Old client (deprecated)
```

## Common Patterns

### Pattern 1: Simple Module

```markdown
## Exports

- `process(data: str) -> str` - Process input data
- `validate(data: str) -> bool` - Validate input data
```

### Pattern 2: Class-Based Module

```markdown
## Exports

- `Client` - Main client class
- `Client(base_url: str, api_key: str)` - Constructor
- `Client.get(path: str) -> dict` - GET request
- `Client.post(path: str, data: dict) -> dict` - POST request
```

### Pattern 3: Factory Pattern

```markdown
## Exports

- `create_client(base_url: str, api_key: str) -> Client` - Create client
- `create_cache(backend: str) -> Cache` - Create cache
- `create_db(url: str) -> Database` - Create database
```

### Pattern 4: Exception Hierarchy

```markdown
## Exports

- `Error` - Base error class
- `ValidationError(Error)` - Validation error
- `NotFoundError(Error)` - Not found error
- `PermissionError(Error)` - Permission error
```

### Pattern 5: Type Aliases

```markdown
## Exports

- `UserID = str` - User identifier
- `Timestamp = int` - Unix timestamp
- `JSON = Dict[str, Any]` - JSON object
```

### Pattern 6: Constants and Defaults

```markdown
## Exports

- `DEFAULT_TIMEOUT` - Default timeout (30 seconds)
- `MAX_RETRIES` - Maximum retries (3)
- `API_VERSION` - API version ("1.0.0")
```

### Pattern 7: Enums

```markdown
## Exports

- `Status` - Status enum (ACTIVE, INACTIVE, PENDING)
- `Role` - Role enum (ADMIN, USER, GUEST)
- `Format` - Format enum (JSON, XML, CSV)
```

### Pattern 8: Callback Types

```markdown
## Exports

- `Callback = Callable[[Event], None]` - Event callback
- `ErrorHandler = Callable[[Error], None]` - Error handler
- `Middleware = Callable[[Request, Next], Response]` - Middleware
```

### Pattern 9: Data Classes

```markdown
## Exports

- `User` - User data class
- `User.id` - User ID
- `User.name` - User name
- `User.email` - User email
- `User.created_at` - Creation timestamp
```

### Pattern 10: Context Managers

```markdown
## Exports

- `session() -> ContextManager` - Database session context
- `transaction() -> ContextManager` - Transaction context
- `lock(name: str) -> ContextManager` - Distributed lock context
```

## Validation Rules

### Rule 1: Valid Names

Export names must follow language conventions:

```python
import re

def validate_export_name(name: str, export_type: str) -> bool:
    if export_type == "class":
        return bool(re.match(r'^[A-Z][a-zA-Z0-9]*$', name))
    elif export_type == "function":
        return bool(re.match(r'^[a-z][a-z0-9_]*$', name))
    elif export_type == "constant":
        return bool(re.match(r'^[A-Z][A-Z0-9_]*$', name))
    return False
```

### Rule 2: No Duplicates

Each export should be listed only once:

```python
def check_duplicate_exports(exports: list[str]) -> list[str]:
    seen = set()
    duplicates = []
    for export in exports:
        name = export.split()[0].strip('`')
        if name in seen:
            duplicates.append(name)
        seen.add(name)
    return duplicates
```

### Rule 3: Valid Types

Type annotations must be valid:

```python
def validate_type_annotation(annotation: str) -> bool:
    # Simple validation
    valid_types = {"str", "int", "float", "bool", "dict", "list", "None"}
    base_type = annotation.split("[")[0].split(",")[0].strip()
    return base_type in valid_types or base_type[0].isupper()
```

### Rule 4: Complete Documentation

Each export must have a description:

```python
def check_documentation(exports: list[str]) -> list[str]:
    undocumented = []
    for export in exports:
        if " - " not in export:
            undocumented.append(export.split()[0].strip('`'))
    return undocumented
```

### Rule 5: Consistent Formatting

Exports should follow consistent format:

```python
def validate_format(exports: list[str]) -> bool:
    for export in exports:
        if not export.startswith("- `"):
            return False
        if " - " not in export:
            return False
    return True
```

## Related Sections

- **[Imports](imports.md)**: What this module imports
- **[Dependencies](dependencies.md)**: External dependencies
- **[Python](python.md)**: Python code blocks
- **[JavaScript](javascript.md)**: JavaScript code blocks
- **[Tests](tests.md)**: Test cases
- **[References](references.md)**: External documentation

## FAQ

### Q: What's the difference between Exports and Imports?

**A:** Exports define what *this module provides* to other modules. Imports define what *this module uses* from other modules.

### Q: Should I export everything?

**A:** No, only export the public API. Keep internal implementation private.

### Q: How do I handle versioning?

**A:** Use versioned exports or separate sections:

```markdown
## Exports

# v2.0 (Current)
- `Client` - New client

# v1.x (Legacy)
- `LegacyClient` - Old client (deprecated)
```

### Q: Can I export types?

**A:** Yes, type aliases are common exports:

```markdown
## Exports

- `UserID = str` - User identifier type
- `Callback = Callable[[Event], None]` - Event callback type
```

### Q: How do I document exceptions?

**A:** Document when functions raise exceptions:

```markdown
- `get_user(user_id: str) -> Dict` - Get user by ID
  - Raises `UserNotFoundError` if user not found
```

### Q: Should I include examples in exports?

**A:** Brief examples are helpful:

```markdown
- `create_client(url: str, key: str) -> Client` - Create client
  ```python
  client = create_client("https://api.example.com", "key")
  ```
```

### Q: How do I handle deprecated exports?

**A:** Mark as deprecated with alternative:

```markdown
- `old_function` - Old function (deprecated, use new_function)
```

### Q: Can I export the same thing with different names?

**A:** Yes, but use aliases:

```markdown
- `authenticate` - Authenticate user (primary)
- `login` - Alias for authenticate
```

### Q: How do I handle conditional exports?

**A:** Use platform markers:

```markdown
- `WindowsClient` - Windows client (platform=win32)
- `LinuxClient` - Linux client (platform=linux)
```

### Q: Should I group exports by functionality?

**A:** Yes, it improves readability:

```markdown
## Exports

# Authentication
- `Authenticator`
- `verify_token`

# API Client
- `APIClient`
- `create_client`
```

### Q: How do I handle circular dependencies?

**A:** Refactor to break the cycle, or use lazy imports.

### Q: Can I export constants?

**A:** Yes, constants are common exports:

```markdown
## Exports

- `DEFAULT_TIMEOUT` - Default timeout (30 seconds)
- `MAX_RETRIES` - Maximum retries (3)
```

### Q: How do I document return types?

**A:** Include return type in signature:

```markdown
- `get_user(user_id: str) -> Dict[str, Any]` - Get user by ID
```

### Q: Should I use enums or constants?

**A:** Use enums for fixed sets of values:

```markdown
# Bad
- `ROLE_ADMIN = "admin"`

# Good
- `UserRole` - User role enum (ADMIN, USER, GUEST)
```

### Q: How do I handle export conflicts?

**A:** Use unique names or versioning:

```markdown
# Bad
- `utils` - Utility module
- `utils` - Another utility module

# Good
- `core_utils` - Core utilities
- `api_utils` - API utilities
```

### Q: Can I export classes with methods?

**A:** Yes, document class methods:

```markdown
- `Client` - API client class
  - `Client(base_url: str)` - Constructor
  - `Client.get(path: str) -> dict` - GET request
  - `Client.post(path: str, data: dict) -> dict` - POST request
```

### Q: How do I handle export changes between versions?

**A:** Use version comments or separate sections:

```markdown
## Exports

# v2.0 (Current)
- `new_function` - New function

# v1.x (Deprecated)
- `old_function` - Old function (deprecated)
```

### Q: Should I export type hints?

**A:** Yes, type hints improve documentation and tooling support.

### Q: How do I document optional parameters?

**A:** Use default values in signatures:

```markdown
- `get_user(user_id: str, include_deleted: bool = False) -> Dict` - Get user
```

### Q: Can I export multiple classes from one export?

**A:** List each class separately for clarity:

```markdown
- `Authenticator` - Auth class
- `TokenManager` - Token class
- `PasswordHasher` - Password class
```

## Implementation Notes

### Export Validation

```python
class ExportValidator:
    def __init__(self):
        self.exported = set()
    
    def validate(self, export: str) -> list[str]:
        errors = []
        
        # Check format
        if not export.startswith("- `"):
            errors.append("Invalid format")
        
        # Check for description
        if " - " not in export:
            errors.append("Missing description")
        
        # Check for duplicates
        name = export.split()[0].strip('`')
        if name in self.exported:
            errors.append(f"Duplicate export: {name}")
        self.exported.add(name)
        
        return errors
```

### Export Extraction

```python
def extract_exports(content: str) -> list[dict]:
    exports = []
    for line in content.split('\n'):
        if line.startswith('- `'):
            name = line.split('`')[1]
            description = line.split(' - ')[1] if ' - ' in line else ''
            exports.append({
                'name': name,
                'description': description
            })
    return exports
```

### Export Documentation Generator

```python
def generate_docs(exports: list[dict]) -> str:
    docs = "# Exported API\n\n"
    for export in exports:
        docs += f"## {export['name']}\n\n"
        docs += f"{export['description']}\n\n"
    return docs
```

## References

- [MAM Specification - Exports](../SPEC.md#exports)
- [Python Documentation](https://docs.python.org/3/tutorial/modules.html#contributing-to-python)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/handbook/modules.html)
- [API Design Best Practices](https://restfulapi.net/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable