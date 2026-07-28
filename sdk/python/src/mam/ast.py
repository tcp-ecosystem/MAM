"""
MAM AST types for Python
"""

from typing import Any, Dict, List, Optional


class MAMModule:
    """Represents a parsed MAM module."""
    
    def __init__(self, name: str, version: str = "0.1.0", **kwargs: Any):
        self.name = name
        self.version = version
        self.sections: List[Dict[str, Any]] = []
        self.metadata: Dict[str, Any] = kwargs
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "sections": self.sections,
            "metadata": self.metadata,
        }
