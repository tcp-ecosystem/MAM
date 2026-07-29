# Tests Section

## Description
The Tests section defines test cases for the module. It specifies how to test the module's functionality, including unit tests, integration tests, and edge cases.

The Tests section serves as:
- **Test specification**: What tests to write
- **Test coverage**: What functionality to test
- **Test structure**: How to organize tests
- **Test data**: Sample test data
- **Test procedures**: How to run tests

## Syntax

```markdown
## Tests

### Test Name
- Input: value
- Expected: output
```

### Test Format

Each test is a subsection:

```markdown
## Tests

### Valid Input Test
- Input: valid data
- Expected: success

### Invalid Input Test
- Input: invalid data
- Expected: error
```

### Categorized Tests

Use headers to organize tests:

```markdown
## Tests

### Unit Tests
- Test 1
- Test 2

### Integration Tests
- Test 3
- Test 4

### Edge Case Tests
- Test 5
- Test 6
```

## Rules

1. **Complete**: Tests must cover all functionality
2. **Independent**: Tests must be independent
3. **Repeatable**: Tests must be repeatable
4. **Automated**: Tests must be automatable
5. **Fast**: Tests must be fast
6. **Clear**: Tests must be clear
7. **Maintainable**: Tests must be maintainable
8. **Comprehensive**: Tests must cover edge cases
9. **Documented**: Tests must be documented
10. **Versioned**: Tests must be version controlled

### Test Types

| Type | Purpose | Example |
|------|---------|---------|
| Unit | Test individual functions | Test `add(1, 2)` returns 3 |
| Integration | Test component interaction | Test API endpoint with database |
| End-to-end | Test complete workflow | Test user registration flow |
| Edge case | Test boundary conditions | Test empty input |
| Performance | Test speed and resources | Test response time |
| Security | Test security measures | Test authentication |

## Description

The Tests section defines test cases:

### 1. Unit Tests

Tests for individual functions:

```markdown
## Tests

### Unit Tests

#### add(a, b)
- Input: add(1, 2)
- Expected: 3

- Input: add(-1, 1)
- Expected: 0

- Input: add(0, 0)
- Expected: 0

#### multiply(a, b)
- Input: multiply(2, 3)
- Expected: 6

- Input: multiply(-1, 5)
- Expected: -5

- Input: multiply(0, 100)
- Expected: 0
```

### 2. Integration Tests

Tests for component interaction:

```markdown
## Tests

### Integration Tests

#### API with Database
- Input: POST /users with valid data
- Expected: User created in database

- Input: GET /users/1
- Expected: User data returned

- Input: DELETE /users/1
- Expected: User removed from database
```

### 3. Edge Case Tests

Tests for boundary conditions:

```markdown
## Tests

### Edge Case Tests

#### Empty Input
- Input: None
- Expected: ValueError

- Input: ""
- Expected: ValueError

- Input: []
- Expected: ValueError

#### Boundary Values
- Input: 0
- Expected: Handle appropriately

- Input: MAX_INT
- Expected: Handle appropriately

- Input: -MAX_INT
- Expected: Handle appropriately
```

### 4. Error Handling Tests

Tests for error conditions:

```markdown
## Tests

### Error Handling Tests

#### Invalid Input
- Input: "abc" (when expecting number)
- Expected: TypeError

- Input: None (when expecting string)
- Expected: ValueError

#### Network Errors
- Input: Connection timeout
- Expected: Retry or raise TimeoutError

- Input: Server error (500)
- Expected: Raise ServerError
```

### 5. Performance Tests

Tests for performance requirements:

```markdown
## Tests

### Performance Tests

#### Response Time
- Input: 100 concurrent requests
- Expected: All complete within 1 second

#### Memory Usage
- Input: Process 1GB file
- Expected: Memory usage stays below 100MB

#### CPU Usage
- Input: Heavy computation
- Expected: CPU usage below 80%
```

### 6. Security Tests

Tests for security measures:

```markdown
## Tests

### Security Tests

#### Authentication
- Input: Valid credentials
- Expected: Login successful

- Input: Invalid credentials
- Expected: Login failed

- Input: Expired token
- Expected: Token rejected

#### Authorization
- Input: User without permissions
- Expected: Access denied

- Input: Admin with permissions
- Expected: Access granted
```

### 7. Data Validation Tests

Tests for data validation:

```markdown
## Tests

### Data Validation Tests

#### Email Validation
- Input: "user@example.com"
- Expected: Valid

- Input: "invalid-email"
- Expected: Invalid

- Input: "user@.com"
- Expected: Invalid

#### Password Validation
- Input: "StrongP@ss1"
- Expected: Valid

- Input: "weak"
- Expected: Invalid

- Input: "12345678"
- Expected: Invalid
```

### 8. API Tests

Tests for API endpoints:

```markdown
## Tests

### API Tests

#### GET /users
- Input: Valid request
- Expected: 200 OK with user list

- Input: Invalid authentication
- Expected: 401 Unauthorized

#### POST /users
- Input: Valid data
- Expected: 201 Created

- Input: Invalid data
- Expected: 400 Bad Request

#### PUT /users/1
- Input: Valid data
- Expected: 200 OK

- Input: Non-existent user
- Expected: 404 Not Found

#### DELETE /users/1
- Input: Valid ID
- Expected: 204 No Content

- Input: Invalid ID
- Expected: 404 Not Found
```

### 9. Database Tests

Tests for database operations:

```markdown
## Tests

### Database Tests

#### CRUD Operations
- Input: Create user
- Expected: User created with ID

- Input: Read user
- Expected: User data returned

- Input: Update user
- Expected: User updated

- Input: Delete user
- Expected: User removed

#### Transactions
- Input: Successful transaction
- Expected: Changes committed

- Input: Failed transaction
- Expected: Changes rolled back
```

### 10. Concurrency Tests

Tests for concurrent operations:

```markdown
## Tests

### Concurrency Tests

#### Race Conditions
- Input: Simultaneous updates
- Expected: No data corruption

#### Thread Safety
- Input: Multiple threads accessing shared resource
- Expected: No deadlocks

#### Connection Pooling
- Input: Many concurrent connections
- Expected: Proper connection management
```

## Examples

### Authentication Module

```markdown
## Tests

### Unit Tests

#### hash_password(password)
- Input: hash_password("secret")
- Expected: Hashed password string

- Input: hash_password("")
- Expected: ValueError

#### verify_password(password, hash)
- Input: verify_password("secret", hash_of_secret)
- Expected: True

- Input: verify_password("wrong", hash_of_secret)
- Expected: False

### Integration Tests

#### Login Flow
- Input: POST /login with valid credentials
- Expected: JWT token returned

- Input: POST /login with invalid credentials
- Expected: 401 Unauthorized

- Input: POST /login with expired account
- Expected: 403 Forbidden

### Security Tests

#### Brute Force Protection
- Input: 5 failed login attempts
- Expected: Account locked for 15 minutes

#### Password Strength
- Input: Weak password "123456"
- Expected: Rejected with strength requirements

#### Token Expiration
- Input: Expired JWT token
- Expected: 401 Unauthorized
```

### API Client

```markdown
## Tests

### Unit Tests

#### request(method, url, data)
- Input: request("GET", "/users", None)
- Expected: GET request to /users

- Input: request("POST", "/users", data)
- Expected: POST request with data

#### handle_response(response)
- Input: 200 OK response
- Expected: Parsed JSON data

- Input: 404 Not Found
- Expected: NotFoundError

### Integration Tests

#### API Workflow
- Input: GET /users → POST /users → PUT /users/1 → DELETE /users/1
- Expected: Full CRUD cycle works

### Performance Tests

#### Response Time
- Input: 100 requests
- Expected: All complete within 10 seconds

#### Rate Limiting
- Input: 1000 requests per minute
- Expected: Rate limit enforced
```

### Data Processing

```markdown
## Tests

### Unit Tests

#### process_data(data)
- Input: [1, 2, 3]
- Expected: Processed data

- Input: []
- Expected: Empty result

- Input: None
- Expected: ValueError

### Integration Tests

#### File Processing
- Input: CSV file with 1000 rows
- Expected: All rows processed

- Input: Corrupted file
- Expected: Graceful error handling

### Edge Case Tests

#### Large Data
- Input: 1 million rows
- Expected: Processes without memory issues

#### Special Characters
- Input: Data with Unicode characters
- Expected: Handled correctly

### Performance Tests

#### Processing Speed
- Input: 10MB file
- Expected: Processed within 5 seconds
```

### CLI Tool

```markdown
## Tests

### Unit Tests

#### parse_args(args)
- Input: ["--name", "test"]
- Expected: {"name": "test"}

- Input: ["--verbose"]
- Expected: {"verbose": True}

### Integration Tests

#### Command Execution
- Input: cli("init", "--name", "project")
- Expected: Project initialized

- Input: cli("build")
- Expected: Project built

### Edge Case Tests

#### Invalid Arguments
- Input: ["--invalid"]
- Expected: Helpful error message

#### Missing Arguments
- Input: ["--name"]
- Expected: Error about missing value

### Usability Tests

#### Help Text
- Input: cli("--help")
- Expected: Help text displayed

#### Version
- Input: cli("--version")
- Expected: Version displayed
```

### Database Module

```markdown
## Tests

### Unit Tests

#### connect(database)
- Input: connect("sqlite:///:memory:")
- Expected: Connection object

- Input: connect("invalid://url")
- Expected: ConnectionError

#### query(sql)
- Input: query("SELECT 1")
- Expected: Result set

### Integration Tests

#### CRUD Operations
- Input: Insert, select, update, delete
- Expected: All operations successful

#### Transactions
- Input: Transaction with commit
- Expected: Changes persisted

- Input: Transaction with rollback
- Expected: Changes reverted

### Performance Tests

#### Query Performance
- Input: Complex query on large table
- Expected: Returns within 1 second

#### Connection Pool
- Input: 100 concurrent connections
- Expected: All connections managed properly
```

### Webhook Handler

```markdown
## Tests

### Unit Tests

#### verify_signature(payload, signature)
- Input: Valid signature
- Expected: True

- Input: Invalid signature
- Expected: False

#### parse_payload(body)
- Input: Valid JSON
- Expected: Parsed data

- Input: Invalid JSON
- Expected: ParseError

### Integration Tests

#### Webhook Flow
- Input: Valid webhook request
- Expected: 200 OK processed

- Input: Invalid webhook request
- Expected: 400 Bad Request

### Security Tests

#### Signature Verification
- Input: Request with valid signature
- Expected: Processed

- Input: Request with invalid signature
- Expected: 401 Unauthorized

#### Replay Attack
- Input: Same request twice
- Expected: Second request rejected

### Performance Tests

#### Throughput
- Input: 100 webhooks per second
- Expected: All processed

#### Latency
- Input: Single webhook
- Expected: Processed within 100ms
```

## Edge Cases

### 1. Empty Input

When input is empty:

```markdown
## Tests

### Empty Input
- Input: None
- Expected: ValueError or default

- Input: ""
- Expected: ValueError or default

- Input: []
- Expected: ValueError or default
```

**Solution**: Define behavior for empty input.

### 2. Null Values

When values are null:

```markdown
## Tests

### Null Values
- Input: {"name": None}
- Expected: Handle appropriately

- Input: {"data": null}
- Expected: Handle appropriately
```

**Solution**: Define null handling.

### 3. Boundary Values

At boundary values:

```markdown
## Tests

### Boundary Values
- Input: 0
- Expected: Handle appropriately

- Input: MAX_VALUE
- Expected: Handle appropriately

- Input: MIN_VALUE
- Expected: Handle appropriately
```

**Solution**: Define boundary behavior.

### 4. Special Characters

With special characters:

```markdown
## Tests

### Special Characters
- Input: "<script>alert('xss')</script>"
- Expected: Sanitized

- Input: "'; DROP TABLE users; --"
- Expected: Sanitized
```

**Solution**: Define sanitization rules.

### 5. Unicode

With Unicode characters:

```markdown
## Tests

### Unicode
- Input: "你好"
- Expected: Handled correctly

- Input: "🎉"
- Expected: Handled correctly

- Input: "é"
- Expected: Handled correctly
```

**Solution**: Define Unicode handling.

### 6. Large Data

With large data:

```markdown
## Tests

### Large Data
- Input: 1GB file
- Expected: Processed without memory issues

- Input: 1 million rows
- Expected: Processed in reasonable time
```

**Solution**: Define limits and chunking.

### 7. Concurrent Access

With concurrent access:

```markdown
## Tests

### Concurrent Access
- Input: 100 simultaneous requests
- Expected: No data corruption

- Input: Race condition scenario
- Expected: Proper synchronization
```

**Solution**: Define concurrency handling.

### 8. Network Errors

With network errors:

```markdown
## Tests

### Network Errors
- Input: Connection timeout
- Expected: Retry or error

- Input: DNS failure
- Expected: Error message
```

**Solution**: Define error handling.

### 9. Permission Errors

With permission errors:

```markdown
## Tests

### Permission Errors
- Input: Insufficient permissions
- Expected: PermissionError

- Input: Invalid API key
- Expected: AuthenticationError
```

**Solution**: Define permission handling.

### 10. Timeouts

With timeouts:

```markdown
## Tests

### Timeouts
- Input: Operation takes too long
- Expected: TimeoutError

- Input: Slow network
- Expected: Proper timeout handling
```

**Solution**: Define timeout behavior.

## Best Practices

### 1. Test Early, Test Often

Write tests early and run them frequently.

### 2. Independent Tests

Make tests independent of each other.

### 3. Repeatable Tests

Ensure tests produce the same results.

### 4. Self-Validating Tests

Tests should have clear pass/fail criteria.

### 5. Timely Tests

Write tests at the appropriate time.

### 6. Test Coverage

Aim for high test coverage.

### 7. Test Data Management

Manage test data properly.

### 8. Test Automation

Automate test execution.

### 9. Test Reporting

Generate clear test reports.

### 10. Test Maintenance

Maintain tests regularly.

## Common Patterns

### Pattern 1: Arrange-Act-Assert

```markdown
## Tests

### Test Name
- Arrange: Set up test data
- Act: Perform operation
- Assert: Verify result
```

### Pattern 2: Given-When-Then

```markdown
## Tests

### Test Name
- Given: Preconditions
- When: Action
- Then: Expected result
```

### Pattern 3: Input-Output

```markdown
## Tests

### Test Name
- Input: Test input
- Expected: Expected output
```

### Pattern 4: Scenario

```markdown
## Tests

### Test Name
- Scenario: Description
- Steps: Step 1, Step 2, Step 3
- Expected: Expected outcome
```

### Pattern 5: Data-Driven

```markdown
## Tests

### Test Name
- Dataset 1: Input → Expected
- Dataset 2: Input → Expected
- Dataset 3: Input → Expected
```

### Pattern 6: Boundary Testing

```markdown
## Tests

### Test Name
- Below boundary: Input → Expected
- At boundary: Input → Expected
- Above boundary: Input → Expected
```

### Pattern 7: Negative Testing

```markdown
## Tests

### Test Name
- Invalid input: Input → Expected error
- Missing input: Input → Expected error
- Unauthorized: Input → Expected error
```

### Pattern 8: Performance Testing

```markdown
## Tests

### Test Name
- Load: Number of concurrent users
- Expected: Response time, throughput
```

### Pattern 9: Security Testing

```markdown
## Tests

### Test Name
- Attack scenario: Description
- Expected: Security measure works
```

### Pattern 10: Integration Testing

```markdown
## Tests

### Test Name
- Components: Component A, Component B
- Interaction: How they interact
- Expected: Correct behavior
```

## Validation Rules

### Rule 1: Tests Must Be Complete

```python
def validate_completeness(tests: list[dict], functionality: list[str]) -> list[str]:
    missing = []
    for func in functionality:
        if not any(func in t['name'] for t in tests):
            missing.append(f"Missing tests for: {func}")
    return missing
```

### Rule 2: Tests Must Be Independent

```python
def validate_independence(tests: list[dict]) -> list[str]:
    issues = []
    for i, test1 in enumerate(tests):
        for test2 in tests[i+1:]:
            if shares_state(test1, test2):
                issues.append(f"Tests share state: {test1['name']} and {test2['name']}")
    return issues
```

### Rule 3: Tests Must Be Repeatable

```python
def validate_repeatable(tests: list[dict]) -> bool:
    # Check for random or time-dependent values
    for test in tests:
        if 'random' in test['input'].lower():
            return False
        if 'time' in test['input'].lower():
            return False
    return True
```

### Rule 4: Tests Must Be Clear

```python
def validate_clarity(tests: list[dict]) -> list[str]:
    issues = []
    for test in tests:
        if len(test['name']) < 5:
            issues.append(f"Test name too short: {test['name']}")
        if not test['expected']:
            issues.append(f"Missing expected result: {test['name']}")
    return issues
```

### Rule 5: Tests Must Be Automatable

```python
def validate_automatable(tests: list[dict]) -> list[str]:
    issues = []
    for test in tests:
        if 'manual' in test['name'].lower():
            issues.append(f"Test not automatable: {test['name']}")
        if 'human' in test['input'].lower():
            issues.append(f"Test requires human: {test['name']}")
    return issues
```

## Related Sections

- **[Purpose](purpose.md)**: Module purpose
- **[Examples](examples.md)**: Usage examples
- **[Rules](rules.md)**: Behavioral constraints
- **[Workflow](workflow.md)**: Process flow
- **[Python](python.md)**: Python implementation
- **[JavaScript](javascript.md)**: JavaScript implementation

## FAQ

### Q: How many tests should I include?

**A:** Include enough tests to cover all functionality, typically 20-100 tests.

### Q: Should I include all test types?

**A:** Include unit tests, integration tests, and edge case tests at minimum.

### Q: How do I test edge cases?

**A:** Test boundary values, empty inputs, and error conditions.

### Q: Should I include performance tests?

**A:** Yes, for performance-critical modules.

### Q: How do I organize tests?

**A:** Group by test type or functionality.

### Q: Should I include test data?

**A:** Yes, provide sample test data.

### Q: How do I test security?

**A:** Include security tests for authentication and authorization.

### Q: Should I automate tests?

**A:** Yes, automate as many tests as possible.

### Q: How do I handle test failures?

**A:** Investigate and fix the root cause.

### Q: Should I include test coverage?

**A:** Yes, aim for high coverage.

### Q: How do I test integration?

**A:** Test component interaction and data flow.

### Q: Should I include negative tests?

**A:** Yes, test error conditions and invalid inputs.

### Q: How do I test concurrency?

**A:** Include tests for concurrent access and race conditions.

### Q: Should I include end-to-end tests?

**A:** Yes, for critical user workflows.

### Q: How do I test APIs?

**A:** Include tests for all endpoints and methods.

### Q: Should I test external dependencies?

**A:** Mock external dependencies for unit tests.

### Q: How do I handle test data?

**A:** Use test fixtures and factories.

### Q: Should I include regression tests?

**A:** Yes, include tests for fixed bugs.

### Q: How do I test error handling?

**A:** Include tests for error conditions and exceptions.

### Q: Should I include load tests?

**A:** Yes, for high-load scenarios.

## Implementation Notes

### Test Extraction

```python
import re

def extract_tests(content: str) -> list[dict]:
    tests = []
    in_tests = False
    current_test = None
    
    for line in content.split('\n'):
        if line.strip().startswith('## Tests'):
            in_tests = True
            continue
        
        if in_tests and line.startswith('##'):
            break
        
        if in_tests:
            if line.startswith('### '):
                if current_test:
                    tests.append(current_test)
                current_test = {'name': line[4:], 'input': '', 'expected': ''}
            
            elif current_test:
                if line.strip().startswith('- Input:'):
                    current_test['input'] = line.split(':', 1)[1].strip()
                elif line.strip().startswith('- Expected:'):
                    current_test['expected'] = line.split(':', 1)[1].strip()
    
    if current_test:
        tests.append(current_test)
    
    return tests
```

### Test Validation

```python
def validate_tests(tests: list[dict]) -> list[str]:
    errors = []
    
    for test in tests:
        if not test['name']:
            errors.append("Empty test name")
        
        if not test['input']:
            errors.append(f"Missing input for: {test['name']}")
        
        if not test['expected']:
            errors.append(f"Missing expected for: {test['name']}")
    
    return errors
```

### Test Documentation Generator

```python
def document_tests(tests: list[dict]) -> str:
    docs = "# Tests\n\n"
    
    for test in tests:
        docs += f"### {test['name']}\n"
        docs += f"- Input: {test['input']}\n"
        docs += f"- Expected: {test['expected']}\n\n"
    
    return docs
```

## References

- [MAM Specification - Tests](../SPEC.md#tests)
- [Testing Documentation](https://docs.python.org/3/library/unittest.html)
- [pytest Documentation](https://docs.pytest.org/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable