# -*- coding: utf-8 -*-
# ============================================================================
# MAM Auto-Generated Module
# ============================================================================
# Module Id:      data-pipeline-20260917-002
# Module Name:    data-pipeline
# Version:        1.0.0
# Author:         MAM Generator
# Created:        2026-09-17
# Description:    Data processing pipeline with ETL, validation, transforms,
#                 parallel execution, error handling, and monitoring.
# Python:         >=3.10
# Dependencies:   None (stdlib only)
# License:        MIT
# ============================================================================
"""
data-pipeline.mam.py - Data Processing Pipeline

A production-grade ETL pipeline framework with pluggable validators,
transform functions, parallel execution, structured error handling,
monitoring decorators, logging, and a YAML-free configuration manager.

Usage:
    python data-pipeline.mam.py
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
import sys
import time
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed, Future
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum, auto
from functools import wraps
from typing import (
    Any,
    Callable,
    Dict,
    Generic,
    Iterable,
    Iterator,
    List,
    Optional,
    Sequence,
    TypeVar,
    Union,
)

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logger = logging.getLogger("data_pipeline")
logger.setLevel(logging.DEBUG)

_handler = logging.StreamHandler()
_handler.setFormatter(
    logging.Formatter("[%(asctime)s] %(levelname)s %(name)s - %(message)s")
)
logger.addHandler(_handler)


# ---------------------------------------------------------------------------
# Type variables
# ---------------------------------------------------------------------------
T = TypeVar("T")
R = TypeVar("R")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class PipelineStatus(Enum):
    IDLE = auto()
    RUNNING = auto()
    COMPLETED = auto()
    FAILED = auto()
    PARTIAL = auto()


class Severity(Enum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class ValidationError:
    """A single validation failure."""

    field: str
    message: str
    value: Any = None
    severity: Severity = Severity.ERROR

    def to_dict(self) -> dict[str, Any]:
        return {
            "field": self.field,
            "message": self.message,
            "value": str(self.value) if self.value is not None else None,
            "severity": self.severity.value,
        }


@dataclass
class ValidationResult:
    """Aggregated result of running validators against a record."""

    is_valid: bool
    errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationError] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [e.to_dict() for e in self.warnings],
        }


@dataclass
class PipelineMetrics:
    """Collects runtime statistics for a pipeline run."""

    total_records: int = 0
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    start_time: Optional[float] = None
    end_time: Optional[float] = None

    @property
    def duration_ms(self) -> float:
        if self.start_time and self.end_time:
            return round((self.end_time - self.start_time) * 1000, 2)
        return 0.0

    @property
    def records_per_second(self) -> float:
        dur = self.duration_ms / 1000 if self.duration_ms else 0
        return round(self.processed / dur, 2) if dur > 0 else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_records": self.total_records,
            "processed": self.processed,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "skipped": self.skipped,
            "duration_ms": self.duration_ms,
            "records_per_second": self.records_per_second,
        }


@dataclass
class PipelineStep:
    """Metadata about a single execution step."""

    name: str
    step_type: str  # "extract", "validate", "transform", "load"
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    records_in: int = 0
    records_out: int = 0
    errors: int = 0

    @property
    def duration_ms(self) -> float:
        if self.started_at and self.finished_at:
            return round((self.finished_at - self.started_at) * 1000, 2)
        return 0.0


# ---------------------------------------------------------------------------
# Configuration Manager
# ---------------------------------------------------------------------------
class ConfigurationManager:
    """
    Hierarchical configuration manager.

    Configuration is loaded from (lowest to highest priority):
    1. Defaults passed at construction time
    2. Environment variables prefixed with ``PIPELINE_``
    3. Explicit overrides via :meth:`set`
    """

    def __init__(self, defaults: Optional[dict[str, Any]] = None) -> None:
        self._config: dict[str, Any] = copy.deepcopy(defaults or {})
        self._overrides: dict[str, Any] = {}
        self._load_env_vars()

    def _load_env_vars(self) -> None:
        prefix = "PIPELINE_"
        for key, value in os.environ.items():
            if key.startswith(prefix):
                config_key = key[len(prefix) :].lower()
                self._config[config_key] = self._coerce(value)

    @staticmethod
    def _coerce(value: str) -> Any:
        if value.lower() in ("true", "yes", "1"):
            return True
        if value.lower() in ("false", "no", "0"):
            return False
        try:
            return int(value)
        except ValueError:
            pass
        try:
            return float(value)
        except ValueError:
            pass
        return value

    def get(self, key: str, default: Any = None) -> Any:
        if key in self._overrides:
            return self._overrides[key]
        return self._config.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._overrides[key] = value

    def as_dict(self) -> dict[str, Any]:
        merged = copy.deepcopy(self._config)
        merged.update(self._overrides)
        return merged

    def __repr__(self) -> str:
        return f"ConfigurationManager({self.as_dict()})"


# ---------------------------------------------------------------------------
# Data Validators
# ---------------------------------------------------------------------------
class DataValidator:
    """
    Composite validator that chains multiple validation rules.

    Each rule is a ``(field_name, predicate_fn, message)`` triple.
    """

    def __init__(self) -> None:
        self._rules: list[tuple[str, Callable[[Any], bool], str, Severity]] = []

    def add_rule(
        self,
        field: str,
        predicate: Callable[[Any], bool],
        message: str,
        severity: Severity = Severity.ERROR,
    ) -> "DataValidator":
        self._rules.append((field, predicate, message, severity))
        return self

    def required(self, field: str) -> "DataValidator":
        return self.add_rule(
            field,
            lambda v: v is not None and v != "",
            f"'{field}' is required",
        )

    def min_length(self, field: str, length: int) -> "DataValidator":
        return self.add_rule(
            field,
            lambda v, l=length: v is None or len(str(v)) >= l,
            f"'{field}' must be at least {length} characters",
        )

    def max_length(self, field: str, length: int) -> "DataValidator":
        return self.add_rule(
            field,
            lambda v, l=length: v is None or len(str(v)) <= l,
            f"'{field}' must be at most {length} characters",
        )

    def in_set(self, field: str, allowed: set[Any]) -> "DataValidator":
        return self.add_rule(
            field,
            lambda v, a=allowed: v in a,
            f"'{field}' must be one of {allowed}",
        )

    def numeric(self, field: str) -> "DataValidator":
        return self.add_rule(
            field,
            lambda v: v is None or (isinstance(v, (int, float))),
            f"'{field}' must be numeric",
        )

    def positive(self, field: str) -> "DataValidator":
        return self.add_rule(
            field,
            lambda v: v is None or (isinstance(v, (int, float)) and v > 0),
            f"'{field}' must be positive",
        )

    def regex(self, field: str, pattern: str) -> "DataValidator":
        import re

        compiled = re.compile(pattern)
        return self.add_rule(
            field,
            lambda v, p=compiled: v is None or bool(p.match(str(v))),
            f"'{field}' does not match pattern {pattern}",
        )

    def validate(self, record: dict[str, Any]) -> ValidationResult:
        errors: list[ValidationError] = []
        warnings: list[ValidationError] = []
        for field_name, predicate, message, severity in self._rules:
            value = record.get(field_name)
            if not predicate(value):
                err = ValidationError(field=field_name, message=message, value=value, severity=severity)
                if severity == Severity.WARNING:
                    warnings.append(err)
                else:
                    errors.append(err)
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )


# ---------------------------------------------------------------------------
# Transform Functions
# ---------------------------------------------------------------------------
class TransformRegistry:
    """Registry of named transform functions."""

    _instance: Optional["TransformRegistry"] = None

    def __init__(self) -> None:
        self._transforms: dict[str, Callable[[Any], Any]] = {}

    @classmethod
    def get_instance(cls) -> "TransformRegistry":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(self, name: str, func: Callable[[Any], Any]) -> None:
        self._transforms[name] = func

    def get(self, name: str) -> Optional[Callable[[Any], Any]]:
        return self._transforms.get(name)

    def list_transforms(self) -> list[str]:
        return list(self._transforms.keys())


def transform_upper(value: Any) -> str:
    """Uppercase a string value."""
    return str(value).upper() if value is not None else ""


def transform_lower(value: Any) -> str:
    """Lowercase a string value."""
    return str(value).lower() if value is not None else ""


def transform_strip(value: Any) -> str:
    """Strip whitespace from a string value."""
    return str(value).strip() if value is not None else ""


def transform_to_int(value: Any) -> Optional[int]:
    """Attempt to cast a value to ``int``."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def transform_to_float(value: Any) -> Optional[float]:
    """Attempt to cast a value to ``float``."""
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def transform_hash(value: Any) -> str:
    """SHA-256 hash of the string representation."""
    return hashlib.sha256(str(value).encode()).hexdigest()


def transform_default(default: Any) -> Callable[[Any], Any]:
    """Return a transform that replaces ``None`` with *default*."""

    def _apply(value: Any) -> Any:
        return default if value is None else value

    return _apply


def transform_map(mapping: dict[str, str]) -> Callable[[Any], Any]:
    """Return a transform that maps values via *mapping* dict."""

    def _apply(value: Any) -> str:
        return mapping.get(str(value), str(value))

    return _apply


# Register built-in transforms
_registry = TransformRegistry.get_instance()
_registry.register("upper", transform_upper)
_registry.register("lower", transform_lower)
_registry.register("strip", transform_strip)
_registry.register("to_int", transform_to_int)
_registry.register("to_float", transform_to_float)
_registry.register("hash", transform_hash)


# ---------------------------------------------------------------------------
# ETL Pipeline
# ---------------------------------------------------------------------------
class ETLPipeline:
    """
    Extract–Transform–Load pipeline.

    Stages:
        1. **Extract** – pull records from a source (list, callable, or iterable)
        2. **Validate** – apply :class:`DataValidator` rules
        3. **Transform** – apply a chain of transform functions per field
        4. **Load** – push clean records to a sink (callable)
    """

    def __init__(
        self,
        name: str = "default",
        config: Optional[ConfigurationManager] = None,
        max_workers: int = 4,
    ) -> None:
        self.name = name
        self.config = config or ConfigurationManager()
        self.max_workers = max_workers
        self.status = PipelineStatus.IDLE
        self.metrics = PipelineMetrics()
        self._steps: list[PipelineStep] = []
        self._validators: list[DataValidator] = []
        self._transforms: dict[str, list[str]] = {}
        self._error_handlers: list[Callable[[Exception, Any], Optional[Any]]] = []
        self._pre_hooks: list[Callable[[dict[str, Any]], dict[str, Any]]] = []
        self._post_hooks: list[Callable[[dict[str, Any]], dict[str, Any]]] = []
        self._lock = threading.Lock()

    # ---- chainable builder methods ----

    def add_validator(self, validator: DataValidator) -> "ETLPipeline":
        self._validators.append(validator)
        return self

    def add_transform(self, field: str, transform_name: str) -> "ETLPipeline":
        self._transforms.setdefault(field, []).append(transform_name)
        return self

    def add_error_handler(self, handler: Callable[[Exception, Any], Optional[Any]]) -> "ETLPipeline":
        self._error_handlers.append(handler)
        return self

    def add_pre_hook(self, hook: Callable[[dict[str, Any]], dict[str, Any]]) -> "ETLPipeline":
        self._pre_hooks.append(hook)
        return self

    def add_post_hook(self, hook: Callable[[dict[str, Any]], dict[str, Any]]) -> "ETLPipeline":
        self._post_hooks.append(hook)
        return self

    # ---- internal processing ----

    def _apply_transforms(self, record: dict[str, Any]) -> dict[str, Any]:
        registry = TransformRegistry.get_instance()
        result = dict(record)
        for field_name, transform_names in self._transforms.items():
            value = result.get(field_name)
            for tname in transform_names:
                func = registry.get(tname)
                if func is not None:
                    value = func(value)
                else:
                    logger.warning("Unknown transform '%s' for field '%s'", tname, field_name)
            result[field_name] = value
        return result

    def _validate_record(self, record: dict[str, Any]) -> ValidationResult:
        combined = ValidationResult(is_valid=True)
        for validator in self._validators:
            result = validator.validate(record)
            combined.errors.extend(result.errors)
            combined.warnings.extend(result.warnings)
            if not result.is_valid:
                combined.is_valid = False
        return combined

    def _handle_error(self, error: Exception, record: Any) -> Optional[Any]:
        for handler in self._error_handlers:
            try:
                result = handler(error, record)
                if result is not None:
                    return result
            except Exception as handler_error:
                logger.error("Error handler failed: %s", handler_error)
        return None

    def _run_hooks(self, record: dict[str, Any], hooks: list[Callable]) -> dict[str, Any]:
        result = record
        for hook in hooks:
            try:
                result = hook(result)
            except Exception as exc:
                logger.warning("Hook %s failed: %s", hook.__name__, exc)
        return result

    def _process_single(self, record: dict[str, Any]) -> tuple[bool, Optional[dict[str, Any]]]:
        """Process one record through validate → transform → post-hooks."""
        try:
            # Pre-hooks
            record = self._run_hooks(record, self._pre_hooks)

            # Validate
            vr = self._validate_record(record)
            if not vr.is_valid:
                for err in vr.errors:
                    logger.warning("Validation failed: %s", err.message)
                return False, None

            # Transform
            record = self._apply_transforms(record)

            # Post-hooks
            record = self._run_hooks(record, self._post_hooks)

            return True, record
        except Exception as exc:
            logger.error("Processing error: %s", exc)
            fallback = self._handle_error(exc, record)
            return False, fallback

    # ---- public run API ----

    def run(
        self,
        source: Union[list[dict[str, Any]], Callable[[], Iterable[dict[str, Any]]], Iterable[dict[str, Any]]],
        sink: Optional[Callable[[list[dict[str, Any]]], Any]] = None,
    ) -> PipelineMetrics:
        """
        Execute the full ETL pipeline.

        Args:
            source: Records to process (list, callable returning iterable, or any iterable).
            sink: Optional callable receiving the list of successfully processed records.

        Returns:
            :class:`PipelineMetrics` with run statistics.
        """
        self.status = PipelineStatus.RUNNING
        self.metrics = PipelineMetrics()
        self.metrics.start_time = time.time()
        self._steps.clear()

        # Extract step
        step_extract = PipelineStep(name="extract", step_type="extract", started_at=time.time())
        try:
            if callable(source) and not isinstance(source, list):
                records = list(source())
            elif isinstance(source, Iterable):
                records = list(source)
            else:
                raise TypeError(f"Unsupported source type: {type(source)}")
        except Exception as exc:
            step_extract.finished_at = time.time()
            self._steps.append(step_extract)
            self.status = PipelineStatus.FAILED
            logger.error("Extract failed: %s", exc)
            return self.metrics

        step_extract.records_in = len(records)
        step_extract.records_out = len(records)
        step_extract.finished_at = time.time()
        self._steps.append(step_extract)
        self.metrics.total_records = len(records)

        # Process (validate + transform) in parallel
        step_process = PipelineStep(name="process", step_type="transform", started_at=time.time())
        processed: list[dict[str, Any]] = []
        failed_count = 0

        if self.max_workers > 1 and len(records) > 100:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                future_map: dict[Future, int] = {
                    executor.submit(self._process_single, rec): i
                    for i, rec in enumerate(records)
                }
                for future in as_completed(future_map):
                    idx = future_map[future]
                    try:
                        success, result = future.result()
                        if success and result is not None:
                            processed.append(result)
                        else:
                            failed_count += 1
                    except Exception as exc:
                        logger.error("Worker exception for record %d: %s", idx, exc)
                        failed_count += 1
        else:
            for rec in records:
                success, result = self._process_single(rec)
                if success and result is not None:
                    processed.append(result)
                else:
                    failed_count += 1

        step_process.records_in = len(records)
        step_process.records_out = len(processed)
        step_process.errors = failed_count
        step_process.finished_at = time.time()
        self._steps.append(step_process)

        # Load step
        step_load = PipelineStep(name="load", step_type="load", started_at=time.time())
        if sink is not None:
            try:
                sink(processed)
            except Exception as exc:
                logger.error("Sink failed: %s", exc)
                failed_count += len(processed)
        step_load.records_in = len(processed)
        step_load.records_out = len(processed)
        step_load.finished_at = time.time()
        self._steps.append(step_load)

        # Finalize metrics
        self.metrics.processed = len(records)
        self.metrics.succeeded = len(processed)
        self.metrics.failed = failed_count
        self.metrics.end_time = time.time()

        self.status = (
            PipelineStatus.COMPLETED
            if failed_count == 0
            else PipelineStatus.PARTIAL if len(processed) > 0 else PipelineStatus.FAILED
        )

        logger.info(
            "Pipeline '%s' finished: %d succeeded, %d failed (%.1f ms)",
            self.name,
            self.metrics.succeeded,
            self.metrics.failed,
            self.metrics.duration_ms,
        )
        return self.metrics

    def get_step_details(self) -> list[dict[str, Any]]:
        return [
            {
                "name": s.name,
                "type": s.step_type,
                "duration_ms": s.duration_ms,
                "records_in": s.records_in,
                "records_out": s.records_out,
                "errors": s.errors,
            }
            for s in self._steps
        ]


# ---------------------------------------------------------------------------
# Parallel Executor
# ---------------------------------------------------------------------------
class ParallelExecutor:
    """
    Utility for running independent tasks concurrently.

    Wraps :class:`concurrent.futures.ThreadPoolExecutor` with error
    aggregation and optional chunk-based processing.
    """

    def __init__(self, max_workers: int = 4) -> None:
        self.max_workers = max_workers
        self._results: list[tuple[int, Any]] = []
        self._errors: list[tuple[int, Exception]] = []

    def execute(
        self,
        tasks: list[Callable[..., Any]],
        args_list: Optional[list[tuple]] = None,
        kwargs_list: Optional[list[dict]] = None,
    ) -> tuple[list[Any], list[Exception]]:
        """
        Run *tasks* in parallel and return ``(results, errors)``.

        ``args_list[i]`` and ``kwargs_list[i]`` are passed to ``tasks[i]``.
        """
        self._results.clear()
        self._errors.clear()
        args_list = args_list or [() for _ in tasks]
        kwargs_list = kwargs_list or [{} for _ in tasks]

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_map: dict[Future, int] = {}
            for i, task in enumerate(tasks):
                future = executor.submit(task, *args_list[i], **kwargs_list[i])
                future_map[future] = i

            for future in as_completed(future_map):
                idx = future_map[future]
                try:
                    result = future.result()
                    self._results.append((idx, result))
                except Exception as exc:
                    self._errors.append((idx, exc))

        self._results.sort(key=lambda x: x[0])
        self._errors.sort(key=lambda x: x[0])
        return [r for _, r in self._results], [e for _, e in self._errors]

    def execute_chunks(
        self,
        items: list[Any],
        chunk_size: int,
        func: Callable[[list[Any]], Any],
    ) -> tuple[list[Any], list[Exception]]:
        """Split *items* into chunks and process each chunk in parallel."""
        chunks: list[list[Any]] = [
            items[i : i + chunk_size] for i in range(0, len(items), chunk_size)
        ]
        return self.execute([func for _ in chunks], args_list=[(c,) for c in chunks])


# ---------------------------------------------------------------------------
# Monitoring Decorators
# ---------------------------------------------------------------------------
def monitor_pipeline(pipeline: ETLPipeline) -> Callable:
    """Decorator that logs pipeline lifecycle events."""

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            logger.info("Pipeline '%s': starting %s", pipeline.name, func.__name__)
            start = time.perf_counter()
            try:
                result = func(*args, **kwargs)
                elapsed = (time.perf_counter() - start) * 1000
                logger.info(
                    "Pipeline '%s': %s completed in %.1f ms",
                    pipeline.name,
                    func.__name__,
                    elapsed,
                )
                return result
            except Exception as exc:
                elapsed = (time.perf_counter() - start) * 1000
                logger.error(
                    "Pipeline '%s': %s failed after %.1f ms - %s",
                    pipeline.name,
                    func.__name__,
                    elapsed,
                    exc,
                )
                raise

        return wrapper

    return decorator


def retry(max_retries: int = 3, delay_ms: float = 100) -> Callable:
    """Decorator that retries a function up to *max_retries* times."""

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exc: Optional[Exception] = None
            for attempt in range(1, max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_exc = exc
                    logger.warning(
                        "Attempt %d/%d for %s failed: %s",
                        attempt,
                        max_retries,
                        func.__name__,
                        exc,
                    )
                    if attempt < max_retries:
                        time.sleep(delay_ms / 1000)
            raise last_exc  # type: ignore[misc]

        return wrapper

    return decorator


def benchmark(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator that logs execution time."""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        try:
            return func(*args, **kwargs)
        finally:
            elapsed = (time.perf_counter() - start) * 1000
            logger.debug("%s executed in %.2f ms", func.__name__, elapsed)

    return wrapper


# ---------------------------------------------------------------------------
# Sample data & helpers (for demo)
# ---------------------------------------------------------------------------
_SAMPLE_DATA: list[dict[str, Any]] = [
    {"id": 1, "name": "  Alice  ", "email": "ALICE@Example.com", "age": 30, "status": "active"},
    {"id": 2, "name": "Bob", "email": "bob@example.com", "age": 25, "status": "active"},
    {"id": 3, "name": "Charlie", "email": "charlie@example.com", "age": -5, "status": "inactive"},
    {"id": 4, "name": "", "email": "invalid-email", "age": "abc", "status": "active"},
    {"id": 5, "name": "Diana", "email": "diana@example.com", "age": 45, "status": "active"},
    {"id": 6, "name": "Eve", "email": "eve@example.com", "age": 0, "status": "pending"},
    {"id": 7, "name": "  Frank  ", "email": "frank@example.com", "age": 33, "status": "active"},
    {"id": 8, "name": "Grace", "email": "grace@example.com", "age": 28, "status": "active"},
    {"id": 9, "name": "Hank", "email": None, "age": 52, "status": "active"},
    {"id": 10, "name": "Ivy", "email": "ivy@example.com", "age": 19, "status": "inactive"},
]


def _build_pipeline() -> ETLPipeline:
    """Construct a fully-configured sample pipeline."""
    config = ConfigurationManager(
        {
            "batch_size": 100,
            "max_workers": 4,
            "log_level": "INFO",
        }
    )

    pipeline = ETLPipeline(name="user-etl", config=config, max_workers=4)

    # Validator: name required, age numeric & positive, status in set
    validator = (
        DataValidator()
        .required("name")
        .required("email")
        .min_length("name", 1)
        .numeric("age")
        .positive("age")
        .in_set("status", {"active", "inactive", "pending"})
    )
    pipeline.add_validator(validator)

    # Transforms: strip + uppercase name, lowercase email
    pipeline.add_transform("name", "strip")
    pipeline.add_transform("name", "upper")
    pipeline.add_transform("email", "lower")

    # Pre-hook: remove leading/trailing whitespace on all string fields
    def normalize_whitespace(record: dict[str, Any]) -> dict[str, Any]:
        return {k: v.strip() if isinstance(v, str) else v for k, v in record.items()}

    pipeline.add_pre_hook(normalize_whitespace)

    # Post-hook: add computed field
    def enrich(record: dict[str, Any]) -> dict[str, Any]:
        record["full_label"] = f"{record.get('name', '?')} ({record.get('status', '?')})"
        return record

    pipeline.add_post_hook(enrich)

    # Error handler
    def log_and_skip(error: Exception, record: Any) -> None:
        logger.error("Skipping record due to: %s", error)
        return None

    pipeline.add_error_handler(log_and_skip)

    return pipeline


# ---------------------------------------------------------------------------
# CLI demo
# ---------------------------------------------------------------------------
def _cli_demo() -> None:
    print("=" * 72)
    print(" Data Pipeline - Component Demo")
    print("=" * 72)

    # --- Configuration Manager ---
    config = ConfigurationManager({"default_batch_size": 50, "verbose": False})
    config.set("output_path", "/data/output")
    print(f"\n[config] {config}")

    # --- Validator ---
    print("\n[validator] Running validation on sample records...")
    validator = (
        DataValidator()
        .required("name")
        .required("email")
        .min_length("name", 2)
        .numeric("age")
        .positive("age")
        .in_set("status", {"active", "inactive", "pending"})
    )
    for i, rec in enumerate(_SAMPLE_DATA[:5], 1):
        result = validator.validate(rec)
        status = "PASS" if result.is_valid else "FAIL"
        print(f"   Record {i}: {status}  ({len(result.errors)} errors)")

    # --- ETL Pipeline ---
    print("\n[etl] Building pipeline...")
    pipeline = _build_pipeline()

    collected: list[dict[str, Any]] = []

    @monitor_pipeline(pipeline)
    def run_pipeline() -> PipelineMetrics:
        return pipeline.run(source=_SAMPLE_DATA, sink=lambda records: collected.extend(records))

    metrics = run_pipeline()

    print(f"\n[etl] Status      : {pipeline.status.name}")
    print(f"[etl] Total       : {metrics.total_records}")
    print(f"[etl] Succeeded   : {metrics.succeeded}")
    print(f"[etl] Failed      : {metrics.failed}")
    print(f"[etl] Duration    : {metrics.duration_ms} ms")
    print(f"[etl] Records/sec : {metrics.records_per_second}")

    print(f"\n[etl] Output records ({len(collected)}):")
    for rec in collected:
        print(f"   {rec}")

    print("\n[etl] Step details:")
    for step in pipeline.get_step_details():
        print(f"   {step['name']:12s} | in={step['records_in']} out={step['records_out']} err={step['errors']} | {step['duration_ms']:.1f} ms")

    # --- Parallel Executor ---
    print("\n[parallel] Running parallel tasks...")
    executor = ParallelExecutor(max_workers=3)
    import math

    tasks = [lambda x=n: math.factorial(x) for n in range(1, 8)]
    results, errors = executor.execute(tasks)
    print(f"   Results: {results}")
    print(f"   Errors : {errors}")

    # --- Retry decorator ---
    print("\n[retry] Demonstrating retry decorator...")
    attempt_counter = {"n": 0}

    @retry(max_retries=3, delay_ms=50)
    def flaky_function() -> str:
        attempt_counter["n"] += 1
        if attempt_counter["n"] < 3:
            raise RuntimeError(f"Attempt {attempt_counter['n']} failed")
        return "Success on attempt 3"

    try:
        print(f"   Result: {flaky_function()}")
    except Exception as exc:
        print(f"   Failed after retries: {exc}")

    print("\n" + "=" * 72)
    print(" Demo complete.")
    print("=" * 72)


if __name__ == "__main__":
    _cli_demo()
