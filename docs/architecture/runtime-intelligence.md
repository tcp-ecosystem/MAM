# Runtime Intelligence Layer

> **Phase 7: Context, Memory, Knowledge, Models, Tools, and Security -- the intelligence subsystems that sit above the MAM Runtime Kernel.**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Context Engine](#2-context-engine)
3. [Token Budget](#3-token-budget)
4. [Memory Engine](#4-memory-engine)
5. [Knowledge Engine](#5-knowledge-engine)
6. [Model Engine](#6-model-engine)
7. [Tool Engine](#7-tool-engine)
8. [Security Manager](#8-security-manager)
9. [Integration Guide](#9-integration-guide)
10. [API Reference](#10-api-reference)

---

## 1. Overview

The Intelligence Layer is an extension layer that sits above the MAM Runtime Kernel. It provides the runtime capabilities needed to execute intelligent systems -- context assembly, token budgeting, memory retrieval, knowledge management, model routing, tool invocation, and security enforcement.

### Architecture Position

```text
                         MAM
                          |
                    .mam Source
                          |
                         AST
                          |
              +-----------+-----------+
              |                       |
       MAM Native Runtime        Compiler
              |                       |
              |            +----------+----------+
              |            |          |          |
              |         Python       JS      Others
              |
       +------+----------------------------------+
       |             Runtime Kernel               |
       |                                          |
       |  Module / Workflow / State              |
       |  Event / Resource / Policy              |
       |  Permission / Capability                |
       |                                          |
       |  ====== Intelligence Layer ======       |
       |                                          |
       |  Context Engine                          |
       |  Token Budget                            |
       |  Memory Engine                           |
       |  Knowledge Engine                        |
       |  Model Engine                            |
       |  Tool Engine                             |
       |                                          |
       |  ====== Security Layer ======           |
       |                                          |
       |  Security Manager                        |
       |                                          |
       +------------------------------------------+
```

### Design Principles

- **Separation of concerns.** Intelligence is an extension, not the definition of the language. MAM describes systems; the intelligence layer executes them efficiently.
- **Declarative configuration.** Engines are configured through YAML declarations embedded in `.mam` modules, not through imperative code.
- **Engine composability.** Each engine is independent but designed to be composed. The Context Engine queries the Memory Engine, which queries the Knowledge Engine, which queries the Model Engine.
- **Security by default.** The Security Manager wraps all intelligence operations with audit logging, secret scanning, and permission checks.

---

## 2. Context Engine

The Context Engine treats context as a **managed execution resource**, not a string of text to concatenate into a prompt. It assembles, prioritizes, compresses, and validates the information that enters a model's context window.

### What It Does

- Gathers context from multiple sources (task definition, system state, memory, retrieval results, tool outputs, conversation history).
- Assigns each source a priority level.
- Allocates token budgets per source based on priority.
- Compresses and deduplicates low-priority sources when budgets are exceeded.
- Validates that the assembled context fits within the model's context window.

### Architecture

```text
Context Engine
|
+-- Context Builder       -- Assembles context from declared sources
+-- Context Selector      -- Filters sources based on priority
+-- Context Prioritizer   -- Ranks context fragments by relevance
+-- Context Compressor    -- Reduces token count for overflow sources
+-- Context Summarizer    -- Generates summaries for long passages
+-- Context Cache         -- Caches previously assembled contexts
+-- Context Budget        -- Enforces per-source and total token limits
+-- Context Validator     -- Validates final context against model constraints
```

### Configuration

A module declares its context requirements in the YAML frontmatter:

```yaml
context:
  budget: 32000

  sources:
    - task
    - system_state
    - memory
    - retrieval
    - tool_results
    - history

  priority:
    task: critical
    system_state: critical
    evidence: high
    memory: medium
    history: low

  optimization:
    compression: enabled
    caching: enabled
    deduplication: enabled

  strategies:
    - retrieve
    - compress
    - summarize
    - cache
```

### Priority Levels

| Level       | Behavior                                                     |
|-------------|--------------------------------------------------------------|
| `critical`  | Always included. Never compressed or evicted.                |
| `high`      | Included by default. Compressed only on overflow.            |
| `medium`    | Included if budget allows. Compressed or evicted first.      |
| `low`       | Included only if budget allows after all higher priorities.  |

### Example: Building Context Programmatically

```typescript
const engine = new ContextEngine();

const context = await engine.build({
  budget: 32000,
  sources: [
    { name: 'task', content: taskDescription, priority: 'critical' },
    { name: 'system_state', content: stateSnapshot, priority: 'critical' },
    { name: 'memory', content: memoryResults, priority: 'medium' },
    { name: 'retrieval', content: retrievedDocs, priority: 'high' },
  ],
  model: 'gpt-4',
});

console.log(context.totalTokens);   // 28432
console.log(context.sources.length); // 4
console.log(context.evicted);        // []
```

### Example: Context Compression

When total token usage exceeds the budget, the engine evicts and compresses sources in priority order:

```typescript
const overflow = await engine.build({
  budget: 16000,
  sources: [
    { name: 'task', content: largeTaskDescription, priority: 'critical' },
    { name: 'retrieval', content: eightRetrievedDocs, priority: 'high' },
    { name: 'history', content: conversationHistory, priority: 'low' },
  ],
});

// If task + retrieval = 14000 tokens, history gets evicted.
// If task + retrieval = 18000 tokens, history is evicted and retrieval is compressed.
```

---

## 3. Token Budget

The Token Budget subsystem provides explicit token economics for the Context Engine. It tracks spending, warns on approaching limits, and defragments context when sources compete for space.

### Allocation

Each source is allocated a token budget based on its priority and the total budget:

```text
Total Budget: 32,000 tokens

Source          Priority    Allocated    Actual
----------------------------------------------
task            critical    8,000        4,200
system_state    critical    6,000        2,100
retrieval       high        10,000       12,400
memory          medium      5,000        3,800
history         low         3,000        5,600
----------------------------------------------
                           32,000       28,100
```

### Spending Rules

1. Critical sources are allocated first, regardless of budget impact.
2. High sources are allocated next, consuming remaining budget.
3. Medium sources receive whatever budget remains.
4. Low sources receive only unallocated budget.

### Warnings

The budget tracker emits warnings when sources approach their limits:

```typescript
const budget = new TokenBudget({
  total: 32000,
  sources: [
    { name: 'task', priority: 'critical', maxTokens: 8000 },
    { name: 'retrieval', priority: 'high', maxTokens: 12000 },
  ],
});

budget.on('warning', (event) => {
  console.log(`${event.source}: ${event.used}/${event.max} tokens (${event.percentage}%)`);
});

budget.on('overflow', (event) => {
  console.log(`${event.source} exceeds budget by ${event.overflow} tokens`);
});
```

### Defragmentation

When multiple sources compete for limited budget, the budget engine defragments by:

1. Compacting multiple small sources into a single allocation.
2. Reusing shared prefixes (system prompts, common instructions) across requests.
3. Evicting duplicate content detected across sources.

```typescript
const defragged = await budget.defragment({
  deduplication: true,
  prefixReuse: true,
  compactSmall: { threshold: 500 },
});
```

### Budget Report

```typescript
const report = budget.report();
// {
//   total: 32000,
//   allocated: 28100,
//   remaining: 3900,
//   sources: [
//     { name: 'task', allocated: 8000, used: 4200, utilization: 0.525 },
//     { name: 'retrieval', allocated: 12000, used: 12400, utilization: 1.0 },
//   ],
//   defragmentationSavings: 1200,
// }
```

---

## 4. Memory Engine

The Memory Engine provides RAG-style memory with TF-IDF search, consolidation, and TTL-based expiration. It is separate from the Context Engine -- memory does not automatically mean "put everything into the context window."

### Memory Types

```text
Memory Engine
|
+-- Working Memory      -- Current execution state (in-memory, volatile)
+-- Short-Term Memory   -- Recent interactions (hours to days)
+-- Long-Term Memory    -- Persistent knowledge (days to months)
+-- Episodic Memory     -- Event sequences and outcomes
+-- Semantic Memory     -- Facts, relationships, and abstractions
```

### Storage Structure

Memory is persisted to disk between runs:

```
.mam/
+-- memory/
    +-- <module-id>/
        +-- working.json
        +-- short-term/
        |   +-- index.tfidf
        |   +-- records/
        +-- long-term/
        |   +-- index.tfidf
        |   +-- records/
        +-- episodic/
        |   +-- episodes/
        +-- semantic/
            +-- facts.json
            +-- relations.json
```

### TF-IDF Search

The memory engine uses TF-IDF (Term Frequency-Inverse Document Frequency) to rank memory records by relevance to a query:

```typescript
const memory = new MemoryEngine({ moduleId: 'research-agent' });

await memory.store({
  type: 'short-term',
  content: 'The API rate limit is 100 requests per minute.',
  tags: ['api', 'rate-limit'],
  ttl: '7d',
});

const results = await memory.search({
  query: 'What is the API rate limit?',
  type: 'short-term',
  topK: 5,
  threshold: 0.3,
});

// [
//   { id: 'mem_001', score: 0.87, content: 'The API rate limit is 100 requests per minute.' },
// ]
```

### Consolidation

Over time, short-term memories that are frequently accessed or highly scored get consolidated into long-term memory:

```typescript
const consolidation = await memory.consolidate({
  strategy: 'frequency',
  minAccessCount: 3,
  minScore: 0.5,
  target: 'long-term',
});

// Consolidated 12 short-term memories into long-term.
```

### TTL (Time-to-Live)

Each memory record can have an expiration time. Expired records are not returned in searches and are cleaned up periodically:

```typescript
await memory.store({
  type: 'short-term',
  content: 'Session token: abc123',
  ttl: '1h',
});

// Later:
const results = await memory.search({ query: 'session token', type: 'short-term' });
// Returns empty -- token has expired
```

### Memory Policies

```typescript
const memory = new MemoryEngine({
  moduleId: 'research-agent',
  policies: {
    maxShortTerm: 1000,
    maxLongTerm: 50000,
    defaultTTL: '30d',
    consolidationInterval: '6h',
    cleanupInterval: '1h',
  },
});
```

---

## 5. Knowledge Engine

The Knowledge Engine manages external knowledge sources, document indexing, and retrieval strategies. It separates knowledge from memory -- knowledge is reference material, while memory is learned state.

### Sources

Knowledge sources are configured declaratively:

```yaml
knowledge:
  sources:
    - name: documentation
      type: file
      path: ./docs/**/*.md
      chunkSize: 512
      chunkOverlap: 64

    - name: api-spec
      type: url
      url: https://api.example.com/openapi.json
      refreshInterval: 24h

    - name: internal-wiki
      type: vector-store
      endpoint: http://localhost:6333
      collection: wiki
```

### Document Indexing

Documents are chunked and indexed for retrieval:

```typescript
const knowledge = new KnowledgeEngine();

await knowledge.addSource({
  name: 'documentation',
  type: 'file',
  path: './docs/**/*.md',
  chunkSize: 512,
  chunkOverlap: 64,
});

const stats = await knowledge.index('documentation');
// { documents: 142, chunks: 1847, indexSize: '12.4 MB' }
```

### Retrieval Strategies

#### Keyword Retrieval

Uses BM25 for exact keyword matching:

```typescript
const results = await knowledge.retrieve({
  source: 'documentation',
  query: 'context engine budget allocation',
  strategy: 'keyword',
  topK: 8,
});
```

#### Semantic Retrieval

Uses vector embeddings for meaning-based matching:

```typescript
const results = await knowledge.retrieve({
  source: 'documentation',
  query: 'how does the runtime manage context',
  strategy: 'semantic',
  topK: 8,
  embeddingModel: 'text-embedding-3-small',
});
```

#### Hybrid Retrieval

Combines keyword and semantic scores with configurable weighting:

```typescript
const results = await knowledge.retrieve({
  source: 'documentation',
  query: 'token budget defragmentation',
  strategy: 'hybrid',
  topK: 8,
  weights: { keyword: 0.4, semantic: 0.6 },
});
```

### Provenance

Every retrieved result carries provenance metadata:

```typescript
const results = await knowledge.retrieve({
  source: 'documentation',
  query: 'memory consolidation',
  strategy: 'hybrid',
  topK: 3,
});

// results[0].provenance = {
//   source: 'documentation',
//   document: 'docs/memory-engine.md',
//   chunkIndex: 14,
//   retrievedAt: '2026-09-19T10:30:00Z',
//   strategy: 'hybrid',
//   scores: { keyword: 0.72, semantic: 0.85, combined: 0.79 },
// }
```

### Source Management

```typescript
await knowledge.refreshSource('documentation');
await knowledge.removeSource('api-spec');
await knowledge.listSources();  // ['documentation', 'internal-wiki']
```

---

## 6. Model Engine

The Model Engine provides provider-agnostic model access with capability matching, fallback chains, and middleware support. A MAM system should not be hard-coded to one model vendor.

### Provider Registration

```typescript
const models = new ModelEngine();

models.registerProvider({
  name: 'openai',
  adapter: new OpenAIAdapter({ apiKey: process.env.OPENAI_API_KEY }),
  models: [
    { id: 'gpt-4', capabilities: ['reasoning', 'structured_output', 'function_calling'] },
    { id: 'gpt-4o-mini', capabilities: ['reasoning', 'function_calling'] },
  ],
});

models.registerProvider({
  name: 'anthropic',
  adapter: new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY }),
  models: [
    { id: 'claude-sonnet-4-20250514', capabilities: ['reasoning', 'structured_output'] },
  ],
});
```

### Capability Matching

When a module declares required capabilities, the engine selects the best provider:

```yaml
model:
  capability:
    - reasoning
    - structured_output
  routing:
    strategy: capability
  fallback:
    enabled: true
```

```typescript
const selected = await models.select({
  capabilities: ['reasoning', 'structured_output'],
  strategy: 'capability',
});

// selected = { provider: 'openai', model: 'gpt-4', score: 1.0 }
```

### Fallback Chains

If the primary model fails or is unavailable, the engine follows a fallback chain:

```typescript
const result = await models.infer({
  messages: [...],
  fallback: {
    enabled: true,
    chain: [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      { provider: 'openai', model: 'gpt-4o-mini' },
    ],
    maxRetries: 3,
    retryDelay: '1s',
  },
});
```

### Middleware

The model engine supports middleware for pre/post processing:

```typescript
models.use('log-usage', async (ctx, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(`${ctx.model}: ${ctx.tokensIn} in / ${ctx.tokensOut} out / ${duration}ms`);
});

models.use('validate-output', async (ctx, next) => {
  await next();
  if (ctx.response.format === 'json') {
    JSON.parse(ctx.response.content);
  }
});
```

### Inference Budget

```typescript
const result = await models.infer({
  messages: [...],
  budget: {
    maxTokens: 4096,
    maxCost: 0.50,
    alertThreshold: 0.8,
  },
});
```

---

## 7. Tool Engine

Tools are first-class runtime modules. The Tool Engine handles registration, schema validation, parameter checking, caching, retry logic, and permission enforcement.

### Registration

```typescript
const tools = new ToolEngine();

tools.register({
  name: 'web_search',
  description: 'Search the web for information',
  parameters: {
    query: { type: 'string', required: true },
    numResults: { type: 'number', default: 5, min: 1, max: 20 },
  },
  handler: async (params) => {
    return await searchWeb(params.query, params.numResults);
  },
  permissions: ['network'],
  cache: { ttl: '5m', key: (params) => `search:${params.query}` },
  retry: { maxAttempts: 2, backoff: 'exponential' },
});
```

### Parameter Validation

The engine validates parameters against the declared schema before invocation:

```typescript
const validation = tools.validate('web_search', { query: 'MAM runtime' });
// { valid: true, sanitized: { query: 'MAM runtime', numResults: 5 } }

const invalid = tools.validate('web_search', {});
// { valid: false, errors: [{ field: 'query', message: 'Required parameter missing' }] }
```

### Caching

Results can be cached to avoid redundant invocations:

```typescript
tools.register({
  name: 'get_weather',
  parameters: {
    city: { type: 'string', required: true },
  },
  handler: async (params) => fetchWeather(params.city),
  cache: {
    ttl: '15m',
    key: (params) => `weather:${params.city}`,
  },
});

// First call: fetches from API
await tools.invoke('get_weather', { city: 'New York' });

// Second call within 15m: returns cached result
await tools.invoke('get_weather', { city: 'New York' });
```

### Retry Logic

```typescript
tools.register({
  name: 'send_email',
  handler: async (params) => emailClient.send(params),
  retry: {
    maxAttempts: 3,
    backoff: 'exponential',
    retryOn: ['timeout', 'rate_limit'],
  },
  timeout: '30s',
});
```

### Permissions

Every tool invocation is checked against the current permission set:

```typescript
const result = await tools.invoke('web_search', {
  query: 'test',
  permissions: ['network', 'filesystem'],
});

// If 'network' permission is not granted, invocation is denied.
```

### Tool Discovery

Tools can be discovered dynamically:

```typescript
const available = tools.list();
// [
//   { name: 'web_search', permissions: ['network'] },
//   { name: 'get_weather', permissions: [] },
// ]

const withPermission = tools.list({ permission: 'network' });
// [{ name: 'web_search', permissions: ['network'] }]
```

---

## 8. Security Manager

The Security Manager enforces security policies across all intelligence engines. It provides secret scanning, audit logging, anomaly detection, and rate limiting.

### Secret Scanning

All inputs, outputs, and memory records are scanned for secrets:

```typescript
const security = new SecurityManager();

const scan = security.scan('Bearer sk-1234567890abcdef');
// { detected: true, type: 'api_key', redacted: 'Bearer sk-***' }

const clean = security.scan('Hello, how are you?');
// { detected: false, content: 'Hello, how are you?' }
```

### Supported Secret Types

| Type           | Pattern                              |
|----------------|--------------------------------------|
| API Key        | `sk-*`, `api_key=*`, `AKIA*`        |
| Private Key    | `-----BEGIN.*PRIVATE KEY-----`       |
| JWT            | `eyJhbGciOiJIUzI1NiJ9.*`           |
| Password       | `password=`, `passwd=*`, `pwd=*`    |
| Token          | `token=`, `access_token=*`          |
| Connection URL | `mysql://`, `postgres://`, `mongodb://` |

### Audit Logging

Every engine operation is logged for audit:

```typescript
security.audit({
  event: 'model.infer',
  provider: 'openai',
  model: 'gpt-4',
  tokensIn: 1200,
  tokensOut: 800,
  cost: 0.048,
  duration: 2340,
  userId: 'user_001',
  moduleId: 'research-agent',
});

security.audit({
  event: 'tool.invoke',
  tool: 'web_search',
  parameters: { query: 'MAM runtime' },
  permissions: ['network'],
  result: 'success',
  userId: 'user_001',
});
```

### Anomaly Detection

The security manager tracks usage patterns and detects anomalies:

```typescript
security.on('anomaly', (event) => {
  console.log(`Anomaly: ${event.type} -- ${event.description}`);
});

// Examples:
// Anomaly: rate_spike -- 47 requests in 60s (normal: 5-10)
// Anomaly: cost_spike -- $12.40 spent in 5m (normal: $0.50-$2.00)
// Anomaly: unusual_source -- Memory accessed from unknown module
```

### Rate Limiting

Per-user and per-module rate limits are enforced:

```typescript
const security = new SecurityManager({
  rateLimits: {
    'model.infer': { window: '1m', max: 20 },
    'tool.invoke': { window: '1m', max: 50 },
    'memory.store': { window: '1h', max: 500 },
  },
});

// If a user exceeds 20 model inference calls in 1 minute,
// subsequent calls are rejected with a 429 status.
```

### Security Policy

Policies are declared in the module YAML:

```yaml
security:
  secretScanning: enabled
  auditLog: enabled
  rateLimits:
    model.infer: 20/m
    tool.invoke: 50/m
  permissions:
    network: required
    filesystem: denied
    gpu: denied
```

---

## 9. Integration Guide

The intelligence engines compose to form a complete execution pipeline. Here is how they fit together in a typical runtime flow.

### Execution Pipeline

```text
Module Definition (.mam)
         |
         v
   +-----+-----+
   |            |
   v            v
Context    Knowledge
Engine      Engine
   |            |
   +-----+------+
         |
         v
   +-----+-----+
   |            |
   v            v
  Memory    Model
  Engine    Engine
         |
         v
   +-----+-----+
   |            |
   v            v
  Tool     Security
  Engine   Manager
         |
         v
      Execution
```

### Step-by-Step Flow

1. **Module declaration.** The `.mam` file declares context requirements, knowledge sources, model preferences, and tool permissions.

2. **Context assembly.** The Context Engine gathers sources, applies priority rules, and enforces the token budget.

3. **Knowledge retrieval.** If knowledge sources are declared, the Knowledge Engine retrieves relevant documents using the configured strategy.

4. **Memory retrieval.** The Memory Engine searches for relevant past interactions using TF-IDF scoring.

5. **Context merge.** The Context Engine merges retrieved knowledge and memory into the assembled context.

6. **Model selection.** The Model Engine selects a provider based on required capabilities and fallback configuration.

7. **Tool invocation.** If the model requests tool calls, the Tool Engine validates parameters, checks permissions, and invokes handlers.

8. **Security checks.** The Security Manager scans all inputs/outputs for secrets, logs the operation, checks rate limits, and detects anomalies.

9. **Response assembly.** The final response is assembled, validated, and returned to the caller.

### Complete Example

```yaml
# research-agent.mam
id: research-agent
version: 2.0.0
name: Research Agent

context:
  budget: 32000
  sources:
    - task
    - system_state
    - memory
    - retrieval
  priority:
    task: critical
    system_state: critical
    retrieval: high
    memory: medium

knowledge:
  sources:
    - name: documentation
      type: file
      path: ./docs/**/*.md
      chunkSize: 512

model:
  capability:
    - reasoning
    - structured_output
  routing:
    strategy: capability
  fallback:
    enabled: true
    chain:
      - provider: openai
        model: gpt-4
      - provider: anthropic
        model: claude-sonnet-4-20250514

tools:
  - name: web_search
    permissions: [network]
  - name: write_file
    permissions: [filesystem]

security:
  secretScanning: enabled
  auditLog: enabled
  rateLimits:
    model.infer: 20/m
```

### Runtime Initialization

```typescript
import { Runtime } from '@mam/runtime';

const runtime = new Runtime({
  intelligence: {
    context: { defaultBudget: 32000 },
    memory: { defaultTTL: '30d', consolidationInterval: '6h' },
    knowledge: { defaultStrategy: 'hybrid', defaultTopK: 8 },
    model: { fallbackEnabled: true },
    security: { secretScanning: true, auditLog: true },
  },
});

const result = await runtime.execute('./research-agent.mam', {
  inputs: { query: 'Summarize MAM architecture' },
});

console.log(result.output);
console.log(result.metrics);
// {
//   contextTokens: 28432,
//   memoryHits: 3,
//   knowledgeHits: 7,
//   modelCalls: 1,
//   toolCalls: 2,
//   totalCost: 0.062,
//   duration: 4200,
// }
```

---

## 10. API Reference

### ContextEngine

```typescript
class ContextEngine {
  build(options: ContextBuildOptions): Promise<ContextResult>;
  compress(sources: ContextSource[], budget: number): Promise<ContextSource[]>;
  validate(context: ContextResult, model: string): ValidationResult;
}

interface ContextBuildOptions {
  budget: number;
  sources: ContextSource[];
  model: string;
  optimization?: {
    compression?: boolean;
    caching?: boolean;
    deduplication?: boolean;
  };
}

interface ContextResult {
  totalTokens: number;
  sources: ContextSource[];
  evicted: string[];
  compressed: string[];
  cached: boolean;
}

interface ContextSource {
  name: string;
  content: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  tokens?: number;
}
```

### TokenBudget

```typescript
class TokenBudget {
  constructor(options: TokenBudgetOptions);
  on(event: 'warning' | 'overflow', handler: (event: BudgetEvent) => void): void;
  defragment(options: DefragOptions): Promise<DefragResult>;
  report(): BudgetReport;
}

interface TokenBudgetOptions {
  total: number;
  sources: Array<{
    name: string;
    priority: string;
    maxTokens: number;
  }>;
}

interface BudgetReport {
  total: number;
  allocated: number;
  remaining: number;
  sources: Array<{
    name: string;
    allocated: number;
    used: number;
    utilization: number;
  }>;
  defragmentationSavings: number;
}
```

### MemoryEngine

```typescript
class MemoryEngine {
  constructor(options: MemoryEngineOptions);
  store(record: MemoryRecord): Promise<string>;
  search(query: MemorySearchQuery): Promise<MemoryResult[]>;
  consolidate(options: ConsolidationOptions): Promise<ConsolidationResult>;
  retrieve(id: string): Promise<MemoryRecord | null>;
  delete(id: string): Promise<boolean>;
}

interface MemoryRecord {
  id?: string;
  type: 'working' | 'short-term' | 'long-term' | 'episodic' | 'semantic';
  content: string;
  tags?: string[];
  ttl?: string;
  metadata?: Record<string, unknown>;
}

interface MemorySearchQuery {
  query: string;
  type?: string;
  topK?: number;
  threshold?: number;
  tags?: string[];
}

interface MemoryResult {
  id: string;
  score: number;
  content: string;
  type: string;
  tags: string[];
  createdAt: string;
  accessedAt: string;
}
```

### KnowledgeEngine

```typescript
class KnowledgeEngine {
  addSource(config: KnowledgeSourceConfig): Promise<void>;
  removeSource(name: string): Promise<void>;
  listSources(): string[];
  index(sourceName: string): Promise<IndexStats>;
  retrieve(query: KnowledgeQuery): Promise<KnowledgeResult[]>;
  refreshSource(name: string): Promise<void>;
}

interface KnowledgeSourceConfig {
  name: string;
  type: 'file' | 'url' | 'vector-store';
  path?: string;
  url?: string;
  endpoint?: string;
  collection?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  refreshInterval?: string;
}

interface KnowledgeQuery {
  source: string;
  query: string;
  strategy: 'keyword' | 'semantic' | 'hybrid';
  topK?: number;
  weights?: { keyword?: number; semantic?: number };
  embeddingModel?: string;
}

interface KnowledgeResult {
  id: string;
  content: string;
  score: number;
  provenance: {
    source: string;
    document: string;
    chunkIndex: number;
    retrievedAt: string;
    strategy: string;
    scores: Record<string, number>;
  };
}
```

### ModelEngine

```typescript
class ModelEngine {
  registerProvider(config: ProviderConfig): void;
  unregisterProvider(name: string): void;
  select(options: ModelSelectOptions): Promise<SelectedModel>;
  infer(options: InferOptions): Promise<InferResult>;
  use(name: string, middleware: Middleware): void;
}

interface ProviderConfig {
  name: string;
  adapter: ProviderAdapter;
  models: Array<{
    id: string;
    capabilities: string[];
  }>;
}

interface ModelSelectOptions {
  capabilities: string[];
  strategy: 'capability' | 'cost' | 'latency' | 'random';
}

interface InferOptions {
  messages: Message[];
  fallback?: {
    enabled: boolean;
    chain: Array<{ provider: string; model: string }>;
    maxRetries?: number;
    retryDelay?: string;
  };
  budget?: {
    maxTokens?: number;
    maxCost?: number;
    alertThreshold?: number;
  };
}

interface InferResult {
  content: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  duration: number;
}
```

### ToolEngine

```typescript
class ToolEngine {
  register(config: ToolConfig): void;
  unregister(name: string): void;
  validate(toolName: string, params: Record<string, unknown>): ValidationResult;
  invoke(toolName: string, params: Record<string, unknown>, options?: InvokeOptions): Promise<ToolResult>;
  list(options?: ListOptions): ToolInfo[];
}

interface ToolConfig {
  name: string;
  description?: string;
  parameters: Record<string, ParameterSchema>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  permissions?: string[];
  cache?: { ttl: string; key: (params: Record<string, unknown>) => string };
  retry?: { maxAttempts: number; backoff: string; retryOn?: string[] };
  timeout?: string;
}

interface ToolResult {
  success: boolean;
  output: unknown;
  cached: boolean;
  duration: number;
  attempts: number;
}
```

### SecurityManager

```typescript
class SecurityManager {
  constructor(options?: SecurityManagerOptions);
  scan(input: string): ScanResult;
  audit(entry: AuditEntry): void;
  checkRateLimit(event: string, userId: string): RateLimitResult;
  on(event: 'anomaly', handler: (event: AnomalyEvent) => void): void;
}

interface ScanResult {
  detected: boolean;
  type?: string;
  content?: string;
  redacted?: string;
}

interface AuditEntry {
  event: string;
  userId?: string;
  moduleId?: string;
  [key: string]: unknown;
}

interface SecurityManagerOptions {
  rateLimits?: Record<string, { window: string; max: number }>;
  secretPatterns?: Array<{ type: string; pattern: RegExp }>;
}
```

---

## References

- [Runtime Architecture](./runtime.md)
- [Next-Gen Runtime Specification](../../plan-doc/next-gen-runtime.md)
- [Parser Architecture](./parser.md)
- [AST Architecture](./ast.md)

---

**Last Updated:** 2026-09-19
**MAM Version:** 1.0.0
**Phase:** 7 -- Intelligence Layer
