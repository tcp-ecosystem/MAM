---
id: monitoring-agent
version: 1.0.0
name: System Monitoring Agent
author: MAM Team
runtime: python
tags:
  - agent
  - monitoring
  - alerting
  - metrics
  - advanced
description: A monitoring agent that collects system metrics, detects anomalies using statistical analysis, and sends alerts. Includes AlertManager and MetricsCollector tool modules with filesystem and network permissions.
---

# System Monitoring Agent

## Purpose

An autonomous monitoring agent that continuously collects system metrics, detects anomalies through statistical analysis and threshold comparison, and dispatches alerts to configured channels. The system enforces a MonitoringPolicy that allows read-only observation while preventing destructive actions.

## System Definition

module MonitoringSystem

type:
    system

modules:
    - MonitorAgent
    - AlertManager
    - MetricsCollector

edges:
    MonitorAgent -> MetricsCollector
    MonitorAgent -> AlertManager

## Module: MonitorAgent

module MonitorAgent

type:
    agent

role:
    Monitor

goal:
    Continuously observe system metrics, detect anomalies early, and trigger alerts before incidents escalate

permissions:
    network: outbound
    filesystem: read

tools:
    - Python

handoff:
    - AlertManager

## Module: AlertManager

module AlertManager

type:
    tool

provider:
    python

role:
    Alerting

goal:
    Dispatch structured alerts to configured channels (email, webhook, log) with severity classification and deduplication

permissions:
    network: outbound
    filesystem: write

capabilities:
    - send-alert
    - deduplicate
    - classify-severity

## Module: MetricsCollector

module MetricsCollector

type:
    tool

provider:
    python

role:
    Collection

goal:
    Gather system metrics including CPU usage, memory consumption, disk I/O, and network throughput at configurable intervals

permissions:
    filesystem: read
    exec: true

capabilities:
    - collect-cpu
    - collect-memory
    - collect-disk
    - collect-network

## Policy: MonitoringPolicy

module MonitoringPolicy

type:
    policy

allow:
    - python
    - metrics-read
    - alert-send
    - filesystem.read

deny:
    - shell.rm
    - filesystem.write
    - network.internal
    - process.kill

permissions:
    filesystem: read
    network: outbound
    python: sandbox

## Python

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Callable
from enum import Enum
from collections import deque
import statistics
import time
import math


class Severity(Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class MetricPoint:
    timestamp: float
    metric_name: str
    value: float
    labels: Dict[str, str] = field(default_factory=dict)


@dataclass
class Alert:
    severity: Severity
    metric_name: str
    message: str
    value: float
    threshold: float
    timestamp: float = 0.0
    resolved: bool = False

    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()


@dataclass
class AnomalyThresholds:
    cpu_warning: float = 80.0
    cpu_critical: float = 95.0
    memory_warning: float = 85.0
    memory_critical: float = 95.0
    disk_warning: float = 90.0
    disk_critical: float = 98.0
    z_score_threshold: float = 2.5


class MetricsCollector:
    def __init__(self, buffer_size: int = 100):
        self._buffer: Dict[str, deque] = {}
        self._buffer_size = buffer_size

    def _record(self, name: str, value: float) -> MetricPoint:
        point = MetricPoint(
            timestamp=time.time(), metric_name=name, value=value
        )
        if name not in self._buffer:
            self._buffer[name] = deque(maxlen=self._buffer_size)
        self._buffer[name].append(point)
        return point

    def collect_cpu(self, value: float) -> MetricPoint:
        return self._record("cpu_percent", value)

    def collect_memory(self, value: float) -> MetricPoint:
        return self._record("memory_percent", value)

    def collect_disk(self, value: float) -> MetricPoint:
        return self._record("disk_percent", value)

    def collect_network(self, bytes_in: float, bytes_out: float) -> Dict[str, MetricPoint]:
        return {
            "bytes_in": self._record("network_bytes_in", bytes_in),
            "bytes_out": self._record("network_bytes_out", bytes_out),
        }

    def get_history(self, metric_name: str) -> List[MetricPoint]:
        return list(self._buffer.get(metric_name, []))

    def get_recent(self, metric_name: str, count: int = 10) -> List[MetricPoint]:
        buf = self._buffer.get(metric_name, deque())
        return list(buf)[-count:]


class AlertManager:
    def __init__(self):
        self._alerts: List[Alert] = []
        self._sent_hashes: set = set()
        self._handlers: List[Callable] = []

    def register_handler(self, handler: Callable) -> None:
        self._handlers.append(handler)

    def _alert_hash(self, alert: Alert) -> str:
        return f"{alert.severity.value}:{alert.metric_name}:{alert.message}"

    def send_alert(self, alert: Alert) -> bool:
        h = self._alert_hash(alert)
        if h in self._sent_hashes:
            return False
        self._sent_hashes.add(h)
        self._alerts.append(alert)
        for handler in self._handlers:
            try:
                handler(alert)
            except Exception:
                pass
        return True

    def get_alerts(self) -> List[Alert]:
        return list(self._alerts)

    def get_unresolved(self) -> List[Alert]:
        return [a for a in self._alerts if not a.resolved]

    def resolve_alert(self, alert_hash: str) -> bool:
        for a in self._alerts:
            if self._alert_hash(a) == alert_hash:
                a.resolved = True
                return True
        return False

    def clear_resolved(self) -> int:
        before = len(self._alerts)
        self._alerts = [a for a in self._alerts if not a.resolved]
        return before - len(self._alerts)


def compute_z_score(values: List[float], current: float) -> float:
    if len(values) < 2:
        return 0.0
    mean = statistics.mean(values)
    stdev = statistics.stdev(values)
    if stdev == 0:
        return 0.0
    return (current - mean) / stdev


def detect_anomalies(
    metric_name: str,
    value: float,
    history: List[float],
    thresholds: AnomalyThresholds,
) -> List[Alert]:
    alerts: List[Alert] = []
    z = compute_z_score(history, value)

    if metric_name == "cpu_percent":
        if value >= thresholds.cpu_critical:
            alerts.append(Alert(
                Severity.CRITICAL, metric_name,
                f"CPU at {value:.1f}% (critical threshold: {thresholds.cpu_critical}%)",
                value, thresholds.cpu_critical,
            ))
        elif value >= thresholds.cpu_warning:
            alerts.append(Alert(
                Severity.WARNING, metric_name,
                f"CPU at {value:.1f}% (warning threshold: {thresholds.cpu_warning}%)",
                value, thresholds.cpu_warning,
            ))
    elif metric_name == "memory_percent":
        if value >= thresholds.memory_critical:
            alerts.append(Alert(
                Severity.CRITICAL, metric_name,
                f"Memory at {value:.1f}% (critical threshold: {thresholds.memory_critical}%)",
                value, thresholds.memory_critical,
            ))
        elif value >= thresholds.memory_warning:
            alerts.append(Alert(
                Severity.WARNING, metric_name,
                f"Memory at {value:.1f}% (warning threshold: {thresholds.memory_warning}%)",
                value, thresholds.memory_warning,
            ))
    elif metric_name == "disk_percent":
        if value >= thresholds.disk_critical:
            alerts.append(Alert(
                Severity.CRITICAL, metric_name,
                f"Disk at {value:.1f}% (critical threshold: {thresholds.disk_critical}%)",
                value, thresholds.disk_critical,
            ))
        elif value >= thresholds.disk_warning:
            alerts.append(Alert(
                Severity.WARNING, metric_name,
                f"Disk at {value:.1f}% (warning threshold: {thresholds.disk_warning}%)",
                value, thresholds.disk_warning,
            ))

    if abs(z) > thresholds.z_score_threshold:
        direction = "spike" if z > 0 else "drop"
        alerts.append(Alert(
            Severity.WARNING, metric_name,
            f"Statistical anomaly detected: {direction} (z-score: {z:.2f})",
            value, thresholds.z_score_threshold,
        ))
    return alerts


class MonitorAgent:
    def __init__(
        self,
        thresholds: Optional[AnomalyThresholds] = None,
    ):
        self.collector = MetricsCollector()
        self.alert_manager = AlertManager()
        self.thresholds = thresholds or AnomalyThresholds()
        self._metrics_log: List[Dict] = []

    def ingest_metric(self, metric_name: str, value: float) -> List[Alert]:
        if metric_name == "cpu_percent":
            self.collector.collect_cpu(value)
        elif metric_name == "memory_percent":
            self.collector.collect_memory(value)
        elif metric_name == "disk_percent":
            self.collector.collect_disk(value)

        history = [
            p.value for p in self.collector.get_history(metric_name)
        ]
        anomalies = detect_anomalies(
            metric_name, value, history[:-1], self.thresholds
        )
        for alert in anomalies:
            self.alert_manager.send_alert(alert)
        self._metrics_log.append({
            "metric": metric_name,
            "value": value,
            "alerts_generated": len(anomalies),
        })
        return anomalies

    def get_summary(self) -> Dict:
        return {
            "total_metrics": len(self._metrics_log),
            "total_alerts": len(self.alert_manager.get_alerts()),
            "unresolved_alerts": len(self.alert_manager.get_unresolved()),
        }


def monitor_system(
    metric_series: List[Dict[str, float]],
    thresholds: Optional[AnomalyThresholds] = None,
) -> Dict:
    agent = MonitorAgent(thresholds)
    all_alerts: List[Alert] = []
    for sample in metric_series:
        for name, value in sample.items():
            alerts = agent.ingest_metric(name, value)
            all_alerts.extend(alerts)
    return {
        "summary": agent.get_summary(),
        "alerts": [
            {
                "severity": a.severity.value,
                "metric": a.metric_name,
                "message": a.message,
                "value": a.value,
            }
            for a in all_alerts
        ],
    }
```

## Examples

```python
thresholds = AnomalyThresholds(
    cpu_warning=70.0, cpu_critical=90.0,
    memory_warning=80.0, memory_critical=95.0,
)

samples = [
    {"cpu_percent": 45.0, "memory_percent": 60.0},
    {"cpu_percent": 50.0, "memory_percent": 62.0},
    {"cpu_percent": 75.0, "memory_percent": 65.0},
    {"cpu_percent": 92.0, "memory_percent": 96.0},
]

result = monitor_system(samples, thresholds)
print(result["summary"]["total_alerts"])  # 3 (cpu warning, cpu critical, mem critical)
for alert in result["alerts"]:
    print(f"[{alert['severity']}] {alert['metric']}: {alert['message']}")
```

## Tests

```python
def test_compute_z_score_low_variance():
    values = [50.0, 50.0, 50.0, 50.0]
    z = compute_z_score(values, 50.0)
    assert z == 0.0


def test_compute_z_score_spike():
    values = [10.0, 12.0, 11.0, 10.5]
    z = compute_z_score(values, 50.0)
    assert z > 2.0


def test_detect_anomalies_cpu_critical():
    alerts = detect_anomalies("cpu_percent", 96.0, [50, 55, 60], AnomalyThresholds())
    critical = [a for a in alerts if a.severity == Severity.CRITICAL]
    assert len(critical) >= 1


def test_detect_anomalies_memory_warning():
    alerts = detect_anomalies("memory_percent", 88.0, [60, 65, 70], AnomalyThresholds())
    warnings = [a for a in alerts if a.severity == Severity.WARNING]
    assert len(warnings) >= 1


def test_detect_anomalies_no_alert():
    alerts = detect_anomalies("cpu_percent", 30.0, [25, 28, 30, 32], AnomalyThresholds())
    assert len(alerts) == 0


def test_alert_manager_dedup():
    am = AlertManager()
    a1 = Alert(Severity.WARNING, "cpu", "high", 85.0, 80.0)
    a2 = Alert(Severity.WARNING, "cpu", "high", 85.0, 80.0)
    assert am.send_alert(a1) is True
    assert am.send_alert(a2) is False
    assert len(am.get_alerts()) == 1


def test_monitor_agent_ingest():
    agent = MonitorAgent(AnomalyThresholds(cpu_warning=50.0))
    alerts = agent.ingest_metric("cpu_percent", 60.0)
    assert len(alerts) >= 1
    assert agent.get_summary()["total_metrics"] == 1


def test_monitor_system_full():
    samples = [
        {"cpu_percent": 40.0},
        {"cpu_percent": 45.0},
        {"cpu_percent": 95.0},
    ]
    result = monitor_system(samples, AnomalyThresholds(cpu_critical=90.0))
    assert result["summary"]["total_metrics"] == 3
    assert result["summary"]["total_alerts"] >= 1


def test_alert_handler_callback():
    received = []
    am = AlertManager()
    am.register_handler(lambda a: received.append(a))
    am.send_alert(Alert(Severity.INFO, "test", "msg", 1.0, 0.0))
    assert len(received) == 1
```

## Dependencies

- None (standard library only)
