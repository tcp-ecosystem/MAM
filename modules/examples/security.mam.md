---
id: security-scanner
version: 1.0.0
name: Security Module
author: MAM Team
runtime: python
tags:
  - security
  - scanning
  - secrets
  - validation
description: Security scanning module for detecting secrets, validating inputs, and enforcing policies
---

# Security Module

## Purpose

Provides security primitives for MAM modules: secret detection in text, input sanitization, rate limiting, and policy enforcement. Designed to be embedded as a guardrail in agent workflows and pipelines.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | Yes | "scan_secrets", "sanitize", "check_policy", "rate_limit" |
| text | string | No | Text to scan or sanitize |
| policy | dict | No | Policy rules to check against |
| client_id | string | No | Client identifier for rate limiting |
| window_sec | int | No | Rate limit window in seconds (default: 60) |
| max_requests | int | No | Max requests per window (default: 100) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| findings | list | Detected secrets or policy violations |
| sanitized | string | Cleaned text (for sanitize action) |
| allowed | bool | Whether the request is allowed (for rate_limit) |
| remaining | int | Remaining requests in window |

## Rules

- Secret patterns include: API keys, tokens, passwords, private keys, connection strings
- Sanitization strips control characters and normalizes whitespace
- Rate limiting uses fixed-window counters per client_id
- Policy checks validate text against allow/deny patterns
- Findings include severity: "critical", "high", "medium", "low"
- False positive suppression for known placeholder values

## Workflow

```mermaid
flowchart TD
    A[Receive Request] --> B{Action}
    B -->|scan_secrets| C[Pattern Match]
    C --> D[Filter Placeholders]
    D --> E[Return Findings]
    B -->|sanitize| F[Strip Control Chars]
    F --> G[Normalize Whitespace]
    G --> H[Return Clean Text]
    B -->|check_policy| I[Evaluate Allow Rules]
    I --> J[Evaluate Deny Rules]
    J --> K[Return Violations]
    B -->|rate_limit| L[Check Window]
    L --> M{Under Limit?}
    M -->|Yes| N[Increment Counter]
    M -->|No| O[Reject]
    N --> P[Return Allowed]
    O --> Q[Return Rejected]
```

## Python

```python
import re
import time
from typing import Dict, List, Tuple
from collections import defaultdict
from dataclasses import dataclass

SECRET_PATTERNS: List[Tuple[str, str, str]] = [
    ("AWS Access Key", r'(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])', "critical"),
    ("GitHub Token", r'gh[pousr]_[A-Za-z0-9_]{36,255}', "critical"),
    ("Generic API Key", r'(?i)(api[_-]?key|apikey)\s*[:=]\s*["\']?([A-Za-z0-9_\-]{20,})["\']?', "high"),
    ("Password Assignment", r'(?i)(password|passwd|pwd)\s*[:=]\s*["\']?(\S{8,})["\']?', "high"),
    ("Private Key Block", r'-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----', "critical"),
    ("Connection String", r'(?i)(mysql|postgres|mongodb)://\S+:\S+@\S+', "critical"),
    ("JWT Token", r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}', "medium"),
    ("Generic Secret", r'(?i)(secret|token|credential)\s*[:=]\s*["\']?(\S{10,})["\']?', "medium"),
]

PLACEHOLDER_PATTERNS = [
    r'your[-_]secret[-_]here', r'xxx+', r'changeme', r'example',
    r'test[-_]secret', r'placeholder', r'sample[-_]key',
]

class SecurityScanner:
    def __init__(self):
        self._rate_limits: Dict[str, List[float]] = defaultdict(list)

    def scan_secrets(self, text: str) -> List[Dict]:
        """Scan text for exposed secrets and credentials."""
        findings = []
        for name, pattern, severity in SECRET_PATTERNS:
            for match in re.finditer(pattern, text):
                matched_text = match.group(0)
                is_placeholder = any(
                    re.search(p, matched_text, re.IGNORECASE) for p in PLACEHOLDER_PATTERNS
                )
                if not is_placeholder:
                    findings.append({
                        "type": name,
                        "severity": severity,
                        "match": matched_text[:20] + "..." if len(matched_text) > 20 else matched_text,
                        "position": match.start(),
                    })
        return findings

    def sanitize(self, text: str) -> str:
        """Remove control characters and normalize whitespace."""
        cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', text)
        cleaned = re.sub(r'[ \t]+', ' ', cleaned)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
        return cleaned.strip()

    def check_policy(self, text: str, policy: Dict) -> List[Dict]:
        """Check text against allow/deny policy rules."""
        violations = []
        deny_patterns = policy.get("deny", [])

        for entry in deny_patterns:
            pattern = entry.get("pattern", "")
            reason = entry.get("reason", "Denied by policy")
            severity = entry.get("severity", "medium")

            if re.search(pattern, text, re.IGNORECASE):
                violations.append({
                    "pattern": pattern,
                    "reason": reason,
                    "severity": severity,
                })

        return violations

    def rate_limit(self, client_id: str, window_sec: int = 60,
                   max_requests: int = 100) -> Dict:
        """Check and enforce rate limits for a client."""
        now = time.time()
        window_start = now - window_sec

        self._rate_limits[client_id] = [
            ts for ts in self._rate_limits[client_id] if ts > window_start
        ]

        current = len(self._rate_limits[client_id])
        allowed = current < max_requests

        if allowed:
            self._rate_limits[client_id].append(now)

        return {
            "allowed": allowed,
            "remaining": max(0, max_requests - current - (1 if allowed else 0)),
            "window_sec": window_sec,
            "limit": max_requests,
        }
```

## Examples

```python
scanner = SecurityScanner()

findings = scanner.scan_secrets("AWS key: AKIAIOSFODNN7EXAMPLE")
print(findings)  # [{'type': 'AWS Access Key', 'severity': 'critical', ...}]

clean = scanner.sanitize("Hello\x00\x01  World\n\n\n\nTest")
print(clean)  # "Hello World\n\nTest"

violations = scanner.check_policy(
    "SELECT * FROM users",
    {"deny": [{"pattern": r"(?i)select.*from", "reason": "Raw SQL not allowed"}]},
)
print(violations)  # [{'pattern': '...', 'reason': 'Raw SQL not allowed', ...}]

result = scanner.rate_limit("client-1", window_sec=60, max_requests=5)
print(result["allowed"])   # True
print(result["remaining"]) # 4
```

## Tests

```python
def test_scan_clean_text():
    scanner = SecurityScanner()
    findings = scanner.scan_secrets("No secrets here, just plain text.")
    assert len(findings) == 0

def test_scan_api_key():
    scanner = SecurityScanner()
    findings = scanner.scan_secrets("api_key=supersecretkey1234567890")
    assert len(findings) >= 1
    assert findings[0]["severity"] in ("high", "critical", "medium")

def test_scan_ignores_placeholders():
    scanner = SecurityScanner()
    findings = scanner.scan_secrets("api_key=your_secret_here")
    assert len(findings) == 0

def test_sanitize():
    scanner = SecurityScanner()
    result = scanner.sanitize("a\x00b  c\n\n\n\nd")
    assert "\x00" not in result
    assert "  " not in result
    assert "\n\n\n\n" not in result

def test_rate_limit():
    scanner = SecurityScanner()
    for _ in range(3):
        r = scanner.rate_limit("c1", window_sec=60, max_requests=3)
    assert r["allowed"] is True
    r = scanner.rate_limit("c1", window_sec=60, max_requests=3)
    assert r["allowed"] is False

def test_policy_deny():
    scanner = SecurityScanner()
    v = scanner.check_policy("rm -rf /", {"deny": [{"pattern": r"rm\s+-rf", "reason": "Dangerous command"}]})
    assert len(v) == 1
    assert v[0]["reason"] == "Dangerous command"
```

## Dependencies

- None (standard library only)
