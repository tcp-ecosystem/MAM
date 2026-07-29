---
id: password-gen
version: 1.0.0
name: Password Generator
author: MAM Team
runtime: python
tags:
  - example
  - beginner
  - security
  - password
description: Generate secure random passwords with configurable complexity and strength assessment
---

# Password Generator Module

## Purpose

A password generator module that creates secure random passwords with configurable length and character sets. Includes password strength assessment based on entropy calculations and character diversity.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| length | int | No | Password length (default: 16, minimum: 8) |
| include_uppercase | bool | No | Include uppercase letters (default: True) |
| include_symbols | bool | bool | Include special symbols (default: True) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| password | string | The generated password |
| strength | string | Password strength rating: "weak", "fair", "strong", "very_strong" |

## Rules

- Minimum password length is 8 characters
- Default length is 16 characters if not specified
- Always include lowercase letters and digits
- Strength is based on entropy bits and character diversity
- Password must contain at least one character from each enabled set
- Cryptographically secure random generation must be used

## Python

```python
import secrets
import string


def generate_password(
    length: int = 16,
    include_uppercase: bool = True,
    include_symbols: bool = True,
) -> str:
    """
    Generate a secure random password.

    Args:
        length: Desired password length (minimum 8).
        include_uppercase: Include uppercase letters.
        include_symbols: Include special symbols.

    Returns:
        A secure random password string.
    """
    if length < 8:
        length = 8

    charset = string.ascii_lowercase + string.digits

    if include_uppercase:
        charset += string.ascii_uppercase

    if include_symbols:
        charset += "!@#$%^&*()-_=+[]{}|;:,.<>?"

    password = ""
    required = [secrets.choice(string.ascii_lowercase), secrets.choice(string.digits)]

    if include_uppercase:
        required.append(secrets.choice(string.ascii_uppercase))

    if include_symbols:
        required.append(secrets.choice("!@#$%^&*()-_=+[]{}|;:,.<>?"))

    password = "".join(required)

    remaining_length = length - len(password)
    password += "".join(secrets.choice(charset) for _ in range(remaining_length))

    password_list = list(password)
    secrets.SystemRandom().shuffle(password_list)

    return "".join(password_list)


def assess_strength(password: str) -> str:
    """
    Assess the strength of a password.

    Args:
        password: The password to assess.

    Returns:
        Strength rating: "weak", "fair", "strong", or "very_strong".
    """
    length = len(password)
    has_lower = any(c.islower() for c in password)
    has_upper = any(c.isupper() for c in password)
    has_digit = any(c.isdigit() for c in password)
    has_symbol = any(c in string.punctuation for c in password)

    charset_size = 0
    if has_lower:
        charset_size += 26
    if has_upper:
        charset_size += 26
    if has_digit:
        charset_size += 10
    if has_symbol:
        charset_size += 32

    import math
    entropy = length * math.log2(charset_size) if charset_size > 0 else 0

    diversity = sum([has_lower, has_upper, has_digit, has_symbol])

    if entropy < 28 or diversity < 2:
        return "weak"
    elif entropy < 50 or diversity < 3:
        return "fair"
    elif entropy < 70:
        return "strong"
    else:
        return "very_strong"
```

## Examples

```python
password = generate_password()
print(f"Password: {password}")
print(f"Strength: {assess_strength(password)}")

password = generate_password(length=12, include_uppercase=True, include_symbols=False)
print(f"Password: {password}")
print(f"Strength: {assess_strength(password)}")

password = generate_password(length=8, include_uppercase=False, include_symbols=False)
print(f"Password: {password}")
print(f"Strength: {assess_strength(password)}")
```

## Tests

```python
def test_default_password_length():
    password = generate_password()
    assert len(password) == 16


def test_custom_length():
    password = generate_password(length=24)
    assert len(password) == 24


def test_minimum_length():
    password = generate_password(length=4)
    assert len(password) >= 8


def test_no_uppercase():
    password = generate_password(length=20, include_uppercase=False, include_symbols=False)
    assert any(c.islower() for c in password)
    assert any(c.isdigit() for c in password)
    assert not any(c.isupper() for c in password)


def test_no_symbols():
    password = generate_password(length=20, include_symbols=False)
    assert not any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in password)


def test_strength_very_strong():
    password = generate_password(length=20, include_uppercase=True, include_symbols=True)
    assert assess_strength(password) in ("strong", "very_strong")


def test_strength_weak_short():
    password = "abc123"
    assert assess_strength(password) == "weak"


def test_strength_fair():
    password = "abcdefgh1234"
    assert assess_strength(password) in ("weak", "fair")


def test_strength_strong():
    password = "abcdefgh1234AB"
    assert assess_strength(password) in ("fair", "strong")


def test_password_contains_required_chars():
    for _ in range(100):
        password = generate_password(length=16, include_uppercase=True, include_symbols=True)
        assert any(c.islower() for c in password)
        assert any(c.isdigit() for c in password)
        assert any(c.isupper() for c in password)
        assert any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in password)
```
