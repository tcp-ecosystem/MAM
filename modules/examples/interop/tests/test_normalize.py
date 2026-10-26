"""Unit tests for the Python implementation used by the Interop Demo."""

from __future__ import annotations

import importlib.util
import pathlib
import unittest

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "src" / "normalize.py"
SPEC = importlib.util.spec_from_file_location("interop_normalize", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NormalizeTests(unittest.TestCase):
    def test_trims_and_lowercases(self) -> None:
        result = MODULE.normalize({"name": "  Ada   Lovelace  "})
        self.assertEqual(
            result,
            {
                "name": "ada lovelace",
                "length": 12,
                "tokens": ["ada", "lovelace"],
            },
        )

    def test_rejects_missing_name(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.normalize({})

    def test_rejects_non_object_payload(self) -> None:
        with self.assertRaises(TypeError):
            MODULE.normalize(["Ada"])


if __name__ == "__main__":
    unittest.main()
