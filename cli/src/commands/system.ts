/**
 * MAM System Command
 *
 * Shows the standalone MAM engine packages wired directly into the CLI.
 * Every engine below is instantiated directly from its package (NOT through
 * the runtime facade) and reported as `name -> engine present (module)`.
 *
 * Beyond the plain listing the command can also:
 *
 *   - group engines by owning module, so the nine packages read as groups
 *   - probe each engine for a minimal health signal (`stats()`, `size`, ...)
 *     so a broken wiring shows up as `degraded` rather than a bare "present"
 *   - emit the whole inventory as JSON (`--json`) for tooling
 *   - filter to a single module (`--module @mam/security`)
 *
 * @module system
 */
import { createTracer, createMetricsRegistry, createEvaluator, createCostTracker } from '@mam/observability';
import { createContextAssembler, createTokenBudgeter, createPrioritizer } from '@mam/context-engine';
import { createWorkingMemory } from '@mam/memory-engine';
import { createSourceAdapter } from '@mam/knowledge-engine';
import {
  createAuthenticator,
  createAuthorizer,
  createAuditLogger,
  createSecurityPolicyEngine,
} from '@mam/security';
import { createToolDiscovery, createToolInvoker, createToolValidator } from '@mam/tool-engine';
import { createMcpServer } from '@mam/mcp';
import { createCacheManager, PromptOptimizer } from '@mam/token-optimization';
import {
  QueryAnalyzer,
  GroundednessScorer,
  AnswerSynthesizer,
  GraphEngine,
  Consolidator,
} from '@mam/intelligence-layer';
import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

/** A tuple describing one wired engine. */
export type EngineRow = [name: string, module: string, engine: unknown];

/** Health of a single wired engine. */
export type EngineHealth = 'present' | 'degraded' | 'missing';

/** Options accepted by {@link systemCommand}. */
export interface SystemOptions {
  /** Emit the inventory as JSON. */
  json?: boolean;
  /** Run health probes against each engine. */
  probe?: boolean;
  /** Only report engines owned by this module specifier. */
  module?: string;
  /** Group the output by owning module. */
  group?: boolean;
}

/** One reported engine. */
export interface SystemReportEntry {
  /** Canonical engine name. */
  name: string;
  /** Owning package specifier. */
  module: string;
  /** Observed health. */
  health: EngineHealth;
  /** Optional probe detail (e.g. a stats summary). */
  detail?: string;
}

// ============================================================================
// Engine inventory
// ============================================================================

/**
 * Instantiate every engine wired directly into the CLI.
 *
 * Engines are constructed eagerly so the report reflects real construction
 * behaviour — a factory that throws surfaces immediately rather than being
 * masked by a try/catch.
 *
 * @returns one row per engine: `[name, module, engine]`.
 */
export function collectEngines(): EngineRow[] {
  return [
    ['workingMemory', '@mam/memory-engine', createWorkingMemory(60_000)],
    ['knowledgeSource', '@mam/knowledge-engine', createSourceAdapter()],
    ['tracer', '@mam/observability', createTracer()],
    ['metrics', '@mam/observability', createMetricsRegistry()],
    ['evaluator', '@mam/observability', createEvaluator()],
    ['costTracker', '@mam/observability', createCostTracker()],
    ['contextAssembler', '@mam/context-engine', createContextAssembler()],
    ['tokenBudgeter', '@mam/context-engine', createTokenBudgeter(undefined, { lifecycle: false })],
    ['prioritizer', '@mam/context-engine', createPrioritizer()],
    ['authenticator', '@mam/security', createAuthenticator()],
    ['authorizer', '@mam/security', createAuthorizer()],
    ['auditLogger', '@mam/security', createAuditLogger()],
    ['policy', '@mam/security', createSecurityPolicyEngine()],
    ['toolDiscovery', '@mam/tool-engine', createToolDiscovery()],
    ['toolInvoker', '@mam/tool-engine', createToolInvoker()],
    ['toolValidator', '@mam/tool-engine', createToolValidator()],
    ['mcpServer', '@mam/mcp', createMcpServer()],
    ['cacheManager', '@mam/token-optimization', createCacheManager()],
    ['promptOptimizer', '@mam/token-optimization', new PromptOptimizer()],
    ['queryAnalyzer', '@mam/intelligence-layer', new QueryAnalyzer()],
    ['groundednessScorer', '@mam/intelligence-layer', new GroundednessScorer()],
    ['answerSynthesizer', '@mam/intelligence-layer', new AnswerSynthesizer()],
    ['graphEngine', '@mam/intelligence-layer', new GraphEngine()],
    ['consolidator', '@mam/intelligence-layer', new Consolidator()],
  ];
}

/**
 * The distinct module specifiers, in first-seen order.
 *
 * @param rows - engine rows to derive modules from.
 * @returns the ordered module list.
 */
export function collectModules(rows: EngineRow[]): string[] {
  const seen: string[] = [];
  for (const [, mod] of rows) {
    if (!seen.includes(mod)) seen.push(mod);
  }
  return seen;
}

/**
 * Filter rows down to those owned by one module.
 *
 * @param rows - engine rows.
 * @param module - module specifier or bare name (e.g. `security`).
 * @returns the matching rows.
 */
export function filterByModule(rows: EngineRow[], module: string): EngineRow[] {
  const needle = module.trim().replace(/^@mam\//, '').toLowerCase();
  return rows.filter(([, mod]) => mod.replace(/^@mam\//, '').toLowerCase() === needle);
}

// ============================================================================
// Health probing
// ============================================================================

/**
 * Probe an engine for a minimal health signal.
 *
 * Tries, in order: `stats()`, `size`, `list()`, then plain truthiness. Any
 * thrown error marks the engine as degraded rather than failing the command.
 *
 * @param engine - the engine instance to probe.
 * @returns `{ health, detail }`.
 */
export function probeEngine(engine: unknown): { health: EngineHealth; detail?: string } {
  if (engine === null || engine === undefined) return { health: 'missing' };
  const candidate = engine as Record<string, unknown>;
  try {
    if (typeof candidate.stats === 'function') {
      const stats = (candidate.stats as () => unknown)();
      if (stats && typeof stats === 'object') {
        const keys = Object.keys(stats as Record<string, unknown>);
        return { health: 'present', detail: `${keys.length} stat field${keys.length === 1 ? '' : 's'}` };
      }
      return { health: 'present', detail: 'stats() ok' };
    }
    if (typeof candidate.size === 'number') {
      return { health: 'present', detail: `size=${candidate.size}` };
    }
    if (typeof candidate.list === 'function') {
      const list = (candidate.list as () => unknown[])();
      return { health: 'present', detail: `list=${Array.isArray(list) ? list.length : '?'}` };
    }
    return { health: 'present' };
  } catch (error) {
    return { health: 'degraded', detail: (error as Error).message };
  }
}

/**
 * Build the full report from engine rows.
 *
 * @param rows - engine rows.
 * @param options - report options.
 * @returns the report entries.
 */
export function buildReport(rows: EngineRow[], options: SystemOptions = {}): SystemReportEntry[] {
  const scoped = options.module ? filterByModule(rows, options.module) : rows;
  return scoped.map(([name, mod, engine]) => {
    const { health, detail } = options.probe === false
      ? { health: (engine != null ? 'present' : 'missing') as EngineHealth, detail: undefined }
      : probeEngine(engine);
    return { name, module: mod, health, detail };
  });
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Colourise a health value.
 *
 * @param health - the health to render.
 * @returns the colourised label.
 */
export function healthLabel(health: EngineHealth): string {
  if (health === 'present') return chalk.green('present');
  if (health === 'degraded') return chalk.yellow('degraded');
  return chalk.red('missing');
}

/**
 * Render the flat (ungrouped) table.
 *
 * @param entries - report entries.
 * @param showDetail - include probe detail.
 * @returns the rendered lines.
 */
export function renderTable(entries: SystemReportEntry[], showDetail: boolean): string[] {
  const width = entries.reduce((max, e) => Math.max(max, e.name.length), 0) + 2;
  return entries.map((e) => {
    const detail = showDetail && e.detail ? chalk.gray(`  ${e.detail}`) : '';
    return `  ${chalk.cyan(e.name.padEnd(width))} ${healthLabel(e.health)}  ${chalk.gray(`(${e.module})`)}${detail}`;
  });
}

/**
 * Render the table grouped by owning module.
 *
 * @param entries - report entries.
 * @param showDetail - include probe detail.
 * @returns the rendered lines.
 */
export function renderGrouped(entries: SystemReportEntry[], showDetail: boolean): string[] {
  const lines: string[] = [];
  for (const mod of collectModules(entries.map((e) => [e.name, e.module, null]))) {
    lines.push(chalk.cyan.bold(`  ${mod}`));
    lines.push(...renderTable(entries.filter((e) => e.module === mod), showDetail));
    lines.push('');
  }
  return lines;
}

/**
 * Summarise the health of a report.
 *
 * @param entries - report entries.
 * @returns counts per health value plus the total.
 */
export function summarize(entries: SystemReportEntry[]): {
  total: number;
  present: number;
  degraded: number;
  missing: number;
} {
  return {
    total: entries.length,
    present: entries.filter((e) => e.health === 'present').length,
    degraded: entries.filter((e) => e.health === 'degraded').length,
    missing: entries.filter((e) => e.health === 'missing').length,
  };
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * `mam system` entry point: report every engine wired into the CLI.
 *
 * @param options - report options.
 * @returns the report entries.
 */
export async function systemCommand(options: SystemOptions = {}): Promise<SystemReportEntry[]> {
  const rows = collectEngines();
  const entries = buildReport(rows, options);

  if (options.json) {
    console.log(JSON.stringify({ engines: entries, summary: summarize(entries) }, null, 2));
    return entries;
  }

  console.log(chalk.cyan('\n  Wired MAM Engines\n'));
  if (options.group) {
    console.log(renderGrouped(entries, options.probe === true).join('\n'));
  } else {
    console.log(renderTable(entries, options.probe === true).join('\n'));
  }

  const s = summarize(entries);
  console.log(
    chalk.gray(
      `\n  ${s.total} engines wired directly across ${collectModules(rows).length} modules (no runtime facade)`,
    ),
  );
  if (s.degraded > 0 || s.missing > 0) {
    console.log(chalk.yellow(`  ${s.degraded} degraded, ${s.missing} missing`));
  }
  console.log('');
  return entries;
}