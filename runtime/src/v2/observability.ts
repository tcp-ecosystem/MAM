/**
 * MAM V2 Observability Engine
 *
 * Standalone runtime observability: logs, metrics, traces, events,
 * token usage, latency, cost, retrieval metrics, and tool/model calls.
 */

export type ObservabilitySeverity = 'debug' | 'info' | 'warn' | 'error';
export type TraceStatus = 'ok' | 'error' | 'incomplete';

export interface ObservabilityConfig {
  enabled: boolean;
  /** Max retained log entries per severity bucket. */
  maxLogs: number;
  /** Max retained metric series. */
  maxMetrics: number;
  /** Max retained spans (traces). */
  maxSpans: number;
  /** Max retained events. */
  maxEvents: number;
  sampleRate: number;
}

export interface LogEntry {
  timestamp: number;
  severity: ObservabilitySeverity;
  message: string;
  args: unknown[];
  context?: string;
}

export interface MetricSample {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  labels: Record<string, string>;
}

export interface TraceSpan {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: TraceStatus;
  attributes: Record<string, unknown>;
  children: TraceSpan[];
}

export interface RuntimeEvent {
  id: string;
  name: string;
  timestamp: number;
  data: unknown;
  severity: ObservabilitySeverity;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model?: string;
  provider?: string;
  timestamp: number;
}

export interface ModelCallRecord {
  id: string;
  model: string;
  provider: string;
  latencyMs: number;
  cost: number;
  tokensIn: number;
  tokensOut: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface ToolCallRecord {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  latencyMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface RetrievalRecord {
  id: string;
  query: string;
  sources: string[];
  topK: number;
  latencyMs: number;
  timestamp: number;
}

export interface ObservabilityStats {
  logCount: number;
  metricCount: number;
  spanCount: number;
  eventCount: number;
  totalTokens: number;
  totalCost: number;
  modelCallCount: number;
  toolCallCount: number;
  retrievalCount: number;
  averageModelLatencyMs: number;
  averageToolLatencyMs: number;
}

export interface ObservabilityReport {
  stats: ObservabilityStats;
  logs: LogEntry[];
  metrics: MetricSample[];
  spans: TraceSpan[];
  events: RuntimeEvent[];
  tokenUsage: TokenUsage[];
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  retrieval: RetrievalRecord[];
}

/** A sink receives observability entries for export/persistence. */
export interface ObservabilitySink {
  onLog(entry: LogEntry): void;
  onMetric(sample: MetricSample): void;
  onSpan(span: TraceSpan): void;
  onEvent(event: RuntimeEvent): void;
  onModelCall(record: ModelCallRecord): void;
  onToolCall(record: ToolCallRecord): void;
}

const DEFAULT_CONFIG: ObservabilityConfig = {
  enabled: true,
  maxLogs: 1000,
  maxMetrics: 500,
  maxSpans: 500,
  maxEvents: 1000,
  sampleRate: 1.0,
};

export class ObservabilityEngine {
  private config: ObservabilityConfig;
  private logs: LogEntry[] = [];
  private metrics: MetricSample[] = [];
  private spans: TraceSpan[] = [];
  private events: RuntimeEvent[] = [];
  private tokenUsage: TokenUsage[] = [];
  private modelCalls: ModelCallRecord[] = [];
  private toolCalls: ToolCallRecord[] = [];
  private retrieval: RetrievalRecord[] = [];
  private sinks: ObservabilitySink[] = [];
  private spanStack: TraceSpan[] = [];

  constructor(config: Partial<ObservabilityConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  setSampleRate(rate: number): void {
    this.config.sampleRate = rate;
  }

  addSink(sink: ObservabilitySink): void {
    this.sinks.push(sink);
  }

  private sampled(): boolean {
    return Math.random() < this.config.sampleRate;
  }

  // -------------------------------------------------------------------------
  // Logs
  // -------------------------------------------------------------------------

  log(severity: ObservabilitySeverity, message: string, context?: string, ...args: unknown[]): void {
    if (!this.config.enabled || !this.sampled()) return;
    const entry: LogEntry = { timestamp: Date.now(), severity, message, args, context };
    this.logs.push(entry);
    if (this.logs.length > this.config.maxLogs) this.logs.shift();
    for (const sink of this.sinks) sink.onLog(entry);
  }

  debug(message: string, context?: string, ...args: unknown[]): void { this.log('debug', message, context, ...args); }
  info(message: string, context?: string, ...args: unknown[]): void { this.log('info', message, context, ...args); }
  warn(message: string, context?: string, ...args: unknown[]): void { this.log('warn', message, context, ...args); }
  error(message: string, context?: string, ...args: unknown[]): void { this.log('error', message, context, ...args); }

  getLogs(severity?: ObservabilitySeverity): LogEntry[] {
    return severity ? this.logs.filter((l) => l.severity === severity) : [...this.logs];
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  metric(name: string, value: number, unit = '', labels: Record<string, string> = {}): void {
    if (!this.config.enabled) return;
    const sample: MetricSample = { name, value, unit, timestamp: Date.now(), labels };
    this.metrics.push(sample);
    if (this.metrics.length > this.config.maxMetrics) this.metrics.shift();
    for (const sink of this.sinks) sink.onMetric(sample);
  }

  getMetrics(name?: string): MetricSample[] {
    return name ? this.metrics.filter((m) => m.name === name) : [...this.metrics];
  }

  metricSummary(name: string): { count: number; min: number; max: number; avg: number; sum: number } {
    const samples = this.getMetrics(name);
    if (samples.length === 0) return { count: 0, min: 0, max: 0, avg: 0, sum: 0 };
    const values = samples.map((s) => s.value);
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      sum: values.reduce((a, b) => a + b, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Traces
  // -------------------------------------------------------------------------

  startSpan(name: string, attributes: Record<string, unknown> = {}): string {
    const id = `span-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const span: TraceSpan = {
      id, name, startTime: Date.now(), endTime: 0, durationMs: 0,
      status: 'incomplete', attributes, children: [],
    };
    const parent = this.spanStack[this.spanStack.length - 1];
    if (parent) parent.children.push(span);
    else this.spans.push(span);
    this.spanStack.push(span);
    return id;
  }

  endSpan(spanId: string, status: TraceStatus = 'ok'): void {
    const idx = this.spanStack.map((s) => s.id).lastIndexOf(spanId);
    if (idx === -1) return;
    const span = this.spanStack[idx]!;
    span.endTime = Date.now();
    span.durationMs = span.endTime - span.startTime;
    span.status = status;
    this.spanStack.splice(idx, 1);
    for (const sink of this.sinks) sink.onSpan(span);
  }

  async trace<T>(name: string, fn: () => Promise<T>, attributes: Record<string, unknown> = {}): Promise<T> {
    const id = this.startSpan(name, attributes);
    try {
      const result = await fn();
      this.endSpan(id, 'ok');
      return result;
    } catch (err) {
      this.endSpan(id, 'error');
      throw err;
    }
  }

  getSpans(): TraceSpan[] { return [...this.spans]; }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  event(name: string, data: unknown, severity: ObservabilitySeverity = 'info'): void {
    if (!this.config.enabled) return;
    const evt: RuntimeEvent = { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, timestamp: Date.now(), data, severity };
    this.events.push(evt);
    if (this.events.length > this.config.maxEvents) this.events.shift();
    for (const sink of this.sinks) sink.onEvent(evt);
  }

  getEvents(name?: string): RuntimeEvent[] {
    return name ? this.events.filter((e) => e.name === name) : [...this.events];
  }

  // -------------------------------------------------------------------------
  // Token usage / latency / cost
  // -------------------------------------------------------------------------

  recordTokenUsage(inputTokens: number, outputTokens: number, model?: string, provider?: string): void {
    if (!this.config.enabled) return;
    this.tokenUsage.push({
      inputTokens, outputTokens,
      totalTokens: inputTokens + outputTokens,
      model, provider, timestamp: Date.now(),
    });
  }

  recordModelCall(record: Omit<ModelCallRecord, 'id' | 'timestamp'>): ModelCallRecord {
    const full: ModelCallRecord = { ...record, id: `model-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() };
    if (this.config.enabled) {
      this.modelCalls.push(full);
      for (const sink of this.sinks) sink.onModelCall(full);
    }
    return full;
  }

  recordToolCall(record: Omit<ToolCallRecord, 'id' | 'timestamp'>): ToolCallRecord {
    const full: ToolCallRecord = { ...record, id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() };
    if (this.config.enabled) {
      this.toolCalls.push(full);
      for (const sink of this.sinks) sink.onToolCall(full);
    }
    return full;
  }

  recordRetrieval(record: Omit<RetrievalRecord, 'id' | 'timestamp'>): RetrievalRecord {
    const full: RetrievalRecord = { ...record, id: `ret-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() };
    if (this.config.enabled) this.retrieval.push(full);
    return full;
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  getStats(): ObservabilityStats {
    const modelLatencies = this.modelCalls.map((m) => m.latencyMs);
    const toolLatencies = this.toolCalls.map((t) => t.latencyMs);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      logCount: this.logs.length,
      metricCount: this.metrics.length,
      spanCount: this.spans.length,
      eventCount: this.events.length,
      totalTokens: this.tokenUsage.reduce((s, t) => s + t.totalTokens, 0),
      totalCost: this.modelCalls.reduce((s, m) => s + m.cost, 0),
      modelCallCount: this.modelCalls.length,
      toolCallCount: this.toolCalls.length,
      retrievalCount: this.retrieval.length,
      averageModelLatencyMs: avg(modelLatencies),
      averageToolLatencyMs: avg(toolLatencies),
    };
  }

  report(): ObservabilityReport {
    return {
      stats: this.getStats(),
      logs: this.getLogs(),
      metrics: this.getMetrics(),
      spans: this.getSpans(),
      events: this.getEvents(),
      tokenUsage: [...this.tokenUsage],
      modelCalls: [...this.modelCalls],
      toolCalls: [...this.toolCalls],
      retrieval: [...this.retrieval],
    };
  }

  exportJson(): string {
    return JSON.stringify(this.report(), null, 2);
  }

  reset(): void {
    this.logs = [];
    this.metrics = [];
    this.spans = [];
    this.events = [];
    this.tokenUsage = [];
    this.modelCalls = [];
    this.toolCalls = [];
    this.retrieval = [];
    this.spanStack = [];
  }
}