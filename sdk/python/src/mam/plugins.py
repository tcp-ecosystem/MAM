"""
MAM Plugin System for Python
"""

from typing import Any, Callable, Dict, List


class PluginManager:
    def __init__(self):
        self.plugins: Dict[str, Callable] = {}
    
    def register(self, name: str, plugin: Callable):
        self.plugins[name] = plugin
    
    def get(self, name: str) -> Callable:
        return self.plugins.get(name)
    
    def list_plugins(self) -> List[str]:
        return list(self.plugins.keys())
