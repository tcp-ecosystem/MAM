"""
MAM Plugin System.

Provides a extensible plugin architecture for MAM with registration,
discovery, lifecycle hooks, and hook-based event dispatch.
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Type

__all__ = [
    "Plugin",
    "PluginManager",
    "PluginHook",
    "PluginLifecycle",
    "PluginMeta",
]

logger = logging.getLogger(__name__)


class PluginLifecycle(Enum):
    """Lifecycle phases where plugins can be invoked."""

    PRE_PARSE = "pre_parse"
    POST_PARSE = "post_parse"
    PRE_VALIDATE = "pre_validate"
    POST_VALIDATE = "post_validate"
    PRE_EXECUTE = "pre_execute"
    POST_EXECUTE = "post_execute"
    ON_ERROR = "on_error"
    ON_LOAD = "on_load"
    ON_UNLOAD = "on_unload"

    def to_string(self) -> str:
        return self.value


@dataclass
class PluginMeta:
    """Metadata about a registered plugin."""

    name: str
    version: str = "0.0.1"
    author: str = ""
    description: str = ""
    hooks: List[str] = field(default_factory=list)
    enabled: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "author": self.author,
            "description": self.description,
            "hooks": list(self.hooks),
            "enabled": self.enabled,
        }


class PluginHook:
    """Descriptor for a plugin hook point.

    Hooks are callable objects registered to specific lifecycle phases.
    They receive context data and can modify or inspect the processing
    pipeline.

    Example::

        hook = PluginHook(
            name="my-validator",
            lifecycle=PluginLifecycle.POST_PARSE,
            callback=my_check_fn,
        )
    """

    def __init__(
        self,
        name: str,
        lifecycle: PluginLifecycle,
        callback: Callable[..., Any],
        priority: int = 0,
        enabled: bool = True,
    ):
        self.name = name
        self.lifecycle = lifecycle
        self.callback = callback
        self.priority = priority
        self.enabled = enabled

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if not self.enabled:
            return None
        return self.callback(*args, **kwargs)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "lifecycle": self.lifecycle.to_string(),
            "priority": self.priority,
            "enabled": self.enabled,
            "callback": (
                f"{self.callback.__module__}.{self.callback.__qualname__}"
                if callable(self.callback)
                else str(self.callback)
            ),
        }


class Plugin:
    """Base class for MAM plugins.

    Plugins extend MAM functionality by registering hooks into the
    processing lifecycle. Subclass this to create custom plugins.

    Example::

        class MyPlugin(Plugin):
            meta = PluginMeta(
                name="my-plugin",
                version="1.0.0",
                description="Does cool things",
            )

            def register_hooks(self) -> List[PluginHook]:
                return [
                    PluginHook(
                        name="validate-custom",
                        lifecycle=PluginLifecycle.POST_VALIDATE,
                        callback=self.on_validate,
                    ),
                ]

            def on_validate(self, ast, issues, **kwargs):
                # Custom validation logic
                return issues
    """

    meta: PluginMeta = PluginMeta(name="base-plugin")

    def register_hooks(self) -> List[PluginHook]:
        return []

    def on_load(self) -> None:
        pass

    def on_unload(self) -> None:
        pass

    def __repr__(self) -> str:
        return f"Plugin({self.meta.name!r}, v{self.meta.version})"


class PluginManager:
    """Manages MAM plugin registration, discovery, and lifecycle.

    Handles plugin registration from classes, instances, and module paths.
    Dispatches hooks to registered plugins by lifecycle phase with priority
    ordering.

    Example::

        pm = PluginManager()
        pm.register(MyPlugin)
        pm.register_instance(another_plugin)

        # Dispatch hooks
        results = pm.dispatch(PluginLifecycle.POST_PARSE, ast=my_ast)
    """

    def __init__(self) -> None:
        self._plugins: Dict[str, Plugin] = {}
        self._instances: Dict[str, Plugin] = {}
        self._hooks: Dict[PluginLifecycle, List[PluginHook]] = {
            phase: [] for phase in PluginLifecycle
        }
        self._load_order: List[str] = []

    def register(
        self, plugin_class: Type[Plugin], enabled: bool = True
    ) -> PluginMeta:
        instance = plugin_class()
        return self.register_instance(instance, enabled=enabled)

    def register_instance(
        self, plugin: Plugin, enabled: bool = True
    ) -> PluginMeta:
        name = plugin.meta.name
        if name in self._plugins:
            raise ValueError(f"Plugin '{name}' is already registered")

        plugin.meta.enabled = enabled
        self._plugins[name] = plugin
        self._instances[name] = plugin
        self._load_order.append(name)

        hooks = plugin.register_hooks()
        for hook in hooks:
            self._register_hook(hook)

        try:
            plugin.on_load()
        except Exception as exc:
            logger.warning("Plugin '%s' on_load failed: %s", name, exc)

        logger.info("Registered plugin: %s v%s", name, plugin.meta.version)
        return plugin.meta

    def register_module(self, module_path: str, enabled: bool = True) -> Optional[PluginMeta]:
        try:
            module = importlib.import_module(module_path)
        except ImportError as exc:
            logger.error("Failed to import plugin module '%s': %s", module_path, exc)
            return None

        plugin_classes: List[Type[Plugin]] = []
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, Plugin)
                and attr is not Plugin
            ):
                plugin_classes.append(attr)

        if not plugin_classes:
            logger.warning("No Plugin subclasses found in '%s'", module_path)
            return None

        last_meta: Optional[PluginMeta] = None
        for cls in plugin_classes:
            last_meta = self.register(cls, enabled=enabled)
        return last_meta

    def unregister(self, name: str) -> bool:
        plugin = self._plugins.get(name)
        if not plugin:
            return False

        try:
            plugin.on_unload()
        except Exception as exc:
            logger.warning("Plugin '%s' on_unload failed: %s", name, exc)

        self._remove_hooks_for_plugin(name)
        del self._plugins[name]
        self._instances.pop(name, None)
        if name in self._load_order:
            self._load_order.remove(name)

        logger.info("Unregistered plugin: %s", name)
        return True

    def get(self, name: str) -> Optional[Plugin]:
        return self._instances.get(name)

    def list_plugins(self) -> List[str]:
        return list(self._load_order)

    def list_meta(self) -> List[PluginMeta]:
        return [self._plugins[n].meta for n in self._load_order if n in self._plugins]

    def enable(self, name: str) -> bool:
        plugin = self._plugins.get(name)
        if plugin:
            plugin.meta.enabled = True
            self._update_hooks_enabled(name, True)
            return True
        return False

    def disable(self, name: str) -> bool:
        plugin = self._plugins.get(name)
        if plugin:
            plugin.meta.enabled = False
            self._update_hooks_enabled(name, False)
            return True
        return False

    def dispatch(
        self,
        lifecycle: PluginLifecycle,
        *args: Any,
        **kwargs: Any,
    ) -> List[Any]:
        hooks = self._hooks.get(lifecycle, [])
        results: List[Any] = []
        for hook in sorted(hooks, key=lambda h: h.priority, reverse=True):
            if not hook.enabled:
                continue
            try:
                result = hook(*args, **kwargs)
                results.append(result)
            except Exception as exc:
                logger.error(
                    "Hook '%s' (%s) failed: %s",
                    hook.name, lifecycle.value, exc,
                )
                results.append(None)
        return results

    def get_hooks(self, lifecycle: Optional[PluginLifecycle] = None) -> List[PluginHook]:
        if lifecycle:
            return list(self._hooks.get(lifecycle, []))
        all_hooks: List[PluginHook] = []
        for hooks in self._hooks.values():
            all_hooks.extend(hooks)
        return all_hooks

    def _register_hook(self, hook: PluginHook) -> None:
        self._hooks[hook.lifecycle].append(hook)

    def _remove_hooks_for_plugin(self, plugin_name: str) -> None:
        for lifecycle in self._hooks:
            self._hooks[lifecycle] = [
                h for h in self._hooks[lifecycle]
                if not h.name.startswith(f"{plugin_name}::")
            ]

    def _update_hooks_enabled(self, plugin_name: str, enabled: bool) -> None:
        for lifecycle in self._hooks:
            for hook in self._hooks[lifecycle]:
                if hook.name.startswith(f"{plugin_name}::"):
                    hook.enabled = enabled

    def __repr__(self) -> str:
        return f"PluginManager(plugins={len(self._plugins)}, hooks={len(self.get_hooks())})"


def enabled_plugin_names(manager: PluginManager) -> List[str]:
    """Return the names of all currently enabled plugins, sorted."""

    return sorted(
        meta.name for meta in manager.list_meta() if meta.enabled
    )


def plugin_has_hook(manager: PluginManager, name: str) -> bool:
    """Return True when at least one registered hook carries the given name."""

    return any(hook.name == name for hook in manager.get_hooks())


def hook_count(manager: PluginManager, lifecycle: Optional[PluginLifecycle] = None) -> int:
    """Return the number of registered hooks, optionally for one lifecycle only."""

    return len(manager.get_hooks(lifecycle))


def plugin_meta_dicts(manager: PluginManager) -> List[Dict[str, Any]]:
    """Return every plugin's metadata as plain dictionaries, sorted by name."""

    return [
        meta.to_dict()
        for meta in sorted(manager.list_meta(), key=lambda m: m.name)
    ]


def sort_plugin_meta(metas: List[PluginMeta], key: str = "name") -> List[PluginMeta]:
    """Return a new list of metadata sorted by the requested attribute.

    Args:
        metas: The metadata objects to sort.
        key: Attribute name to sort on, for example ``name``, ``version``,
            ``author``, or ``enabled``.

    Raises:
        ValueError: When the key is not a metadata attribute.
    """

    if key not in ("name", "version", "author", "description", "enabled"):
        raise ValueError(f"Cannot sort plugins by unknown key: {key}")
    return sorted(metas, key=lambda meta: getattr(meta, key))


def find_plugin(
    manager: PluginManager,
    predicate: Callable[[PluginMeta], bool],
) -> Optional[PluginMeta]:
    """Return the first plugin metadata matching the predicate, or None.

    Plugins are inspected in sorted name order so results are deterministic.
    """

    for meta in sorted(manager.list_meta(), key=lambda m: m.name):
        if predicate(meta):
            return meta
    return None


def require_plugin(manager: PluginManager, name: str) -> PluginMeta:
    """Return the metadata for a plugin, raising ``KeyError`` when absent.

    Raises:
        KeyError: When no plugin is registered under the given name.
    """

    meta = manager.get(name)
    if meta is None:
        available = ", ".join(manager.list_plugins()) or "none"
        raise KeyError(f"Plugin '{name}' is not registered. Registered: {available}")
    return meta.meta


__all__ = [
    "Plugin",
    "PluginManager",
    "PluginHook",
    "PluginLifecycle",
    "PluginMeta",
    "enabled_plugin_names",
    "find_plugin",
    "hook_count",
    "plugin_has_hook",
    "plugin_meta_dicts",
    "require_plugin",
    "sort_plugin_meta",
]
