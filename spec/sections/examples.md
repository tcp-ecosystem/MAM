# Examples Section

## Description
The Examples section provides usage demonstrations, sample code, and practical illustrations of how the module works. It serves as both documentation and runnable test cases, helping developers understand the module's API, behavior, and expected outputs.

Examples are critical for adoption and correct usage. They demonstrate:
- Basic usage patterns
- Advanced configurations
- Edge case handling
- Integration with other modules
- Real-world use cases

## Syntax

```markdown
## Examples

```python
# Example code here
result = module.process("input")
print(result)
```
```

### Example Format

Each example should include:
1. **Description**: What the example demonstrates
2. **Code**: Runnable code snippet
3. **Expected Output**: What the code produces
4. **Explanation**: How it works

### Multi-line Examples

For complex examples, use multiple code blocks:

```markdown
## Examples

### Basic Usage

```python
from mymodule import MyClass

obj = MyClass()
result = obj.process("input")
print(result)
```

Expected output:
```
{'status': 'success', 'data': 'processed'}
```

### Advanced Configuration

```python
from mymodule import MyClass

config = {
    'timeout': 30,
    'retries': 3,
    'verbose': True
}
obj = MyClass(**config)
result = obj.process("complex input")
```
```

## Rules

1. **Runnable code**: Examples must be syntactically correct
2. **Clear output**: Show expected output when applicable
3. **Progressive complexity**: Start simple, then show advanced usage
4. **Complete examples**: Include all necessary imports
5. **Realistic examples**: Use realistic data, not placeholders
6. **Edge cases**: Show how to handle errors and edge cases
7. **Documentation**: Explain what each example demonstrates

### Code Quality Rules

| Rule | Good | Bad |
|------|------|-----|
| Complete imports | `import requests` | (missing import) |
| Realistic data | `{"user": "john"}` | `{"data": "x"}` |
| Error handling | `try/except` | (no handling) |
| Clear variable names | `user_response` | `resp` |
| Comments | `# Fetch user data` | (no comments) |

### Output Format Rules

- Use code blocks for output
- Prefix output with `>>> ` for interactive examples
- Show both success and error cases
- Include error messages when relevant

## Description

The Examples section serves multiple purposes:

### 1. Learning Resource

Examples help developers learn the module quickly:

```markdown
## Examples

### Hello World

The simplest possible usage:

```python
from mymodule import greet
print(greet("World"))
```

Output:
```
Hello, World!
```
```

### 2. API Documentation

Examples demonstrate the full API surface:

```markdown
## Examples

### All Methods

```python
from mymodule import Client

# Initialize
client = Client(api_key="your-key")

# Create
user = client.users.create(name="John")

# Read
user = client.users.get(user_id="123")

# Update
user = client.users.update(user_id="123", name="Jane")

# Delete
client.users.delete(user_id="123")
```
```

### 3. Integration Patterns

Examples show how to integrate with other systems:

```markdown
## Examples

### With FastAPI

```python
from fastapi import FastAPI
from mymodule import AuthMiddleware

app = FastAPI()
auth = AuthMiddleware(secret="your-secret")

@app.get("/protected")
async def protected_route(request: Request):
    user = auth.verify(request)
    return {"user": user}
```
```

### 4. Error Handling

Examples demonstrate proper error handling:

```markdown
## Examples

### Error Handling

```python
from mymodule import Client, APIError

client = Client(api_key="your-key")

try:
    user = client.users.get(user_id="123")
except APIError as e:
    if e.status_code == 404:
        print("User not found")
    elif e.status_code == 401:
        print("Invalid API key")
    else:
        raise
```
```

### 5. Configuration Patterns

Examples show different configuration options:

```markdown
## Examples

### Configuration

```python
from mymodule import Client

# Development
dev_client = Client(
    base_url="http://localhost:8000",
    debug=True,
    timeout=30
)

# Production
prod_client = Client(
    base_url="https://api.example.com",
    api_key="your-key",
    timeout=10,
    retries=3
)
```
```

### 6. Performance Optimization

Examples demonstrate performance best practices:

```markdown
## Examples

### Connection Pooling

```python
from mymodule import Client

# Use connection pooling for better performance
client = Client(
    pool_connections=10,
    pool_maxsize=20
)

# Make multiple requests
for user_id in user_ids:
    user = client.users.get(user_id=user_id)
    process(user)
```
```

## Examples

### Basic Module Usage

```markdown
## Examples

### Simple Processing

```python
from mymodule import process

result = process("input data")
print(result)
```

Output:
```
{'status': 'success', 'data': 'processed input data'}
```
```

### Authentication Module

```markdown
## Examples

### JWT Authentication

```python
from mymodule.auth import Authenticator

# Initialize
auth = Authenticator(secret="your-secret-key")

# Generate tokens
tokens = auth.generate_token(user_id="user123")
print(tokens)
```

Output:
```
{
    'access_token': 'eyJhbGciOiJIUzI1NiIs...',
    'refresh_token': 'eyJhbGciOiJIUzI1NiIs...',
    'expires_in': 3600
}
```

### Validate Token

```python
claims = auth.validate_token(tokens['access_token'])
print(claims)
```

Output:
```
{
    'sub': 'user123',
    'iat': 1690000000,
    'exp': 1690003600
}
```
```

### Data Processing Module

```markdown
## Examples

### CSV Processing

```python
from mymodule.data import CSVProcessor

processor = CSVProcessor()

# Read CSV
data = processor.read('data.csv')
print(f"Loaded {len(data)} rows")

# Process
processed = processor.transform(data, rules={
    'clean_whitespace': True,
    'validate_emails': True,
    'remove_duplicates': True
})

# Write
processor.write(processed, 'output.csv')
```
```

### API Client Module

```markdown
## Examples

### REST API Client

```python
from mymodule.api import Client

client = Client(
    base_url="https://api.example.com",
    api_key="your-api-key"
)

# GET request
users = client.get("/users")
print(users)

# POST request
new_user = client.post("/users", data={
    "name": "John Doe",
    "email": "john@example.com"
})
print(new_user)

# Error handling
try:
    user = client.get("/users/999")
except client.NotFoundError:
    print("User not found")
except client.AuthError:
    print("Invalid API key")
```
```

### Webhook Module

```markdown
## Examples

### Webhook Handler

```python
from mymodule.webhooks import Handler, WebhookError

handler = Handler(secret="webhook-secret")

@handler.on("user.created")
def handle_user_created(event):
    print(f"New user: {event['data']['name']}")
    # Send welcome email
    send_email(event['data']['email'], "Welcome!")

@handler.on("payment.completed")
def handle_payment(event):
    print(f"Payment: {event['data']['amount']}")
    # Update order status
    update_order(event['data']['order_id'])

# In your route
from flask import Flask, request

app = Flask(__name__)

@app.route("/webhooks", methods=["POST"])
def webhook():
    try:
        handler.process(request.data, request.headers)
        return {"status": "ok"}, 200
    except WebhookError as e:
        return {"error": str(e)}, 400
```
```

### Database Module

```markdown
## Examples

### SQLAlchemy Integration

```python
from mymodule.db import Database, Model

db = Database("sqlite:///app.db")

class User(Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100))
    email = db.Column(db.String(100), unique=True)

# Create table
db.create_all()

# Insert
user = User(name="John", email="john@example.com")
db.session.add(user)
db.session.commit()

# Query
user = User.query.filter_by(email="john@example.com").first()
print(user.name)

# Update
user.name = "Jane"
db.session.commit()

# Delete
db.session.delete(user)
db.session.commit()
```
```

### Cache Module

```markdown
## Examples

### Redis Cache

```python
from mymodule.cache import RedisCache

cache = RedisCache(
    host="localhost",
    port=6379,
    db=0,
    ttl=3600
)

# Set value
cache.set("user:123", {"name": "John"})

# Get value
user = cache.get("user:123")
print(user)

# Delete
cache.delete("user:123")

# Cache decorator
@cache.memoize(ttl=300)
def expensive_operation(param):
    # This result will be cached for 5 minutes
    return compute(param)
```
```

### File Processing Module

```markdown
## Examples

### PDF Processing

```python
from mymodule.files import PDFProcessor

processor = PDFProcessor()

# Extract text
text = processor.extract_text("document.pdf")
print(text)

# Extract metadata
metadata = processor.get_metadata("document.pdf")
print(metadata)

# Convert to images
images = processor.to_images("document.pdf", dpi=300)
for i, img in enumerate(images):
    img.save(f"page_{i}.png")
```
```

### Machine Learning Module

```markdown
## Examples

### Model Training

```python
from mymodule.ml import Classifier

classifier = Classifier()

# Load data
X_train, X_test, y_train, y_test = classifier.load_data("dataset.csv")

# Train
classifier.train(X_train, y_train, epochs=100)

# Evaluate
accuracy = classifier.evaluate(X_test, y_test)
print(f"Accuracy: {accuracy:.2%}")

# Predict
predictions = classifier.predict(X_new)
print(predictions)

# Save model
classifier.save("model.pkl")

# Load model
classifier = Classifier.load("model.pkl")
```
```

### Logging Module

```markdown
## Examples

### Structured Logging

```python
from mymodule.logging import Logger

logger = Logger(
    name="myapp",
    level="INFO",
    format="json"
)

# Basic logging
logger.info("User logged in", user_id="123")

# Error logging
try:
    risky_operation()
except Exception as e:
    logger.error("Operation failed", error=str(e), exc_info=True)

# Context logging
with logger.context(request_id="abc-123"):
    logger.info("Processing request")
    # All logs in this block will include request_id
```
```

### Validation Module

```markdown
## Examples

### Pydantic Models

```python
from mymodule.validation import BaseModel, validator

class User(BaseModel):
    name: str
    email: str
    age: int
    
    @validator('email')
    def validate_email(cls, v):
        if '@' not in v:
            raise ValueError('Invalid email')
        return v
    
    @validator('age')
    def validate_age(cls, v):
        if v < 0 or v > 150:
            raise ValueError('Invalid age')
        return v

# Valid
user = User(name="John", email="john@example.com", age=30)
print(user)

# Invalid
try:
    user = User(name="John", email="invalid", age=200)
except ValueError as e:
    print(e)
```
```

### Rate Limiting Module

```markdown
## Examples

### API Rate Limiting

```python
from mymodule.ratelimit import RateLimiter, Limiter

limiter = RateLimiter(
    backend="redis",
    rate="100/minute",
    burst=10
)

@app.route("/api/data")
@limiter.limit("10/second")
def get_data():
    return {"data": "value"}

@app.route("/api/upload")
@limiter.limit("1/minute", burst=3)
def upload():
    # Process upload
    return {"status": "ok"}

# Manual rate limiting
with limiter:
    # This block is rate limited
    process_request()
```
```

### Email Module

```markdown
## Examples

### SMTP Email

```python
from mymodule.email import SMTPClient, Email

client = SMTPClient(
    host="smtp.example.com",
    port=587,
    username="user@example.com",
    password="password"
)

# Simple email
email = Email(
    to="recipient@example.com",
    subject="Hello",
    body="This is a test email"
)
client.send(email)

# HTML email with attachments
email = Email(
    to="recipient@example.com",
    subject="Report",
    html="<h1>Monthly Report</h1><p>Please see attached.</p>",
    attachments=["report.pdf", "data.csv"]
)
client.send(email)
```
```

### Encryption Module

```markdown
## Examples

### AES Encryption

```python
from mymodule.crypto import AESCipher

cipher = AESCipher(key="your-secret-key")

# Encrypt
encrypted = cipher.encrypt("sensitive data")
print(encrypted)

# Decrypt
decrypted = cipher.decrypt(encrypted)
print(decrypted)

# File encryption
cipher.encrypt_file("plain.txt", "encrypted.bin")
cipher.decrypt_file("encrypted.bin", "decrypted.txt")
```
```

### Task Queue Module

```markdown
## Examples

### Background Tasks

```python
from mymodule.tasks import TaskQueue, task

queue = TaskQueue(backend="redis")

@task(queue=queue, max_retries=3)
def send_email(user_id, subject, body):
    user = get_user(user_id)
    # Send email
    return {"status": "sent", "user": user_id}

# Enqueue task
task = send_email.delay(user_id="123", subject="Hello", body="World")
print(task.id)

# Check status
status = task.get_status()
print(status)

# Wait for result
result = task.get(timeout=30)
print(result)
```
```

### WebSocket Module

```markdown
## Examples

### Real-time Communication

```python
from mymodule.ws import WebSocketServer, Client

server = WebSocketServer(host="0.0.0.0", port=8765)

@server.on("connect")
def handle_connect(client):
    print(f"Client connected: {client.id}")

@server.on("message")
def handle_message(client, message):
    # Broadcast to all clients
    server.broadcast(message, exclude=[client.id])

@server.on("disconnect")
def handle_disconnect(client):
    print(f"Client disconnected: {client.id}")

# Start server
server.start()

# Client
client = Client("ws://localhost:8765")
client.send({"type": "chat", "message": "Hello!"})
```
```

## Edge Cases

### 1. Error Handling Examples

Always show error handling:

```markdown
## Examples

### Error Handling

```python
from mymodule import Client, APIError

client = Client()

try:
    result = client.process("input")
except APIError as e:
    if e.status_code == 429:
        print("Rate limited, retrying...")
        time.sleep(e.retry_after)
        result = client.process("input")
    else:
        raise
```
```

### 2. Edge Case Data

Show how to handle edge cases:

```markdown
## Examples

### Edge Cases

```python
from mymodule import validate

# Empty string
validate("")  # Returns False

# None
validate(None)  # Returns False

# Very long string
validate("x" * 1000000)  # Returns False

# Special characters
validate("!@#$%^&*()")  # Returns True

# Unicode
validate("Hello 世界")  # Returns True
```
```

### 3. Configuration Variations

Show different configurations:

```markdown
## Examples

### Configuration Variations

```python
from mymodule import Client

# Minimal
client = Client()

# Full
client = Client(
    base_url="https://api.example.com",
    api_key="key",
    timeout=30,
    retries=3,
    pool_connections=10,
    pool_maxsize=20,
    verify_ssl=True,
    proxies={"https": "http://proxy:8080"}
)
```
```

### 4. Performance Examples

Show performance considerations:

```markdown
## Examples

### Performance

```python
from mymodule import Processor

# Slow (creates new connection each time)
for item in items:
    processor = Processor()
    processor.process(item)

# Fast (reuses connection)
processor = Processor()
for item in items:
    processor.process(item)
```
```

### 5. Async Examples

Show async usage:

```markdown
## Examples

### Async Processing

```python
import asyncio
from mymodule import AsyncClient

async def main():
    client = AsyncClient()
    
    # Sequential
    for url in urls:
        result = await client.get(url)
    
    # Parallel
    tasks = [client.get(url) for url in urls]
    results = await asyncio.gather(*tasks)
    
    await client.close()

asyncio.run(main())
```
```

## Best Practices

### 1. Start with Simple Examples

Begin with the simplest possible usage:

```markdown
## Examples

### Hello World

```python
from mymodule import greet
print(greet("World"))
```
```

### 2. Show Real-World Use Cases

Use realistic examples, not contrived ones:

```markdown
## Examples

### E-commerce Order Processing

```python
from mymodule import OrderProcessor

processor = OrderProcessor()

order = {
    "user_id": "user123",
    "items": [
        {"product_id": "prod1", "quantity": 2},
        {"product_id": "prod2", "quantity": 1}
    ],
    "shipping": {
        "address": "123 Main St",
        "city": "Springfield",
        "state": "IL"
    }
}

result = processor.process(order)
print(f"Order {result['order_id']} created")
```
```

### 3. Include Error Handling

Always show how to handle errors:

```markdown
## Examples

### Error Handling

```python
from mymodule import Client, ValidationError

client = Client()

try:
    result = client.process(data)
except ValidationError as e:
    print(f"Invalid data: {e.errors}")
except Exception as e:
    print(f"Unexpected error: {e}")
```
```

### 4. Document Assumptions

State any assumptions in examples:

```markdown
## Examples

### Database Operations

**Assumptions**: Database is running and accessible.

```python
from mymodule.db import Database

db = Database("postgresql://user:pass@localhost/db")
```
```

### 5. Show Both Success and Failure

Demonstrate both happy path and error cases:

```markdown
## Examples

### Success Case

```python
result = process("valid input")
print(result)  # {'status': 'success'}
```

### Failure Case

```python
result = process("invalid input")
print(result)  # {'status': 'error', 'message': 'Invalid input'}
```
```

### 6. Use Consistent Style

Maintain consistent code style across examples:

```markdown
## Examples

### Style Guide

```python
# Good: Consistent naming
user_data = get_user(user_id)
processed_data = process_data(user_data)

# Bad: Inconsistent naming
ud = get_user(uid)
pd = process_data(ud)
```
```

### 7. Include Comments

Add comments for complex logic:

```markdown
## Examples

### Complex Processing

```python
# Validate input
if not validate_input(data):
    raise ValueError("Invalid input")

# Transform data
transformed = transform(data)

# Apply business rules
result = apply_rules(transformed)

# Return response
return {"status": "success", "data": result}
```
```

### 8. Show Configuration Options

Document available configuration:

```markdown
## Examples

### Configuration Options

```python
from mymodule import Client

# Available options:
# - base_url: API base URL (default: http://localhost:8000)
# - api_key: API authentication key
# - timeout: Request timeout in seconds (default: 30)
# - retries: Number of retries (default: 3)

client = Client(
    base_url="https://api.example.com",
    api_key="your-key",
    timeout=60,
    retries=5
)
```
```

### 9. Test Examples

Ensure examples actually work:

```markdown
## Examples

### Tested Example

```python
from mymodule import add

# This example is tested in tests/test_examples.py
result = add(2, 3)
assert result == 5
```
```

### 10. Version Examples

Show version-specific examples when needed:

```markdown
## Examples

### v2.0 API

```python
# New in v2.0
from mymodule.v2 import Client

client = Client()
```

### v1.x API (Legacy)

```python
# Deprecated, will be removed in v3.0
from mymodule.v1 import Client

client = Client()
```
```

## Common Patterns

### Pattern 1: CRUD Operations

```markdown
## Examples

### CRUD Operations

```python
from mymodule import Repository

repo = Repository()

# Create
user = repo.create({"name": "John", "email": "john@example.com"})

# Read
user = repo.get(user["id"])

# Update
user = repo.update(user["id"], {"name": "Jane"})

# Delete
repo.delete(user["id"])

# List
users = repo.list(filter={"active": True}, limit=10)
```
```

### Pattern 2: Event Processing

```markdown
## Examples

### Event Processing

```python
from mymodule import EventBus

bus = EventBus()

@bus.on("user.created")
def handle_user_created(event):
    send_welcome_email(event["data"]["email"])

@bus.on("order.completed")
def handle_order_completed(event):
    update_inventory(event["data"]["items"])

# Emit events
bus.emit("user.created", {"email": "john@example.com"})
bus.emit("order.completed", {"items": ["item1", "item2"]})
```
```

### Pattern 3: Middleware Chain

```markdown
## Examples

### Middleware Chain

```python
from mymodule import Pipeline, Middleware

class AuthMiddleware(Middleware):
    def process(self, request, next):
        if not request.user:
            raise UnauthorizedError()
        return next(request)

class LoggingMiddleware(Middleware):
    def process(self, request, next):
        print(f"Request: {request.method} {request.path}")
        response = next(request)
        print(f"Response: {response.status_code}")
        return response

pipeline = Pipeline()
pipeline.add(AuthMiddleware())
pipeline.add(LoggingMiddleware())
pipeline.add(handler)
```
```

### Pattern 4: Configuration Management

```markdown
## Examples

### Configuration Management

```python
from mymodule import Config

config = Config()

# Load from file
config.load("config.yaml")

# Override with environment variables
config.override_from_env(prefix="MYAPP_")

# Access
print(config.database.host)
print(config.cache.ttl)

# Validate
config.validate()
```
```

### Pattern 5: Retry Logic

```markdown
## Examples

### Retry Logic

```python
from mymodule import retry, RetryError

@retry(max_attempts=3, delay=1, backoff=2)
def unstable_operation():
    if random.random() < 0.5:
        raise Exception("Random failure")
    return "success"

try:
    result = unstable_operation()
except RetryError as e:
    print(f"Failed after {e.attempts} attempts")
```
```

### Pattern 6: Data Validation

```markdown
## Examples

### Data Validation

```python
from mymodule import validate, Schema

schema = Schema({
    "name": {"type": "string", "required": True},
    "email": {"type": "string", "required": True, "format": "email"},
    "age": {"type": "integer", "min": 0, "max": 150}
})

# Valid
data = {"name": "John", "email": "john@example.com", "age": 30}
result = validate(data, schema)
assert result.valid

# Invalid
data = {"name": "John", "email": "invalid", "age": 200}
result = validate(data, schema)
assert not result.valid
print(result.errors)
```
```

### Pattern 7: Caching

```markdown
## Examples

### Caching Pattern

```python
from mymodule import cache, Cache

cache = Cache(backend="redis", ttl=3600)

@cache.memoize
def expensive_query(user_id):
    # This result will be cached
    return db.query(f"SELECT * FROM users WHERE id = {user_id}")

# First call - executes query
user = expensive_query(123)

# Second call - returns cached result
user = expensive_query(123)

# Invalidate
cache.invalidate(expensive_query, 123)
```
```

### Pattern 8: Async Processing

```markdown
## Examples

### Async Pattern

```python
import asyncio
from mymodule import AsyncClient

async def process_items(items):
    client = AsyncClient()
    
    async def process_item(item):
        return await client.process(item)
    
    tasks = [process_item(item) for item in items]
    results = await asyncio.gather(*tasks)
    
    await client.close()
    return results

results = asyncio.run(process_items(items))
```
```

### Pattern 9: Plugin System

```markdown
## Examples

### Plugin System

```python
from mymodule import PluginManager, Plugin

class MyPlugin(Plugin):
    name = "my-plugin"
    version = "1.0.0"
    
    def on_load(self):
        print("Plugin loaded")
    
    def process(self, data):
        return data.upper()

manager = PluginManager()
manager.register(MyPlugin())

# Use plugin
result = manager.process("hello")
print(result)  # "HELLO"
```
```

### Pattern 10: Monitoring

```markdown
## Examples

### Monitoring Pattern

```python
from mymodule import monitor, Metrics

metrics = Metrics(backend="prometheus")

@monitor
def process_request(request):
    # Automatically tracked
    with metrics.timer("request_duration"):
        result = handle(request)
    
    metrics.counter("requests_total").inc()
    metrics.gauge("queue_size", get_queue_size())
    
    return result
```
```

## Validation Rules

### Rule 1: Valid Syntax

All example code must be syntactically valid:

```python
import ast

def validate_syntax(code: str) -> bool:
    try:
        ast.parse(code)
        return True
    except SyntaxError:
        return False
```

### Rule 2: Complete Imports

Examples must include all necessary imports:

```python
def check_imports(code: str) -> list[str]:
    # Check for missing imports
    missing = []
    # Simple heuristic: check for undefined names
    return missing
```

### Rule 3: Expected Output

When showing output, it must be accurate:

```python
def validate_output(code: str, expected: str) -> bool:
    # Run code and compare output
    actual = execute(code)
    return actual.strip() == expected.strip()
```

### Rule 4: Error Cases

Examples should include error cases:

```python
def has_error_handling(code: str) -> bool:
    return "try" in code or "except" in code or "error" in code.lower()
```

### Rule 5: Realistic Data

Examples should use realistic data:

```python
def is_realistic_data(data: str) -> bool:
    # Check for placeholder data
    placeholders = ["xxx", "foo", "bar", "baz", "example"]
    return not any(p in data.lower() for p in placeholders)
```

## Related Sections

- **[Purpose](purpose.md)**: Module purpose
- **[Python](python.md)**: Python code blocks
- **[JavaScript](javascript.md)**: JavaScript code blocks
- **[Tests](tests.md)**: Test cases
- **[Workflow](workflow.md)**: Process flow
- **[References](references.md)**: External documentation

## FAQ

### Q: How many examples should I include?

**A:** Include at least one basic example, plus examples for common use cases. Aim for 3-10 examples depending on module complexity.

### Q: Should examples be runnable?

**A:** Yes, all examples should be syntactically correct and runnable. Consider adding them to test suite.

### Q: How do I handle version-specific examples?

**A:** Use comments or separate sections:

```markdown
## Examples

### v2.0 (Current)

```python
from mymodule.v2 import Client
```

### v1.x (Legacy)

```python
# Deprecated
from mymodule.v1 import Client
```
```

### Q: Should I show output?

**A:** Yes, when it helps understanding. Use:

```python
result = process("input")
print(result)
```

Output:
```
{'status': 'success'}
```

### Q: How do I handle long examples?

**A:** Break into smaller, focused examples. Each should demonstrate one concept.

### Q: Should examples handle errors?

**A:** Yes, show error handling for common failure modes.

### Q: Can I use placeholder data?

**A:** Use realistic but fake data. Avoid "foo", "bar", "xxx".

### Q: How do I document configuration options?

**A:** Show configuration in examples with comments:

```python
client = Client(
    timeout=30,  # Request timeout in seconds
    retries=3,   # Number of retry attempts
    debug=False  # Enable debug logging
)
```

### Q: Should I include performance examples?

**A:** Yes, for performance-critical modules. Show both slow and fast approaches.

### Q: How do I handle async examples?

**A:** Show async usage with asyncio:

```python
import asyncio

async def main():
    result = await async_operation()
    return result

asyncio.run(main())
```

### Q: Can I reference other examples?

**A:** Yes, use cross-references:

```markdown
See [Basic Usage](#basic-usage) for simpler example.
```

### Q: Should I test examples?

**A:** Yes, consider adding examples to test suite to ensure they work.

### Q: How do I handle platform-specific examples?

**A:** Use comments to indicate platform:

```python
# Windows
import os
os.system("dir")

# Linux/macOS
import subprocess
subprocess.run(["ls", "-la"])
```

### Q: Can I use external resources in examples?

**A:** Use mocks or local resources when possible. If external resources are required, document it.

### Q: How do I show configuration file examples?

**A:** Use YAML/JSON code blocks:

```markdown
## Examples

### Configuration File

```yaml
database:
  host: localhost
  port: 5432
  name: myapp
```
```

### Q: Should I include troubleshooting examples?

**A:** Yes, show common errors and solutions:

```markdown
## Examples

### Troubleshooting

**Error**: Connection refused

**Solution**: Ensure database is running:

```python
# Test connection
from mymodule import test_connection
test_connection()
```
```

### Q: How do I document API changes?

**A:** Use version comments:

```python
# Changed in v2.0: now returns dict instead of list
result = client.get_users()
# v1.x: ["user1", "user2"]
# v2.0: [{"name": "user1"}, {"name": "user2"}]
```

### Q: Can I use examples from other modules?

**A:** Yes, with proper attribution and links.

## Implementation Notes

### Example Runner

```python
class ExampleRunner:
    def __init__(self):
        self.examples = []
    
    def add(self, code: str, expected: str = None):
        self.examples.append({
            'code': code,
            'expected': expected
        })
    
    def run_all(self):
        for i, example in enumerate(self.examples):
            try:
                result = execute(example['code'])
                if example['expected']:
                    assert result.strip() == example['expected'].strip()
                print(f"Example {i+1}: OK")
            except Exception as e:
                print(f"Example {i+1}: FAILED - {e}")
```

### Example Validator

```python
def validate_examples(examples: list[str]) -> list[dict]:
    results = []
    for i, code in enumerate(examples):
        valid = validate_syntax(code)
        results.append({
            'index': i,
            'valid': valid,
            'error': None if valid else 'Syntax error'
        })
    return results
```

## References

- [MAM Specification - Examples](../SPEC.md#examples)
- [Python Documentation](https://docs.python.org/)
- [Markdown Guide](https://www.markdownguide.org/)
- [Code Example Best Practices](https://realpython.com/documenting-python-code/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable