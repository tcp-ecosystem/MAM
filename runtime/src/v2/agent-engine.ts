/**
 * MAM V2 Agent Engine
 *
 * An agent is a runtime composition of model, context, memory, knowledge,
 * tools, workflow, state and policy. The engine orchestrates that
 * composition without making the agent the center of the language.
 */

export interface ModelInvokeOptions {
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface ModelResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  finishReason?: string;
}

/** Provider-neutral model adapter. */
export interface ModelAdapter {
  readonly name: string;
  readonly provider: string;
  invoke(input: string, options?: ModelInvokeOptions): Promise<ModelResult>;
}

export interface ContextSource {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  content: string;
}

/** Context adapter assembles the active context for a model call. */
export interface ContextAdapter {
  assemble(sources: ContextSource[]): Promise<string>;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  timestamp: number;
}

export interface MemoryAdapter {
  read(key: string): Promise<unknown | undefined>;
  write(key: string, value: unknown): Promise<void>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
}

export interface KnowledgeHit {
  text: string;
  score: number;
  source: string;
}

export interface KnowledgeAdapter {
  retrieve(query: string, topK?: number): Promise<KnowledgeHit[]>;
}

export interface ToolDefinitionLite {
  name: string;
  description: string;
}

export interface ToolRegistry {
  list(): ToolDefinitionLite[];
  invoke(name: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface AgentPolicy {
  allowTool(name: string): boolean;
  allowAction(action: string): boolean;
}

export interface AgentConfig {
  name: string;
  id?: string;
  model: ModelAdapter;
  systemPrompt?: string;
  context?: ContextAdapter;
  memory?: MemoryAdapter;
  knowledge?: KnowledgeAdapter;
  tools?: ToolRegistry;
  policy?: AgentPolicy;
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface AgentRunOptions {
  context?: ContextSource[];
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface AgentStep {
  type: 'think' | 'tool' | 'observe' | 'finish';
  content: string;
  tool?: string;
  durationMs: number;
}

export interface AgentRunResult {
  output: string;
  iterations: number;
  steps: AgentStep[];
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  memoryWrites: number;
}

export interface Agent {
  readonly name: string;
  readonly id: string;
  run(input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
  describe(): string;
}

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_TOOL_CALLS = 10;
const TOOL_MARKER = /\[\[tool:([a-zA-Z0-9_-]+)\]\]\s*(.*)/i;

export class AgentEngine {
  createAgent(config: AgentConfig): Agent {
    const id = config.id ?? `agent-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return {
      name: config.name,
      id,
      run: (input, options) => this.runAgent(config, input, options),
      describe: () => `${config.name} (model: ${config.model.name}@${config.model.provider}, tools: ${config.tools?.list().length ?? 0})`,
    };
  }

  private async buildPrompt(config: AgentConfig, input: string, opts: AgentRunOptions): Promise<string> {
    const parts: string[] = [];

    if (config.systemPrompt) parts.push(`System: ${config.systemPrompt}`);

    const sources = opts.context ?? [];
    if (config.memory) {
      const hits = await config.memory.search(input, 5);
      if (hits.length > 0) {
        parts.push(`Memory:\n${hits.map((h) => `- ${h.key}: ${String(h.value)}`).join('\n')}`);
      }
    }
    if (config.knowledge) {
      const hits = await config.knowledge.retrieve(input, 3);
      if (hits.length > 0) {
        parts.push(`Knowledge:\n${hits.map((h) => `- [${h.source}] ${h.text}`).join('\n')}`);
      }
    }
    if (sources.length > 0) {
      const assembled = config.context
        ? await config.context.assemble(sources)
        : sources.map((s) => s.content).join('\n');
      parts.push(`Context:\n${assembled}`);
    }
    if (config.tools) {
      parts.push(`Available tools:\n${config.tools.list().map((t) => `- ${t.name}: ${t.description}`).join('\n')}`);
    }

    parts.push(`User: ${input}`);
    return parts.join('\n\n');
  }

  private parseToolCall(text: string, tools: ToolRegistry | undefined, policy: AgentPolicy | undefined):
    { name: string; params: Record<string, unknown> } | null {
    const match = text.match(TOOL_MARKER);
    if (!match) return null;
    const name = match[1]!;
    if (!tools || !tools.list().some((t) => t.name === name)) return null;
    if (policy && !policy.allowTool(name)) return null;
    let params: Record<string, unknown> = {};
    const raw = match[2]?.trim();
    if (raw) {
      try { params = JSON.parse(raw); } catch { params = { input: raw }; }
    }
    return { name, params };
  }

  private async runAgent(config: AgentConfig, input: string, options?: AgentRunOptions): Promise<AgentRunResult> {
    const opts: AgentRunOptions = options ?? {};
    const maxIterations = opts.maxIterations ?? config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const maxToolCalls = opts.maxToolCalls ?? config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    const start = Date.now();

    const steps: AgentStep[] = [];
    let tokensIn = 0;
    let tokensOut = 0;
    let toolCalls = 0;
    let memoryWrites = 0;
    let currentInput = input;
    let output = '';

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const stepStart = Date.now();
      const prompt = await this.buildPrompt(config, currentInput, opts);
      const result = await config.model.invoke(prompt, {});
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;

      const toolCall = this.parseToolCall(result.text, config.tools, config.policy);
      if (!toolCall) {
        output = result.text;
        steps.push({ type: 'finish', content: result.text, durationMs: Date.now() - stepStart });
        break;
      }

      steps.push({ type: 'tool', content: result.text, tool: toolCall.name, durationMs: Date.now() - stepStart });
      const toolStart = Date.now();
      let toolOutcome: unknown;
      try {
        toolOutcome = await config.tools!.invoke(toolCall.name, toolCall.params);
      } catch (err) {
        toolOutcome = { error: (err as Error).message };
      }
      steps.push({ type: 'observe', content: JSON.stringify(toolOutcome), tool: toolCall.name, durationMs: Date.now() - toolStart });

      toolCalls++;
      if (config.memory) {
        await config.memory.write(`last_tool_${toolCall.name}`, toolOutcome);
        memoryWrites++;
      }
      if (toolCalls >= maxToolCalls) {
        output = `Stopped after ${toolCalls} tool calls. Last tool output: ${JSON.stringify(toolOutcome)}`;
        break;
      }
      currentInput = `Tool ${toolCall.name} returned: ${JSON.stringify(toolOutcome)}`;
    }

    if (!output) {
      output = 'Agent finished without a final answer.';
      steps.push({ type: 'finish', content: output, durationMs: 0 });
    }

    return {
      output,
      iterations: steps.filter((s) => s.type === 'tool' || s.type === 'finish').length,
      steps,
      toolCalls,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - start,
      memoryWrites,
    };
  }
}

export function createAgentEngine(): AgentEngine {
  return new AgentEngine();
}