"""Normalize a display name for the Interop Demo system.

LIR calls ``normalize(payload)`` with the JSON-decoded system inputs and
expects a JSON-compatible return value. Anything written to stdout or stderr
is captured as diagnostics and never mistaken for the result.
"""

from __future__ import annotations

from typing import Any


def normalize(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized name, its length, and its tokens."""
    if not isinstance(payload, dict):
        raise TypeError("normalize expects a JSON object input")

    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("normalize requires a non-empty string 'name'")

    normalized = " ".join(name.split()).lower()
    return {
        "name": normalized,
        "length": len(normalized),
        "tokens": normalized.split(),
    }
