"""
MAM Python Package
"""

from .parser import parse_mam
from .ast import MAMModule

__all__ = ["parse_mam", "MAMModule"]
