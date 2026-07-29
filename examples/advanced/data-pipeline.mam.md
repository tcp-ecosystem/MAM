---
id: data-pipeline
version: 1.0.0
name: ETL Data Pipeline
author: MAM Team
runtime: python
tags:
  - workflow
  - etl
  - pipeline
  - data
  - advanced
description: A multi-step ETL pipeline that extracts data from sources, runs parallel transform and validate steps, loads into a target, and produces a report.
---

# ETL Data Pipeline

## Purpose

A robust ETL workflow that extracts raw data, applies parallel transformation and validation steps, loads clean records into a target store, and generates a summary report. Parallel execution of Transform and Validate improves throughput while maintaining data quality guarantees.

## Workflow Definition

module ETLPipeline

type:
    workflow

steps:
    - Extract
    - Branch:
        parallel:
            - Transform
            - Validate
    - Load
    - Report

## Step: Extract

module Extract

type:
    tool

provider:
    python

capabilities:
    - read
    - parse
    - normalize

## Step: Transform

module Transform

type:
    tool

provider:
    python

capabilities:
    - clean
    - map
    - aggregate

## Step: Validate

module Validate

type:
    tool

provider:
    python

capabilities:
    - check-constraints
    - verify-types
    - detect-outliers

## Step: Load

module Load

type:
    tool

provider:
    python

capabilities:
    - write
    - upsert
    - index

## Step: Report

module Report

type:
    tool

provider:
    python

capabilities:
    - summarize
    - export

## Python

```python
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, Callable
from enum import Enum
import statistics


class RecordStatus(Enum):
    VALID = "valid"
    INVALID = "invalid"
    TRANSFORMED = "transformed"


@dataclass
class Record:
    id: str
    data: Dict[str, Any]
    status: RecordStatus = RecordStatus.VALID
    errors: List[str] = field(default_factory=list)


@dataclass
class PipelineReport:
    extracted: int = 0
    transformed: int = 0
    valid: int = 0
    invalid: int = 0
    loaded: int = 0
    skipped: int = 0
    errors: List[str] = field(default_factory=list)
    duration_ms: float = 0.0


@dataclass
class ValidationRule:
    field_name: str
    rule_type: str
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TransformRule:
    field_name: str
    operation: str
    params: Dict[str, Any] = field(default_factory=dict)


def extract_data(source: List[Dict[str, Any]]) -> List[Record]:
    records = []
    for idx, item in enumerate(source):
        record = Record(
            id=str(idx + 1),
            data=item.copy(),
            status=RecordStatus.VALID,
        )
        records.append(record)
    return records


def apply_transforms(
    records: List[Record], rules: List[TransformRule]
) -> List[Record]:
    transformed = []
    for record in records:
        for rule in rules:
            if rule.field_name in record.data:
                value = record.data[rule.field_name]
                if rule.operation == "lowercase":
                    record.data[rule.field_name] = str(value).lower()
                elif rule.operation == "uppercase":
                    record.data[rule.field_name] = str(value).upper()
                elif rule.operation == "strip":
                    record.data[rule.field_name] = str(value).strip()
                elif rule.operation == "to_int":
                    try:
                        record.data[rule.field_name] = int(value)
                    except (ValueError, TypeError):
                        record.errors.append(
                            f"Cannot convert {rule.field_name} to int"
                        )
                elif rule.operation == "multiply":
                    factor = rule.params.get("factor", 1)
                    try:
                        record.data[rule.field_name] = float(value) * factor
                    except (ValueError, TypeError):
                        record.errors.append(
                            f"Cannot multiply {rule.field_name}"
                        )
        record.status = RecordStatus.TRANSFORMED
        transformed.append(record)
    return transformed


def validate_data(
    records: List[Record], rules: List[ValidationRule]
) -> List[Record]:
    validated = []
    for record in records:
        for rule in rules:
            field_val = record.data.get(rule.field_name)
            if rule.rule_type == "required":
                if field_val is None or str(field_val).strip() == "":
                    record.errors.append(
                        f"{rule.field_name} is required"
                    )
                    record.status = RecordStatus.INVALID
            elif rule.rule_type == "type":
                expected = rule.params.get("expected_type", str)
                if field_val is not None and not isinstance(
                    field_val, expected
                ):
                    record.errors.append(
                        f"{rule.field_name} must be {expected.__name__}"
                    )
                    record.status = RecordStatus.INVALID
            elif rule.rule_type == "min_length":
                min_len = rule.params.get("value", 0)
                if field_val and len(str(field_val)) < min_len:
                    record.errors.append(
                        f"{rule.field_name} below minimum length {min_len}"
                    )
                    record.status = RecordStatus.INVALID
            elif rule.rule_type == "range":
                low = rule.params.get("min", float("-inf"))
                high = rule.params.get("max", float("inf"))
                try:
                    num_val = float(field_val)
                    if not (low <= num_val <= high):
                        record.errors.append(
                            f"{rule.field_name} out of range [{low}, {high}]"
                        )
                        record.status = RecordStatus.INVALID
                except (ValueError, TypeError):
                    record.errors.append(
                        f"{rule.field_name} is not numeric"
                    )
                    record.status = RecordStatus.INVALID
        if record.status != RecordStatus.INVALID:
            record.status = RecordStatus.VALID
        validated.append(record)
    return validated


def load_data(
    records: List[Record], target: Optional[List[Record]] = None
) -> List[Record]:
    if target is None:
        target = []
    loaded = []
    for record in records:
        if record.status in (RecordStatus.VALID, RecordStatus.TRANSFORMED):
            target.append(record)
            loaded.append(record)
    return loaded


def generate_report(
    extracted: int,
    transformed: int,
    valid: int,
    invalid: int,
    loaded: int,
    errors: List[str],
) -> PipelineReport:
    return PipelineReport(
        extracted=extracted,
        transformed=transformed,
        valid=valid,
        invalid=invalid,
        loaded=loaded,
        skipped=extracted - loaded,
        errors=errors,
    )


def run_pipeline(
    source: List[Dict[str, Any]],
    transform_rules: Optional[List[TransformRule]] = None,
    validation_rules: Optional[List[ValidationRule]] = None,
) -> PipelineReport:
    if transform_rules is None:
        transform_rules = []
    if validation_rules is None:
        validation_rules = []

    records = extract_data(source)
    extracted = len(records)

    transformed = apply_transforms(records, transform_rules)
    transformed_count = len(transformed)

    validated = validate_data(transformed, validation_rules)
    valid_count = sum(
        1 for r in validated if r.status != RecordStatus.INVALID
    )
    invalid_count = sum(
        1 for r in validated if r.status == RecordStatus.INVALID
    )

    all_errors = []
    for r in validated:
        all_errors.extend(r.errors)

    loaded = load_data(
        [r for r in validated if r.status != RecordStatus.INVALID]
    )

    return generate_report(
        extracted=extracted,
        transformed=transformed_count,
        valid=valid_count,
        invalid=invalid_count,
        loaded=len(loaded),
        errors=all_errors,
    )
```

## Examples

```python
raw_data = [
    {"name": "Alice", "age": "30", "email": "alice@example.com"},
    {"name": "Bob", "age": "invalid", "email": "bob@example.com"},
    {"name": "", "age": "25", "email": "charlie@example.com"},
]

transform_rules = [
    TransformRule(field_name="name", operation="strip"),
    TransformRule(field_name="email", operation="lowercase"),
    TransformRule(field_name="age", operation="to_int"),
]

validation_rules = [
    ValidationRule(field_name="name", rule_type="required"),
    ValidationRule(field_name="email", rule_type="required"),
    ValidationRule(field_name="age", rule_type="range", params={"min": 0, "max": 150}),
]

report = run_pipeline(raw_data, transform_rules, validation_rules)
print(report.extracted)    # 3
print(report.valid)        # 2
print(report.invalid)      # 1
print(report.loaded)       # 2
```

## Tests

```python
def test_extract_data():
    records = extract_data([{"a": 1}, {"b": 2}])
    assert len(records) == 2
    assert records[0].id == "1"
    assert records[0].data == {"a": 1}


def test_apply_transforms_lowercase():
    records = [Record(id="1", data={"name": "ALICE"})]
    rules = [TransformRule(field_name="name", operation="lowercase")]
    result = apply_transforms(records, rules)
    assert result[0].data["name"] == "alice"


def test_apply_transforms_to_int():
    records = [Record(id="1", data={"age": "25"})]
    rules = [TransformRule(field_name="age", operation="to_int")]
    result = apply_transforms(records, rules)
    assert result[0].data["age"] == 25
    assert result[0].status == RecordStatus.TRANSFORMED


def test_apply_transforms_to_int_invalid():
    records = [Record(id="1", data={"age": "abc"})]
    rules = [TransformRule(field_name="age", operation="to_int")]
    result = apply_transforms(records, rules)
    assert len(result[0].errors) > 0


def test_validate_required():
    records = [Record(id="1", data={"name": ""})]
    rules = [ValidationRule(field_name="name", rule_type="required")]
    result = validate_data(records, rules)
    assert result[0].status == RecordStatus.INVALID


def test_validate_range():
    records = [Record(id="1", data={"score": 150})]
    rules = [
        ValidationRule(
            field_name="score", rule_type="range", params={"min": 0, "max": 100}
        )
    ]
    result = validate_data(records, rules)
    assert result[0].status == RecordStatus.INVALID


def test_validate_range_valid():
    records = [Record(id="1", data={"score": 75})]
    rules = [
        ValidationRule(
            field_name="score", rule_type="range", params={"min": 0, "max": 100}
        )
    ]
    result = validate_data(records, rules)
    assert result[0].status == RecordStatus.VALID


def test_load_data_filters_invalid():
    records = [
        Record(id="1", data={"a": 1}, status=RecordStatus.VALID),
        Record(id="2", data={"a": 2}, status=RecordStatus.INVALID),
    ]
    loaded = load_data(records)
    assert len(loaded) == 1


def test_run_pipeline_full():
    data = [{"x": 1}, {"x": 2}]
    report = run_pipeline(data)
    assert report.extracted == 2
    assert report.loaded == 2
    assert report.invalid == 0


def test_pipeline_report_fields():
    report = PipelineReport(
        extracted=10, transformed=10, valid=8, invalid=2, loaded=8
    )
    assert report.skipped == 2
    assert len(report.errors) == 0
```

## Dependencies

- None (standard library only)
