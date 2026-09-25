"""
SDK Configuration for Python.

Provides loading, validation, merging, and persistence of the MAM SDK
configuration file (``mam.sdk.json``). The configuration controls the default
execution target, working directory, verbosity, and arbitrary extra settings.

Example::

    from mam.config import DEFAULT_SDK_CONFIG, load_sdk_config, save_sdk_config

    config = load_sdk_config()
    config.target = "go"
    save_sdk_config(config)
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Dict, List, Optional

__all__ = [
    "SDKConfig",
    "DEFAULT_SDK_CONFIG",
    "CONFIG_FILENAME",
    "SUPPORTED_TARGETS",
    "load_sdk_config",
    "save_sdk_config",
    "validate_sdk_config",
    "merge_sdk_configs",
    "resolve_sdk_config_path",
    "is_supported_target",
    "list_sdk_targets",
    "find_sdk_config",
]

CONFIG_FILENAME = "mam.sdk.json"

SUPPORTED_TARGETS: List[str] = [
    "python",
    "javascript",
    "typescript",
    "rust",
    "go",
    "shell",
    "markdown",
]

SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)

TARGET_ALIASES: Dict[str, str] = {
    "py": "python",
    "python3": "python",
    "js": "javascript",
    "node": "javascript",
    "ts": "typescript",
    "golang": "go",
    "sh": "shell",
    "bash": "shell",
    "md": "markdown",
}


@dataclass
class SDKConfig:
    """Configuration for the MAM SDK.

    Attributes:
        version: Config schema version, in semantic version form.
        work_dir: Default working directory for module operations.
        target: Default execution target language.
        verbose: Whether commands should emit verbose output.
        extra: Arbitrary additional settings preserved across load and save.
    """

    version: str = "1.0.0"
    work_dir: str = "."
    target: str = "python"
    verbose: bool = False
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Return the config as a plain dictionary."""

        return {
            "version": self.version,
            "work_dir": self.work_dir,
            "target": self.target,
            "verbose": self.verbose,
            "extra": dict(self.extra),
        }

    def to_json(self, indent: int = 2) -> str:
        """Return the config serialized as JSON."""

        return json.dumps(self.to_dict(), indent=indent, sort_keys=True)

    def copy(self) -> SDKConfig:
        """Return an independent copy of the config."""

        return replace(self, extra=dict(self.extra))

    def get(self, key: str, default: Any = None) -> Any:
        """Return a config value, falling back to ``extra`` for unknown keys."""

        if key in ("version", "work_dir", "target", "verbose"):
            return getattr(self, key)
        return self.extra.get(key, default)


DEFAULT_SDK_CONFIG = SDKConfig()


def is_supported_target(target: str) -> bool:
    """Return True when the target is a supported execution target.

    Common aliases such as ``py``, ``js``, and ``golang`` are accepted.
    """

    if not target or not isinstance(target, str):
        return False
    candidate = target.strip().lower()
    if candidate in SUPPORTED_TARGETS:
        return True
    return TARGET_ALIASES.get(candidate, "") in SUPPORTED_TARGETS


def list_sdk_targets() -> List[str]:
    """Return the supported execution targets, sorted."""

    return sorted(SUPPORTED_TARGETS)


def normalize_target(target: str) -> str:
    """Return the canonical name for a target, or the input when unknown."""

    if not target or not isinstance(target, str):
        return ""
    candidate = target.strip().lower()
    if candidate in SUPPORTED_TARGETS:
        return candidate
    return TARGET_ALIASES.get(candidate, candidate)


def validate_sdk_config(config: Any) -> List[str]:
    """Validate a config and return a list of human-readable problems.

    An empty list means the config is valid.
    """

    problems: List[str] = []

    if not isinstance(config, SDKConfig):
        return [f"Config must be an SDKConfig, got {type(config).__name__}"]

    if not config.version or not isinstance(config.version, str):
        problems.append("Field 'version' must be a non-empty string")
    elif not SEMVER_PATTERN.match(config.version):
        problems.append(
            f"Field 'version' must be a semantic version, got '{config.version}'"
        )

    if not config.work_dir or not isinstance(config.work_dir, str):
        problems.append("Field 'work_dir' must be a non-empty string")

    if not config.target or not isinstance(config.target, str):
        problems.append("Field 'target' must be a non-empty string")
    elif not is_supported_target(config.target):
        problems.append(
            f"Field 'target' must be one of {', '.join(list_sdk_targets())}, "
            f"got '{config.target}'"
        )

    if not isinstance(config.verbose, bool):
        problems.append("Field 'verbose' must be a boolean")

    if not isinstance(config.extra, dict):
        problems.append("Field 'extra' must be a mapping")

    return problems


def merge_sdk_configs(base: Any, override: Any) -> SDKConfig:
    """Merge two configs, with ``override`` winning for populated fields.

    ``None`` and empty-string values in ``override`` are treated as unset and
    inherit from ``base``. Nested ``extra`` mappings are merged rather than
    replaced. Neither input is modified.
    """

    base_config = base if isinstance(base, SDKConfig) else DEFAULT_SDK_CONFIG
    if not isinstance(override, SDKConfig):
        return base_config.copy()

    merged_extra = dict(base_config.extra)
    merged_extra.update(override.extra)

    return SDKConfig(
        version=override.version or base_config.version,
        work_dir=override.work_dir or base_config.work_dir,
        target=normalize_target(override.target) or base_config.target,
        verbose=override.verbose or base_config.verbose,
        extra=merged_extra,
    )


def config_from_dict(data: Dict[str, Any]) -> SDKConfig:
    """Build a config from a raw dictionary, ignoring unknown top-level keys.

    The ``extra`` field is read as the nested settings mapping. Any other
    unrecognized top-level key is folded into ``extra`` so that data is never
    silently dropped on a load and save cycle.
    """

    if not isinstance(data, dict):
        return DEFAULT_SDK_CONFIG.copy()

    known = ("version", "work_dir", "target", "verbose", "extra")
    extra = {key: value for key, value in data.items() if key not in known}

    nested = data.get("extra")
    if isinstance(nested, dict):
        extra = {**nested, **extra}

    return SDKConfig(
        version=str(data.get("version") or DEFAULT_SDK_CONFIG.version),
        work_dir=str(data.get("work_dir") or DEFAULT_SDK_CONFIG.work_dir),
        target=str(data.get("target") or DEFAULT_SDK_CONFIG.target),
        verbose=bool(data.get("verbose", DEFAULT_SDK_CONFIG.verbose)),
        extra=extra,
    )


def find_sdk_config(start: Optional[str] = None) -> Optional[Path]:
    """Search for a config file by walking up from ``start``.

    Returns the first config file found, or None when no config exists in any
    parent directory.
    """

    if start is None:
        current = Path.cwd()
    else:
        candidate = Path(start)
        current = candidate if candidate.is_dir() else candidate.parent

    for directory in [current, *current.parents]:
        config_path = directory / CONFIG_FILENAME
        if config_path.is_file():
            return config_path
    return None


def resolve_sdk_config_path(work_dir: Optional[str] = None) -> Path:
    """Return the path a config would be read from or written to.

    When ``work_dir`` is empty or None, the environment variable
    ``MAM_SDK_CONFIG`` is honored, then the nearest config found by walking up
    from the current directory, and finally the current directory itself.
    """

    if work_dir:
        return Path(work_dir) / CONFIG_FILENAME

    env_path = os.environ.get("MAM_SDK_CONFIG")
    if env_path:
        return Path(env_path)

    found = find_sdk_config()
    if found is not None:
        return found

    return Path.cwd() / CONFIG_FILENAME


def load_sdk_config(path: Optional[str] = None) -> SDKConfig:
    """Load a config from disk.

    When ``path`` is omitted the config is discovered as described in
    :func:`resolve_sdk_config_path`; if no file is found, the defaults are
    returned. When ``path`` is given explicitly and missing, ``FileNotFoundError``
    propagates.

    Raises:
        FileNotFoundError: When an explicit path does not exist.
        ValueError: When the file is not valid JSON, not a mapping, or fails
            validation.
    """

    explicit = path is not None
    if path is None:
        found = find_sdk_config()
        if found is None:
            env_path = os.environ.get("MAM_SDK_CONFIG")
            if env_path and Path(env_path).is_file():
                found = Path(env_path)
            else:
                return DEFAULT_SDK_CONFIG.copy()
        config_path = found
    else:
        config_path = Path(path)

    if not config_path.is_file():
        if explicit:
            raise FileNotFoundError(f"Config file not found: {config_path}")
        return DEFAULT_SDK_CONFIG.copy()

    try:
        raw = config_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValueError(f"Could not read config file {config_path}: {exc}") from exc

    try:
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        raise ValueError(f"Config file {config_path} is not valid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError(f"Config file {config_path} must contain a JSON object")

    config = config_from_dict(data)

    problems = validate_sdk_config(config)
    if problems:
        joined = "; ".join(problems)
        raise ValueError(f"Invalid config in {config_path}: {joined}")

    return config


def save_sdk_config(config: Any, path: Optional[str] = None) -> str:
    """Validate and atomically write a config to disk.

    The file is written to a temporary file in the destination directory and
    then moved into place, so readers never observe a partially written config.

    Args:
        config: The config to validate and write.
        path: Destination file path. When omitted, the destination is resolved
            with :func:`resolve_sdk_config_path`.

    Returns:
        The path the config was written to, as a string.

    Raises:
        ValueError: When the config fails validation or is not an SDKConfig.
    """

    problems = validate_sdk_config(config)
    if problems:
        joined = "; ".join(problems)
        raise ValueError(f"Refusing to save invalid config: {joined}")

    destination = Path(path) if path else resolve_sdk_config_path()
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)

    handle = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(parent),
        prefix=f".{CONFIG_FILENAME}.",
        suffix=".tmp",
        delete=False,
    )
    temp_path = Path(handle.name)
    try:
        with handle:
            handle.write(config.to_json())
            handle.write("\n")
        temp_path.replace(destination)
    except OSError:
        if temp_path.exists():
            temp_path.unlink()
        raise

    return str(destination)
