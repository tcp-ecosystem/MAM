# Rules Section

## Description
The Rules section defines behavioral constraints for the module. It specifies what the module should and should not do, including error handling, validation, and operational guidelines.

The Rules section serves as:
- **Behavioral constraints**: What the module must and must not do
- **Error handling**: How errors should be handled
- **Validation rules**: Input and output validation
- **Security constraints**: Security-related rules
- **Performance constraints**: Performance requirements
- **Compliance rules**: Regulatory and compliance requirements

## Syntax

```markdown
## Rules

- [ ] Rule description
- [ ] Another rule
```

### Rule Format

Each rule is a checkbox item:

```markdown
## Rules

- [ ] Must validate inputs before processing
- [ ] Must not expose sensitive data
- [ ] Must handle errors gracefully
```

### Categorized Rules

Use headers to organize rules:

```markdown
## Rules

### Validation
- [ ] Must validate all inputs
- [ ] Must sanitize user data

### Security
- [ ] Must not expose secrets
- [ ] Must use HTTPS

### Error Handling
- [ ] Must catch all exceptions
- [ ] Must log errors
```

## Rules

1. **Valid Rules**: Rules must be valid and enforceable
2. **Specific**: Rules must be specific and clear
3. **Enforceable**: Rules must be enforceable
4. **Consistent**: Rules must be consistent with each other
5. **Complete**: Rules must cover all important aspects
6. **Documented**: Rules must be documented
7. **Testable**: Rules must be testable
8. **No Contradictions**: Rules must not contradict each other
9. **Reasonable**: Rules must be reasonable
10. **Up-to-date**: Rules must be current

### Rule Types

| Type | Description | Example |
|------|-------------|---------|
| Must | Required | Must validate inputs |
| Should | Recommended | Should handle errors |
| May | Optional | May log actions |
| Must Not | Prohibited | Must not expose secrets |

## Description

The Rules section defines behavioral constraints:

### 1. Input Validation Rules

Rules for input validation:

```markdown
## Rules

### Input Validation
- [ ] Must validate all input parameters
- [ ] Must check for null or undefined values
- [ ] Must validate data types
- [ ] Must validate data ranges
- [ ] Must sanitize string inputs
- [ ] Must reject invalid inputs
```

### 2. Security Rules

Rules for security:

```markdown
## Rules

### Security
- [ ] Must not expose sensitive data
- [ ] Must use HTTPS for external calls
- [ ] Must validate authentication
- [ ] Must authorize access
- [ ] Must encrypt sensitive data
- [ ] Must log security events
```

### 3. Error Handling Rules

Rules for error handling:

```markdown
## Rules

### Error Handling
- [ ] Must catch all exceptions
- [ ] Must not swallow errors
- [ ] Must provide meaningful error messages
- [ ] Must log errors
- [ ] Must handle edge cases
- [ ] Must fail gracefully
```

### 4. Performance Rules

Rules for performance:

```markdown
## Rules

### Performance
- [ ] Must respond within timeout
- [ ] Must not block the main thread
- [ ] Must use caching where appropriate
- [ ] Must optimize database queries
- [ ] Must limit resource usage
- [ ] Must handle concurrent access
```

### 5. Data Integrity Rules

Rules for data integrity:

```markdown
## Rules

### Data Integrity
- [ ] Must maintain data consistency
- [ ] Must use transactions where needed
- [ ] Must validate data before storage
- [ ] Must not corrupt data
- [ ] Must handle partial failures
- [ ] Must provide rollback capability
```

### 6. API Rules

Rules for API behavior:

```markdown
## Rules

### API
- [ ] Must follow REST conventions
- [ ] Must return appropriate status codes
- [ ] Must validate request bodies
- [ ] Must handle pagination
- [ ] Must rate limit requests
- [ ] Must version APIs
```

### 7. Logging Rules

Rules for logging:

```markdown
## Rules

### Logging
- [ ] Must log important operations
- [ ] Must not log sensitive data
- [ ] Must use appropriate log levels
- [ ] Must include context in logs
- [ ] Must rotate logs
- [ ] Must aggregate logs
```

### 8. Configuration Rules

Rules for configuration:

```markdown
## Rules

### Configuration
- [ ] Must use environment variables
- [ ] Must not hardcode secrets
- [ ] Must validate configuration
- [ ] Must provide defaults
- [ ] Must document configuration
- [ ] Must support multiple environments
```

### 9. Dependency Rules

Rules for dependencies:

```markdown
## Rules

### Dependencies
- [ ] Must use stable versions
- [ ] Must not use deprecated packages
- [ ] Must pin versions
- [ ] Must audit dependencies
- [ ] Must update regularly
- [ ] Must minimize dependencies
```

### 10. Documentation Rules

Rules for documentation:

```markdown
## Rules

### Documentation
- [ ] Must document public APIs
- [ ] Must include examples
- [ ] Must document edge cases
- [ ] Must document limitations
- [ ] Must keep docs updated
- [ ] Must document configuration
```

## Examples

### Authentication Module

```markdown
## Rules

### Security
- [ ] Must not store plaintext passwords
- [ ] Must hash passwords with bcrypt
- [ ] Must validate JWT tokens
- [ ] Must expire tokens appropriately
- [ ] Must not expose tokens in URLs
- [ ] Must use secure cookie flags

### Input Validation
- [ ] Must validate email format
- [ ] Must enforce password strength
- [ ] Must sanitize usernames
- [ ] Must limit input length

### Error Handling
- [ ] Must not reveal if user exists
- [ ] Must rate limit login attempts
- [ ] Must log authentication failures
- [ ] Must handle account lockout
```

### API Client

```markdown
## Rules

### Network
- [ ] Must use HTTPS
- [ ] Must set appropriate timeouts
- [ ] Must retry failed requests
- [ ] Must handle rate limiting

### Error Handling
- [ ] Must handle HTTP errors
- [ ] Must parse error responses
- [ ] Must log failed requests
- [ ] Must not expose API keys

### Performance
- [ ] Must cache responses
- [ ] Must limit request frequency
- [ ] Must handle large responses
- [ ] Must not block calling code
```

### Data Processing

```markdown
## Rules

### Data Integrity
- [ ] Must validate data formats
- [ ] Must handle missing data
- [ ] Must not corrupt data
- [ ] Must provide rollback

### Performance
- [ ] Must process in batches
- [ ] Must not load all data into memory
- [ ] Must use streaming for large files
- [ ] Must optimize processing time

### Error Handling
- [ ] Must handle malformed data
- [ ] Must skip invalid records
- [ ] Must log processing errors
- [ ] Must report progress
```

### Database Module

```markdown
## Rules

### Data Integrity
- [ ] Must use transactions
- [ ] Must validate foreign keys
- [ ] Must not allow SQL injection
- [ ] Must handle concurrent writes

### Performance
- [ ] Must use connection pooling
- [ ] Must index frequently queried fields
- [ ] Must optimize query performance
- [ ] Must not N+1 query

### Security
- [ ] Must use parameterized queries
- [ ] Must encrypt sensitive data
- [ ] Must audit data access
- [ ] Must restrict database permissions
```

### CLI Tool

```markdown
## Rules

### Usability
- [ ] Must provide help text
- [ ] Must validate arguments
- [ ] Must handle keyboard interrupts
- [ ] Must provide progress feedback

### Error Handling
- [ ] Must show user-friendly errors
- [ ] Must suggest fixes
- [ ] Must not crash unexpectedly
- [ ] Must exit with appropriate codes

### Performance
- [ ] Must respond quickly
- [ ] Must not block terminal
- [ ] Must handle large outputs
- [ ] Must support piping
```

### File Processing

```markdown
## Rules

### Safety
- [ ] Must not overwrite without confirmation
- [ ] Must handle permission errors
- [ ] Must validate file paths
- [ ] Must not follow symlinks by default

### Performance
- [ ] Must stream large files
- [ ] Must not load entire file into memory
- [ ] Must handle concurrent access
- [ ] Must use appropriate buffering

### Error Handling
- [ ] Must handle missing files
- [ ] Must handle corrupted files
- [ ] Must log file operations
- [ ] Must provide meaningful errors
```

### Network Service

```markdown
## Rules

### Security
- [ ] Must validate all inputs
- [ ] Must rate limit connections
- [ ] Must handle malformed requests
- [ ] Must not expose internal errors

### Performance
- [ ] Must handle concurrent connections
- [ ] Must not block on slow clients
- [ ] Must use connection pooling
- [ ] Must set appropriate timeouts

### Reliability
- [ ] Must handle disconnections
- [ ] Must retry failed operations
- [ ] Must not lose data
- [ ] Must provide health checks
```

### Webhook Handler

```markdown
## Rules

### Security
- [ ] Must validate webhook signatures
- [ ] Must only accept known sources
- [ ] Must not expose secrets
- [ ] Must log webhook events

### Reliability
- [ ] Must handle retries
- [ ] Must be idempotent
- [ ] Must not process duplicates
- [ ] Must provide acknowledgment

### Performance
- [ ] Must process quickly
- [ ] Must not block other requests
- [ ] Must handle high volume
- [ ] Must queue for later processing
```

### Cache Module

```markdown
## Rules

### Consistency
- [ ] Must invalidate on updates
- [ ] Must handle stale data
- [ ] Must not serve expired data
- [ ] Must provide cache statistics

### Performance
- [ ] Must not block on cache misses
- [ ] Must use appropriate eviction
- [ ] Must limit memory usage
- [ ] Must handle cache storms

### Reliability
- [ ] Must handle cache failures
- [ ] Must fall back to source
- [ ] Must not lose critical data
- [ ] Must provide cache warming
```

### Queue Module

```markdown
## Rules

### Reliability
- [ ] Must not lose messages
- [ ] Must handle failures
- [ ] Must provide retry logic
- [ ] Must ensure ordering when needed

### Performance
- [ ] Must handle high throughput
- [ ] Must not block producers
- [ ] Must distribute consumers
- [ ] Must batch when possible

### Monitoring
- [ ] Must track queue depth
- [ ] Must alert on backlog
- [ ] Must log processing times
- [ ] Must provide metrics
```

## Edge Cases

### 1. Contradictory Rules

When rules contradict:

```markdown
## Rules

- [ ] Must use HTTPS
- [ ] Must work offline
```

**Solution**: Remove contradictory rules.

### 2. Unenforceable Rules

When rules can't be enforced:

```markdown
## Rules

- [ ] Must be fast
```

**Solution**: Make rules specific and measurable.

### 3. Overly Strict Rules

When rules are too strict:

```markdown
## Rules

- [ ] Must never fail
```

**Solution**: Allow for graceful failure.

### 4. Ambiguous Rules

When rules are unclear:

```markdown
## Rules

- [ ] Must do it right
```

**Solution**: Be specific about what "right" means.

### 5. Missing Rules

When important rules are missing:

```markdown
## Rules

- [ ] Must validate inputs
# Missing: Must handle errors
```

**Solution**: Add comprehensive rules.

### 6. Redundant Rules

When rules duplicate:

```markdown
## Rules

- [ ] Must validate inputs
- [ ] Must check input validity
```

**Solution**: Remove redundant rules.

### 7. Conflicting Priorities

When rules conflict:

```markdown
## Rules

- [ ] Must be fast
- [ ] Must be secure
```

**Solution**: Prioritize and clarify trade-offs.

### 8. Outdated Rules

When rules are outdated:

```markdown
## Rules

- [ ] Must use HTTP
```

**Solution**: Update to current standards.

### 9. Missing Context

When rules lack context:

```markdown
## Rules

- [ ] Must validate
```

**Solution**: Specify what to validate.

### 10. Overly Broad Rules

When rules are too broad:

```markdown
## Rules

- [ ] Must be good
```

**Solution**: Break down into specific rules.

## Best Practices

### 1. Be Specific

Be specific about requirements:

```markdown
# Bad
Must validate inputs

# Good
Must validate email format using RFC 5322
```

### 2. Make Rules Measurable

Make rules measurable:

```markdown
# Bad
Must be fast

# Good
Must respond within 100ms
```

### 3. Use Consistent Language

Use consistent terminology:

```markdown
# Bad
- Must validate
- Should check

# Good
- Must validate
- Must check
```

### 4. Prioritize Rules

Prioritize rules by importance:

```markdown
## Rules

### Critical
- [ ] Must not expose secrets

### Important
- [ ] Must validate inputs

### Nice to have
- [ ] Should log actions
```

### 5. Group Related Rules

Group related rules:

```markdown
## Rules

### Security
- [ ] Rule 1
- [ ] Rule 2

### Performance
- [ ] Rule 3
- [ ] Rule 4
```

### 6. Document Rationale

Explain why rules exist:

```markdown
## Rules

- [ ] Must validate inputs (prevents injection attacks)
```

### 7. Review Regularly

Review and update rules regularly.

### 8. Test Rules

Ensure rules are testable.

### 9. Avoid Negatives

Use positive language when possible:

```markdown
# Bad
Must not fail

# Good
Must handle errors gracefully
```

### 10. Keep Simple

Keep rules simple and clear.

## Common Patterns

### Pattern 1: Minimal Rules

```markdown
## Rules

- [ ] Must validate inputs
- [ ] Must handle errors
- [ ] Must not expose secrets
```

### Pattern 2: Security-First Rules

```markdown
## Rules

### Security
- [ ] Must validate all inputs
- [ ] Must use HTTPS
- [ ] Must not expose secrets
- [ ] Must log security events
```

### Pattern 3: Performance-First Rules

```markdown
## Rules

### Performance
- [ ] Must respond within 100ms
- [ ] Must use caching
- [ ] Must not block main thread
- [ ] Must handle concurrent access
```

### Pattern 4: Compliance Rules

```markdown
## Rules

### Compliance
- [ ] Must follow GDPR
- [ ] Must audit access
- [ ] Must encrypt PII
- [ ] Must provide data export
```

### Pattern 5: Reliability Rules

```markdown
## Rules

### Reliability
- [ ] Must handle failures
- [ ] Must retry operations
- [ ] Must not lose data
- [ ] Must provide fallbacks
```

### Pattern 6: Usability Rules

```markdown
## Rules

### Usability
- [ ] Must provide help text
- [ ] Must validate inputs
- [ ] Must show progress
- [ ] Must handle interrupts
```

### Pattern 7: Complete Rules

```markdown
## Rules

### Security
- [ ] Must validate inputs
- [ ] Must not expose secrets

### Performance
- [ ] Must respond within 100ms
- [ ] Must use caching

### Reliability
- [ ] Must handle errors
- [ ] Must retry operations

### Usability
- [ ] Must provide help
- [ ] Must show progress
```

### Pattern 8: Phase-Specific Rules

```markdown
## Rules

### Development
- [ ] Must write tests
- [ ] must document code

### Testing
- [ ] Must achieve 80% coverage
- [ ] Must test edge cases

### Production
- [ ] Must monitor performance
- [ ] Must log errors
```

### Pattern 9: Role-Based Rules

```markdown
## Rules

### User
- [ ] Must authenticate
- [ ] Must have permissions

### Admin
- [ ] Must audit actions
- [ ] Must not abuse privileges

### System
- [ ] Must validate all inputs
- [ ] Must handle errors
```

### Pattern 10: Comprehensive Rules

```markdown
## Rules

### Critical (Must)
- [ ] Must validate inputs
- [ ] Must not expose secrets
- [ ] Must handle errors

### Important (Should)
- [ ] Should log actions
- [ ] Should cache results
- [ ] Should optimize performance

### Optional (May)
- [ ] May provide analytics
- [ ] May support plugins
- [ ] May provide metrics
```

## Validation Rules

### Rule 1: Rules Must Be Specific

```python
def validate_specificity(rule: str) -> bool:
    vague_words = ['good', 'bad', 'fast', 'slow', 'properly']
    return not any(w in rule.lower() for w in vague_words)
```

### Rule 2: Rules Must Be Measurable

```python
def validate_measurable(rule: str) -> bool:
    measurable_patterns = ['within', 'must', 'should', 'at least', 'at most']
    return any(p in rule.lower() for p in measurable_patterns)
```

### Rule 3: Rules Must Be Consistent

```python
def validate_consistency(rules: list[str]) -> list[str]:
    conflicts = []
    # Check for conflicting rules
    for i, rule1 in enumerate(rules):
        for rule2 in rules[i+1:]:
            if is_conflict(rule1, rule2):
                conflicts.append(f"Conflict: {rule1} vs {rule2}")
    return conflicts
```

### Rule 4: Rules Must Be Complete

```python
def validate_completeness(rules: list[str]) -> list[str]:
    required_categories = ['security', 'error handling', 'validation']
    missing = []
    for cat in required_categories:
        if not any(cat in r.lower() for r in rules):
            missing.append(f"Missing category: {cat}")
    return missing
```

### Rule 5: Rules Must Be Testable

```python
def validate_testable(rule: str) -> bool:
    testable_verbs = ['must', 'should', 'validate', 'check', 'ensure']
    return any(v in rule.lower() for v in testable_verbs)
```

## Related Sections

- **[Purpose](purpose.md)**: Module purpose
- **[Capabilities](capabilities.md)**: Module capabilities
- **[Permissions](permissions.md)**: Module permissions
- **[Tests](tests.md)**: Testing rules
- **[Examples](examples.md)**: Usage examples
- **[Outputs](outputs.md)**: Output specifications

## FAQ

### Q: How many rules should I include?

**A:** Include 10-30 rules covering critical aspects. Quality over quantity.

### Q: Should I include all types of rules?

**A:** Include rules for security, error handling, performance, and other relevant aspects.

### Q: How do I handle contradictory rules?

**A:** Remove contradictions or clarify priorities.

### Q: Can I have optional rules?

**A:** Yes, use "should" for optional rules.

### Q: How do I make rules measurable?

**A:** Use specific numbers and timeframes.

### Q: Should I document why rules exist?

**A:** Yes, documentation helps with compliance.

### Q: How often should I update rules?

**A:** Review regularly and update as needed.

### Q: Can I have rules for different environments?

**A:** Yes, use headers to separate environment-specific rules.

### Q: How do I test rules?

**A:** Write tests to verify rule compliance.

### Q: Should I include examples?

**A:** Yes, examples help clarify rules.

### Q: How do I handle edge cases?

**A:** Include rules for edge cases.

### Q: Can I have rules for different roles?

**A:** Yes, use headers to separate role-specific rules.

### Q: How do I prioritize rules?

**A:** Use categories like Critical, Important, Optional.

### Q: Should I include negative rules?

**A:** Yes, use "must not" for prohibitions.

### Q: How do I keep rules updated?

**A:** Review regularly and version control changes.

### Q: Can I have rules for different phases?

**A:** Yes, use headers to separate phase-specific rules.

### Q: How do I document rules?

**A:** Use clear language and provide rationale.

### Q: Should I include all edge cases?

**A:** Include rules for common edge cases.

### Q: How do I handle conflicts?

**A:** Document resolution and update rules.

### Q: Can I have rules for external dependencies?

**A:** Yes, include rules for dependency management.

## Implementation Notes

### Rule Extraction

```python
import re

def extract_rules(content: str) -> list[dict]:
    rules = []
    in_rules = False
    
    for line in content.split('\n'):
        if line.strip().startswith('## Rules'):
            in_rules = True
            continue
        
        if in_rules and line.startswith('##'):
            break
        
        if in_rules and line.strip().startswith('- [ ]'):
            match = re.match(r'- \[ \]\s*(.*)', line)
            if match:
                rules.append({
                    'text': match.group(1),
                    'type': determine_rule_type(match.group(1)),
                    'testable': is_testable(match.group(1))
                })
    
    return rules
```

### Rule Validation

```python
def validate_rules(rules: list[dict]) -> list[str]:
    errors = []
    
    for rule in rules:
        if not rule['text']:
            errors.append("Empty rule")
        
        if not is_specific(rule['text']):
            errors.append(f"Rule too vague: {rule['text']}")
        
        if not rule['testable']:
            errors.append(f"Rule not testable: {rule['text']}")
    
    return errors
```

### Rule Documentation Generator

```python
def document_rules(rules: list[dict]) -> str:
    docs = "# Rules\n\n"
    
    for rule in rules:
        docs += f"- [ ] {rule['text']}"
        if rule['type'] == 'critical':
            docs += " (CRITICAL)"
        docs += "\n"
    
    return docs
```

## References

- [MAM Specification - Rules](../SPEC.md#rules)
- [RFC 2119 - Key words](https://datatracker.ietf.org/doc/html/rfc2119)
- [Behavioral Specifications](https://en.wikipedia.org/wiki/Behavioral_specification)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable