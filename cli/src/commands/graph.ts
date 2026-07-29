/**
 * MAM Graph Command
 *
 * Full dependency graph construction, cycle detection, topological sorting,
 * multiple export formats, impact analysis, orphan detection, and statistics.
 */

import { readFile, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join, relative, basename, dirname, extname } from 'node:path';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export interface GraphOptions {
  dir?: string;
  format?: 'text' | 'json' | 'mermaid' | 'ascii' | 'dot' | 'svg';
  outDir?: string;
  depth?: number;
  watch?: boolean;
  showOrphans?: boolean;
  impact?: string;
  stats?: boolean;
  cycles?: boolean;
  topo?: boolean;
  flatten?: boolean;
  exclude?: string[];
}

interface ModuleNode {
  id: string;
  name: string;
  file: string;
  type: string;
  runtime: string;
  version: string;
  description: string;
  dependencies: string[];
  dependents: string[];
  exports: string[];
  tools: string[];
  handoffs: string[];
  tags: string[];
  size: number;
  lineCount: number;
  complexity: number;
  lastModified: number;
}

interface DependencyGraph {
  nodes: Map<string, ModuleNode>;
  edges: Array<{ from: string; to: string; type: string }>;
}

interface CycleResult {
  hasCycle: boolean;
  cycles: string[][];
  cyclePaths: string[];
}

interface TopoSortResult {
  sorted: string[];
  hasCycle: boolean;
  levels: string[][];
}

interface ImpactResult {
  affected: string[];
  direct: string[];
  indirect: string[];
  depth: number;
}

interface GraphStats {
  totalModules: number;
  totalEdges: number;
  averageDependencies: number;
  maxDependencies: { module: string; count: number };
  orphans: string[];
  roots: string[];
  depth: number;
  density: number;
  stronglyConnectedComponents: string[][];
}

interface FileStats {
  path: string;
  size: number;
  lineCount: number;
  moduleCount: number;
}

interface VersionConflict {
  module: string;
  requiredBy: string[];
  versions: string[];
}

// ============================================================================
// Graph Builder
// ============================================================================

class GraphBuilder {
  private graph: DependencyGraph = {
    nodes: new Map(),
    edges: [],
  };

  async buildFromDirectory(dir: string, excludePatterns: string[] = []): Promise<DependencyGraph> {
    const files = await this.findMAMFiles(dir, excludePatterns);
    const nodesByName = new Map<string, ModuleNode>();

    for (const file of files) {
      const node = await this.parseModuleFile(file);
      if (node) {
        this.graph.nodes.set(node.id, node);
        nodesByName.set(node.name, node);
      }
    }

    // Resolve dependency edges
    for (const [, node] of this.graph.nodes) {
      for (const depName of node.dependencies) {
        const target = nodesByName.get(depName);
        if (target) {
          this.graph.edges.push({ from: node.id, to: target.id, type: 'dependency' });
          node.dependents.push(target.id);
          target.dependencies.push(node.id);
        }
      }

      for (const tool of node.tools) {
        const target = nodesByName.get(tool);
        if (target) {
          this.graph.edges.push({ from: node.id, to: target.id, type: 'tool' });
        }
      }

      for (const handoff of node.handoffs) {
        const target = nodesByName.get(handoff);
        if (target) {
          this.graph.edges.push({ from: node.id, to: target.id, type: 'handoff' });
        }
      }
    }

    return this.graph;
  }

  private async parseModuleFile(filePath: string): Promise<ModuleNode | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const result = parseMAM(content, { source: filePath });

      if (result.errors.length > 0 || !result.ast.frontmatter) {
        return null;
      }

      const fm = result.ast.frontmatter.data;
      const stats = await this.getFileStats(filePath);

      const dependencies: string[] = [];
      const tools: string[] = [];
      const handoffs: string[] = [];

      if (Array.isArray(fm.depends)) dependencies.push(...(fm.depends as string[]));
      if (Array.isArray(fm.tools)) tools.push(...(fm.tools as string[]));
      if (Array.isArray(fm.handoff)) handoffs.push(...(fm.handoff as string[]));

      const name = (fm.name || fm.id || basename(filePath, extname(filePath))) as string;

      return {
        id: name,
        name,
        file: filePath,
        type: (fm.type || 'module') as string,
        runtime: (fm.runtime || 'unknown') as string,
        version: (fm.version || '0.0.0') as string,
        description: (fm.description || '') as string,
        dependencies,
        dependents: [],
        exports: Array.isArray(fm.exports) ? (fm.exports as string[]) : [],
        tools,
        handoffs,
        tags: Array.isArray(fm.tags) ? (fm.tags as string[]) : [],
        size: stats.size,
        lineCount: stats.lineCount,
        complexity: this.estimateComplexity(content),
        lastModified: stats.lastModified,
      };
    } catch {
      return null;
    }
  }

  private async getFileStats(filePath: string): Promise<{ size: number; lineCount: number; lastModified: number }> {
    try {
      const { statSync } = await import('node:fs');
      const stat = statSync(filePath);
      const content = await readFile(filePath, 'utf-8');
      return {
        size: stat.size,
        lineCount: content.split('\n').length,
        lastModified: stat.mtimeMs,
      };
    } catch {
      return { size: 0, lineCount: 0, lastModified: 0 };
    }
  }

  private estimateComplexity(content: string): number {
    let complexity = 1;
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(if|else|elif|for|while|switch|case|catch|try|except)\b/.test(trimmed)) complexity++;
      if (/\?\s*|:\s*/.test(trimmed)) complexity += 0.5;
    }
    return Math.round(complexity);
  }

  private async findMAMFiles(dir: string, excludePatterns: string[]): Promise<string[]> {
    const files: string[] = [];
    const scanDir = async (currentDir: string): Promise<void> => {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (excludePatterns.some(p => entry.name.includes(p))) continue;
            if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            if (entry.name.endsWith('.mam.md') || entry.name.endsWith('.mam')) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };
    await scanDir(dir);
    return files;
  }

  getGraph(): DependencyGraph {
    return this.graph;
  }
}

// ============================================================================
// Cycle Detection
// ============================================================================

class CycleDetector {
  static detect(graph: DependencyGraph): CycleResult {
    const cycles: string[][] = [];
    const cyclePaths: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            if (dfs(dep)) return true;
          } else if (recursionStack.has(dep)) {
            const cycleStart = path.indexOf(dep);
            if (cycleStart !== -1) {
              const cycle = path.slice(cycleStart);
              cycle.push(dep);
              cycles.push(cycle);
              cyclePaths.push(cycle.join(' → '));
            }
            return true;
          }
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return {
      hasCycle: cycles.length > 0,
      cycles,
      cyclePaths,
    };
  }
}

// ============================================================================
// Topological Sort
// ============================================================================

class TopologicalSorter {
  static sort(graph: DependencyGraph): TopoSortResult {
    const inDegree = new Map<string, number>();
    const levels: string[][] = [];

    // Calculate in-degrees
    for (const [id] of graph.nodes) {
      inDegree.set(id, 0);
    }
    for (const edge of graph.edges) {
      if (edge.type === 'dependency') {
        inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      }
    }

    // BFS level-by-level
    let currentLevel = [...graph.nodes.keys()].filter(id => (inDegree.get(id) || 0) === 0);
    const sorted: string[] = [];
    const visited = new Set<string>();

    while (currentLevel.length > 0) {
      levels.push([...currentLevel]);
      for (const id of currentLevel) {
        sorted.push(id);
        visited.add(id);
      }

      const nextLevel: string[] = [];
      for (const id of currentLevel) {
        const node = graph.nodes.get(id);
        if (node) {
          for (const dep of node.dependencies) {
            const newDegree = (inDegree.get(dep) || 1) - 1;
            inDegree.set(dep, newDegree);
            if (newDegree === 0 && !visited.has(dep)) {
              nextLevel.push(dep);
            }
          }
        }
      }
      currentLevel = nextLevel;
    }

    return {
      sorted,
      hasCycle: sorted.length !== graph.nodes.size,
      levels,
    };
  }
}

// ============================================================================
// Impact Analyzer
// ============================================================================

class ImpactAnalyzer {
  static analyze(graph: DependencyGraph, moduleId: string, maxDepth: number = Infinity): ImpactResult {
    const direct: string[] = [];
    const indirect: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    // Find reverse dependencies (what depends on this module)
    for (const [, node] of graph.nodes) {
      if (node.dependencies.includes(moduleId)) {
        direct.push(node.id);
        queue.push({ id: node.id, depth: 1 });
        visited.add(node.id);
      }
    }

    // BFS to find indirect dependents
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDepth) continue;

      const node = graph.nodes.get(id);
      if (node) {
        for (const dependent of node.dependencies) {
          if (!visited.has(dependent)) {
            visited.add(dependent);
            indirect.push(dependent);
            queue.push({ id: dependent, depth: depth + 1 });
          }
        }
      }
    }

    return {
      affected: [...direct, ...indirect],
      direct,
      indirect,
      depth: indirect.length > 0 ? Math.max(...indirect.map((_, i) => i + 1)) : (direct.length > 0 ? 1 : 0),
    };
  }
}

// ============================================================================
// Strongly Connected Components
// ============================================================================

class SCCFinder {
  static find(graph: DependencyGraph): string[][] {
    let index = 0;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const components: string[][] = [];

    const strongconnect = (nodeId: string): void => {
      indices.set(nodeId, index);
      lowlinks.set(nodeId, index);
      index++;
      stack.push(nodeId);
      onStack.add(nodeId);

      const node = graph.nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          if (!indices.has(dep)) {
            strongconnect(dep);
            lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId) || Infinity, lowlinks.get(dep) || Infinity));
          } else if (onStack.has(dep)) {
            lowlinks.set(nodeId, Math.min(lowlinks.get(nodeId) || Infinity, indices.get(dep) || Infinity));
          }
        }
      }

      if (lowlinks.get(nodeId) === indices.get(nodeId)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== nodeId);
        components.push(component);
      }
    };

    for (const nodeId of graph.nodes.keys()) {
      if (!indices.has(nodeId)) {
        strongconnect(nodeId);
      }
    }

    return components;
  }
}

// ============================================================================
// Graph Statistics
// ============================================================================

class GraphAnalyzer {
  static analyze(graph: DependencyGraph): GraphStats {
    const totalModules = graph.nodes.size;
    const totalEdges = graph.edges.length;
    const orphans: string[] = [];
    const roots: string[] = [];

    let maxDeps = { module: '', count: 0 };
    let totalDeps = 0;

    for (const [id, node] of graph.nodes) {
      const depCount = node.dependencies.length;
      totalDeps += depCount;

      if (depCount > maxDeps.count) {
        maxDeps = { module: id, count: depCount };
      }

      if (depCount === 0 && node.dependents.length === 0) {
        orphans.push(id);
      }

      if (depCount === 0) {
        roots.push(id);
      }
    }

    const maxDepth = this.calculateDepth(graph);
    const density = totalModules > 1 ? totalEdges / (totalModules * (totalModules - 1)) : 0;
    const sccs = SCCFinder.find(graph).filter(c => c.length > 1);

    return {
      totalModules,
      totalEdges,
      averageDependencies: totalModules > 0 ? totalDeps / totalModules : 0,
      maxDependencies: maxDeps,
      orphans,
      roots,
      depth: maxDepth,
      density,
      stronglyConnectedComponents: sccs,
    };
  }

  private static calculateDepth(graph: DependencyGraph): number {
    const depths = new Map<string, number>();
    const visited = new Set<string>();

    const dfs = (nodeId: string, currentDepth: number): number => {
      if (visited.has(nodeId)) return depths.get(nodeId) || 0;
      visited.add(nodeId);

      let maxChildDepth = currentDepth;
      const node = graph.nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          const childDepth = dfs(dep, currentDepth + 1);
          maxChildDepth = Math.max(maxChildDepth, childDepth);
        }
      }

      depths.set(nodeId, maxChildDepth);
      return maxChildDepth;
    };

    let maxDepth = 0;
    for (const nodeId of graph.nodes.keys()) {
      if (!visited.has(nodeId)) {
        maxDepth = Math.max(maxDepth, dfs(nodeId, 0));
      }
    }

    return maxDepth;
  }
}

// ============================================================================
// Version Conflict Detector
// ============================================================================

class VersionConflictDetector {
  static detect(graph: DependencyGraph): VersionConflict[] {
    const conflicts: VersionConflict[] = [];
    const versionMap = new Map<string, Map<string, string[]>>();

    for (const [, node] of graph.nodes) {
      // Check if node versions of its dependencies conflict
      for (const dep of node.dependencies) {
        const depNode = graph.nodes.get(dep);
        if (depNode) {
          if (!versionMap.has(dep)) versionMap.set(dep, new Map());
          const versions = versionMap.get(dep)!;
          if (!versions.has(depNode.version)) {
            versions.set(depNode.version, []);
          }
          versions.get(depNode.version)!.push(node.id);
        }
      }
    }

    for (const [module, versions] of versionMap) {
      if (versions.size > 1) {
        conflicts.push({
          module,
          requiredBy: [...versions.values()].flat(),
          versions: [...versions.keys()],
        });
      }
    }

    return conflicts;
  }
}

// ============================================================================
// Formatters
// ============================================================================

class TextFormatter {
  static format(graph: DependencyGraph, options: { depth?: number } = {}): string {
    const lines: string[] = [];
    lines.push(chalk.cyan('\n  Dependency Graph\n'));

    const nodes = [...graph.nodes.values()];
    const maxDepth = options.depth || Infinity;

    for (const node of nodes) {
      lines.push(chalk.green(`  ${node.name}`));
      lines.push(chalk.gray(`    Type: ${node.type} | Runtime: ${node.runtime}`));
      lines.push(chalk.gray(`    File: ${node.file}`));

      if (node.dependencies.length > 0) {
        lines.push(chalk.yellow(`    Depends on: ${node.dependencies.join(', ')}`));
      }
      if (node.tools.length > 0) {
        lines.push(chalk.blue(`    Uses tools: ${node.tools.join(', ')}`));
      }
      if (node.handoffs.length > 0) {
        lines.push(chalk.magenta(`    Hands off to: ${node.handoffs.join(', ')}`));
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

class JSONFormatter {
  static format(graph: DependencyGraph): string {
    const nodes = [...graph.nodes.values()].map(n => ({
      id: n.id,
      name: n.name,
      file: n.file,
      type: n.type,
      runtime: n.runtime,
      version: n.version,
      description: n.description,
      dependencies: n.dependencies,
      dependents: n.dependents,
      exports: n.exports,
      tools: n.tools,
      handoffs: n.handoffs,
      tags: n.tags,
      stats: { size: n.size, lineCount: n.lineCount, complexity: n.complexity },
    }));

    return JSON.stringify({ nodes, edges: graph.edges }, null, 2);
  }
}

class MermaidFormatter {
  static format(graph: DependencyGraph): string {
    const lines: string[] = ['graph TD'];

    for (const [id, node] of graph.nodes) {
      const safeId = id.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`    ${safeId}["${node.name} (${node.type})"]`);
    }

    for (const edge of graph.edges) {
      const from = edge.from.replace(/[^a-zA-Z0-9]/g, '_');
      const to = edge.to.replace(/[^a-zA-Z0-9]/g, '_');
      const style = edge.type === 'handoff' ? '-.->' : edge.type === 'tool' ? '==>': '-->';
      const label = edge.type !== 'dependency' ? `|${edge.type}|` : '';
      lines.push(`    ${from} ${style} ${label} ${to}`);
    }

    return lines.join('\n');
  }
}

class ASCIIFormatter {
  static format(graph: DependencyGraph): string {
    const lines: string[] = [];
    const nodes = [...graph.nodes.values()];

    if (nodes.length === 0) return '  (empty graph)';

    // Simple ASCII tree representation
    const visited = new Set<string>();

    const drawNode = (nodeId: string, prefix: string, isLast: boolean): void => {
      if (visited.has(nodeId)) {
        const connector = isLast ? '└── ' : '├── ';
        lines.push(`${prefix}${connector}${nodeId} (circular)`);
        return;
      }

      visited.add(nodeId);
      const node = graph.nodes.get(nodeId);
      if (!node) return;

      const connector = isLast ? '└── ' : '├── ';
      const typeIcon = node.type === 'agent' ? '🤖' : node.type === 'tool' ? '🔧' : '📦';
      lines.push(`${prefix}${connector}${typeIcon} ${node.name}`);

      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      const children = [...node.dependencies, ...node.tools, ...node.handoffs];
      const uniqueChildren = [...new Set(children)];

      uniqueChildren.forEach((child, i) => {
        drawNode(child, newPrefix, i === uniqueChildren.length - 1);
      });
    };

    // Find root nodes (no dependencies)
    const roots = nodes.filter(n => n.dependencies.length === 0 && n.tools.length === 0 && n.handoffs.length === 0);
    const nonRoots = nodes.filter(n => n.dependencies.length > 0 || n.tools.length > 0 || n.handoffs.length > 0);

    if (roots.length > 0) {
      lines.push(chalk.cyan('\n  Root Modules:'));
      roots.forEach((root, i) => drawNode(root.id, '  ', i === roots.length - 1));
    }

    if (nonRoots.length > 0) {
      lines.push(chalk.cyan('\n  Dependent Modules:'));
      nonRoots.forEach((node, i) => drawNode(node.id, '  ', i === nonRoots.length - 1));
    }

    return lines.join('\n');
  }
}

class DotFormatter {
  static format(graph: DependencyGraph): string {
    const lines: string[] = ['digraph MAM {', '  rankdir=LR;', '  node [shape=box];'];

    for (const [id, node] of graph.nodes) {
      const safeId = `"${id.replace(/"/g, '\\"')}"`;
      const label = `${node.name}\\n(${node.type})`;
      const color = node.type === 'agent' ? 'lightblue' : node.type === 'tool' ? 'lightgreen' : 'lightyellow';
      lines.push(`  ${safeId} [label="${label}" fillcolor=${color} style=filled];`);
    }

    for (const edge of graph.edges) {
      const from = `"${edge.from.replace(/"/g, '\\"')}"`;
      const to = `"${edge.to.replace(/"/g, '\\"')}"`;
      const style = edge.type === 'handoff' ? ' [style=dashed]' : edge.type === 'tool' ? ' [style=bold]' : '';
      lines.push(`  ${from} -> ${to}${style};`);
    }

    lines.push('}');
    return lines.join('\n');
  }
}

// ============================================================================
// Watcher
// ============================================================================

class GraphWatcher {
  private watcher: any = null;
  private builder: GraphBuilder;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private options: GraphOptions;

  constructor(builder: GraphBuilder, options: GraphOptions) {
    this.builder = builder;
    this.options = options;
  }

  async start(dir: string): Promise<void> {
    const { watch } = await import('node:fs');
    this.watcher = watch(dir, { recursive: true }, async (_event, filename) => {
      if (!filename || !filename.endsWith('.mam.md')) return;
      if (['node_modules', 'dist', '.git'].some(i => filename.includes(i))) return;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(async () => {
        console.clear();
        console.log(chalk.cyan(`\n  Graph updated: ${filename}\n`));
        const graph = await this.builder.buildFromDirectory(dir, this.options.exclude);
        const output = this.formatGraph(graph, this.options);
        console.log(output);
      }, 500);
    });

    console.log(chalk.gray(`  Watching for graph changes in ${dir}...`));
    await new Promise(() => {});
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private formatGraph(graph: DependencyGraph, opts: GraphOptions): string {
    switch (opts.format) {
      case 'json': return JSONFormatter.format(graph);
      case 'mermaid': return MermaidFormatter.format(graph);
      case 'ascii': return ASCIIFormatter.format(graph);
      case 'dot': return DotFormatter.format(graph);
      case 'svg': return this.generateSVG(graph);
      default: return TextFormatter.format(graph, { depth: opts.depth });
    }
  }

  private generateSVG(graph: DependencyGraph): string {
    const dot = DotFormatter.format(graph);
    return `<!-- Graphviz DOT format -->\n<!-- Run: dot -Tsvg graph.dot > graph.svg -->\n${dot}`;
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function graphCommand(options: GraphOptions): Promise<void> {
  const spinner = ora('Building dependency graph...').start();

  try {
    const dir = resolve(options.dir || process.cwd());
    const excludePatterns = options.exclude || [];

    const builder = new GraphBuilder();
    spinner.text = 'Scanning modules...';
    const graph = await builder.buildFromDirectory(dir, excludePatterns);

    if (graph.nodes.size === 0) {
      spinner.warn('No MAM modules found');
      return;
    }

    spinner.text = 'Analyzing graph...';
    const stats = GraphAnalyzer.analyze(graph);
    const cycleResult = CycleDetector.detect(graph);
    const topoResult = TopologicalSorter.sort(graph);
    const conflicts = VersionConflictDetector.detect(graph);

    spinner.stop();

    // Impact analysis
    if (options.impact) {
      const impact = ImpactAnalyzer.analyze(graph, options.impact);
      console.log(chalk.cyan(`\n  Impact Analysis for "${options.impact}":\n`));
      console.log(chalk.gray(`  Direct dependents: ${impact.direct.length}`));
      console.log(chalk.gray(`  Indirect dependents: ${impact.indirect.length}`));
      console.log(chalk.gray(`  Max depth: ${impact.depth}`));

      if (impact.direct.length > 0) {
        console.log(chalk.yellow('\n  Direct:'));
        for (const id of impact.direct) console.log(chalk.gray(`    - ${id}`));
      }
      if (impact.indirect.length > 0) {
        console.log(chalk.blue('\n  Indirect:'));
        for (const id of impact.indirect) console.log(chalk.gray(`    - ${id}`));
      }
      return;
    }

    // Cycle report
    if (options.cycles || cycleResult.hasCycle) {
      if (cycleResult.hasCycle) {
        console.log(chalk.red('\n  Circular Dependencies Detected:\n'));
        for (const path of cycleResult.cyclePaths) {
          console.log(chalk.red(`    ${path}`));
        }
      } else {
        console.log(chalk.green('\n  No circular dependencies found'));
      }
    }

    // Topological sort
    if (options.topo) {
      console.log(chalk.cyan('\n  Topological Order:\n'));
      for (let i = 0; i < topoResult.levels.length; i++) {
        console.log(chalk.gray(`  Level ${i}: ${topoResult.levels[i].join(', ')}`));
      }
    }

    // Main graph output
    let output: string;
    switch (options.format) {
      case 'json':
        output = JSONFormatter.format(graph);
        break;
      case 'mermaid':
        output = MermaidFormatter.format(graph);
        break;
      case 'ascii':
        output = ASCIIFormatter.format(graph);
        break;
      case 'dot':
        output = DotFormatter.format(graph);
        break;
      case 'svg':
        const dot = DotFormatter.format(graph);
        output = `<!-- Graphviz DOT format -->\n<!-- Run: dot -Tsvg graph.dot > graph.svg -->\n${dot}`;
        break;
      default:
        output = TextFormatter.format(graph, { depth: options.depth });
    }

    console.log(output);

    // Orphan detection
    if (options.showOrphans && stats.orphans.length > 0) {
      console.log(chalk.yellow('\n  Orphan Modules (no connections):'));
      for (const id of stats.orphans) console.log(chalk.gray(`    - ${id}`));
    }

    // Stats
    if (options.stats) {
      console.log(chalk.cyan('\n  Graph Statistics:\n'));
      console.log(chalk.gray(`    Modules: ${stats.totalModules}`));
      console.log(chalk.gray(`    Edges: ${stats.totalEdges}`));
      console.log(chalk.gray(`    Avg dependencies: ${stats.averageDependencies.toFixed(1)}`));
      console.log(chalk.gray(`    Max dependencies: ${stats.maxDependencies.module} (${stats.maxDependencies.count})`));
      console.log(chalk.gray(`    Root modules: ${stats.roots.length}`));
      console.log(chalk.gray(`    Orphans: ${stats.orphans.length}`));
      console.log(chalk.gray(`    Depth: ${stats.depth}`));
      console.log(chalk.gray(`    Density: ${(stats.density * 100).toFixed(1)}%`));

      if (stats.stronglyConnectedComponents.length > 0) {
        console.log(chalk.red(`\n    Strongly connected components: ${stats.stronglyConnectedComponents.length}`));
        for (const scc of stats.stronglyConnectedComponents) {
          console.log(chalk.red(`      [${scc.join(', ')}]`));
        }
      }
    }

    // Version conflicts
    if (conflicts.length > 0) {
      console.log(chalk.yellow('\n  Version Conflicts:'));
      for (const c of conflicts) {
        console.log(chalk.yellow(`    ${c.module}: ${c.versions.join(' vs ')} (required by ${c.requiredBy.join(', ')})`));
      }
    }

    // Summary
    console.log(chalk.gray(`\n  ${stats.totalModules} module(s), ${stats.totalEdges} edge(s)`));

    // Export to file
    if (options.outDir) {
      await mkdir(options.outDir, { recursive: true });
      const ext = options.format === 'json' ? '.json' : options.format === 'mermaid' ? '.mmd' : options.format === 'dot' ? '.dot' : '.txt';
      const outFile = join(options.outDir, `graph${ext}`);
      await writeFile(outFile, output, 'utf-8');
      console.log(chalk.gray(`\n  Graph exported to: ${outFile}`));
    }

    // Watch mode
    if (options.watch) {
      const watcher = new GraphWatcher(builder, options);
      await watcher.start(dir);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  GraphBuilder,
  CycleDetector,
  TopologicalSorter,
  ImpactAnalyzer,
  SCCFinder,
  GraphAnalyzer,
  VersionConflictDetector,
  TextFormatter,
  JSONFormatter,
  MermaidFormatter,
  ASCIIFormatter,
  DotFormatter,
  GraphWatcher,
};
