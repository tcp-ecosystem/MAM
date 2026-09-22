/**
 * MAM Transformer
 *
 * Converts parser output (MAMModule) to compiler input (V2ModuleNode[]).
 * This is the critical bridge between parsing and compilation.
 *
 * Pipeline: .mam.md → Parser → MAMModule → [THIS] → V2ModuleNode[] → Compiler → Target
 */

import {
  type V2ModuleNode,
  type V2StepNode,
  type V2EdgeNode,
  type V2PortDefinition,
  type V2PermissionSet,
  type V2MemoryReference,
  type ModuleType,
} from '@mam/ast';

// ============================================================================
// Parser Types (local declarations to avoid circular deps)
// ============================================================================

interface ParserModule {
  type: string;
  frontmatter: {
    type: string;
    data: Record<string, unknown>;
    location: unknown;
  } | null;
  sections: ParserSection[];
  location: unknown;
  metadata: unknown;
}

interface ParserSection {
  type: string;
  name: string;
  level: number;
  content: ContentNode[];
  location: unknown;
  attributes: unknown;
}

type ContentNode =
  | { type: 'paragraph'; value: string; inlineNodes?: unknown[]; location: unknown }
  | { type: 'list'; ordered: boolean; items: ListItem[]; location: unknown }
  | { type: 'codeblock'; language: string; value: string; metadata: Record<string, string>; location: unknown }
  | { type: 'table'; headers: string[]; rows: string[][]; alignments: string[]; location: unknown }
  | { type: 'mermaid'; value: string; location: unknown }
  | { type: 'heading'; level: number; value: string; location: unknown }
  | { type: 'blockquote'; value: string; children: ContentNode[]; location: unknown }
  | { type: 'horizontalrule'; value: string; location: unknown };

interface ListItem {
  content: ContentNode[];
  checked?: boolean;
}

// ============================================================================
// Transformer
// ============================================================================

export class MAMTransformer {
  /**
   * Transform a parsed MAMModule into V2ModuleNode[] for the compiler.
   */
  transform(ast: ParserModule): V2ModuleNode[] {
    if (!ast.frontmatter) {
      return [this.createGenericModule(ast)];
    }

    const data = ast.frontmatter.data;
    const moduleType = this.inferModuleType(data, ast.sections);

    return [this.createModule(ast, data, moduleType)];
  }

  // -------------------------------------------------------------------------
  // Module Type Inference
  // -------------------------------------------------------------------------

  private inferModuleType(
    data: Record<string, unknown>,
    sections: ParserSection[],
  ): ModuleType {
    // 1. Check explicit type in frontmatter
    if (data.type && this.isValidModuleType(data.type as string)) {
      return data.type as ModuleType;
    }

    // 2. Check tags for type hints
    if (Array.isArray(data.tags)) {
      const tags = data.tags.map((t: unknown) => String(t).toLowerCase());
      if (tags.includes('agent')) return 'agent';
      if (tags.includes('tool')) return 'tool';
      if (tags.includes('memory')) return 'memory';
      if (tags.includes('workflow')) return 'workflow';
      if (tags.includes('team')) return 'team';
      if (tags.includes('policy')) return 'policy';
      if (tags.includes('system')) return 'system';
    }

    // 3. Infer from section content
    const sectionNames = new Set(sections.map(s => s.name.toLowerCase()));

    if (sectionNames.has('role') && sectionNames.has('goal')) return 'agent';
    if (sectionNames.has('provider') || sectionNames.has('capabilities')) return 'tool';
    if (sectionNames.has('backend') && sectionNames.has('format')) return 'memory';
    if (sectionNames.has('steps') || sectionNames.has('workflow')) return 'workflow';
    if (sectionNames.has('members')) return 'team';
    if (sectionNames.has('allow') && sectionNames.has('deny')) return 'policy';
    if (sectionNames.has('agents') && sectionNames.has('modules')) return 'system';

    // 4. Check frontmatter fields
    if (data.role || data.goal) return 'agent';
    if (data.provider) return 'tool';
    if (data.backend) return 'memory';
    if (data.members) return 'team';

    return 'module';
  }

  private isValidModuleType(type: string): boolean {
    const valid: ModuleType[] = [
      'module', 'agent', 'tool', 'memory', 'workflow', 'team',
      'policy', 'system', 'service', 'component', 'resource',
      'interface', 'contract', 'plugin', 'extension', 'runtime',
      'package', 'repository', 'documentation',
    ];
    return valid.includes(type as ModuleType);
  }

  // -------------------------------------------------------------------------
  // Base Location
  // -------------------------------------------------------------------------

  private loc(ast: ParserModule) {
    const l = ast.location as { start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number }; source: string };
    return l || { start: { line: 1, column: 0, offset: 0 }, end: { line: 1, column: 0, offset: 0 }, source: 'unknown' };
  }

  // -------------------------------------------------------------------------
  // Section Extractors
  // -------------------------------------------------------------------------

  private findSection(sections: ParserSection[], name: string): ParserSection | undefined {
    return sections.find(s => s.name.toLowerCase() === name.toLowerCase());
  }

  private extractText(content: ContentNode[]): string {
    return content
      .map(node => {
        if (node.type === 'paragraph') return node.value;
        if (node.type === 'heading') return node.value;
        if (node.type === 'blockquote') return node.value;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private extractList(content: ContentNode[]): string[] {
    const items: string[] = [];
    for (const node of content) {
      if (node.type === 'list') {
        for (const item of node.items) {
          const text = this.extractText(item.content);
          if (text) items.push(text);
        }
      }
    }
    return items;
  }

  private extractTable(content: ContentNode[]): { headers: string[]; rows: string[][] } {
    for (const node of content) {
      if (node.type === 'table') {
        return { headers: node.headers, rows: node.rows };
      }
    }
    return { headers: [], rows: [] };
  }

  private extractMermaid(content: ContentNode[]): string | null {
    for (const node of content) {
      if (node.type === 'mermaid') return node.value;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Main Module Creator
  // -------------------------------------------------------------------------

  private createModule(
    ast: ParserModule,
    data: Record<string, unknown>,
    moduleType: ModuleType,
  ): V2ModuleNode {
    const sections = ast.sections;
    const purposeSection = this.findSection(sections, 'Purpose');
    const description = String(data.description || (purposeSection ? this.extractText(purposeSection.content) : ''));

    const base: V2ModuleNode = {
      type: 'ModuleNode',
      moduleType,
      name: String(data.name || 'unnamed-module'),
      description,
      location: this.loc(ast),
      metadata: {
        tags: data.tags,
        version: data.version,
        author: data.author,
        runtime: data.runtime,
        license: data.license,
      },
    };

    // Add type-specific fields
    switch (moduleType) {
      case 'agent':
        return this.addAgentFields(base, ast, data);
      case 'tool':
        return this.addToolFields(base, ast, data);
      case 'memory':
        return this.addMemoryFields(base, ast, data);
      case 'workflow':
        return this.addWorkflowFields(base, ast, data);
      case 'team':
        return this.addTeamFields(base, ast, data);
      case 'policy':
        return this.addPolicyFields(base, ast, data);
      case 'system':
        return this.addSystemFields(base, ast, data);
      default:
        return this.addGenericFields(base, ast, data);
    }
  }

  // -------------------------------------------------------------------------
  // Type-Specific Field Adders
  // -------------------------------------------------------------------------

  private addAgentFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const rulesSection = this.findSection(sections, 'Rules');
    const inputsSection = this.findSection(sections, 'Inputs');
    const outputsSection = this.findSection(sections, 'Outputs');
    const permissionsSection = this.findSection(sections, 'Permissions');
    const dependenciesSection = this.findSection(sections, 'Dependencies');
    const promptSection = this.findSection(sections, 'Prompt');
    const examplesSection = this.findSection(sections, 'Examples');
    const testsSection = this.findSection(sections, 'Tests');

    return {
      ...base,
      role: String(data.role || ''),
      goal: String(data.goal || ''),
      tools: Array.isArray(data.tools) ? data.tools.map(String) : undefined,
      handoff: Array.isArray(data.handoff) ? data.handoff.map(String) : undefined,
      inputs: inputsSection ? this.parseInputs(inputsSection.content) : undefined,
      outputs: outputsSection ? this.parseOutputs(outputsSection.content) : undefined,
      permissions: permissionsSection ? this.parsePermissions(permissionsSection.content) : undefined,
      requires: dependenciesSection ? this.extractList(dependenciesSection.content) : undefined,
      examples: examplesSection ? this.extractText(examplesSection.content) : undefined,
      tests: testsSection ? this.extractText(testsSection.content) : undefined,
      memory: data.memory as V2MemoryReference | undefined,
      rules: rulesSection ? this.extractList(rulesSection.content) : undefined,
      prompts: promptSection ? this.extractList(promptSection.content) : undefined,
    };
  }

  private addToolFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const permissionsSection = this.findSection(sections, 'Permissions');
    const capabilitiesSection = this.findSection(sections, 'Capabilities');
    const dependenciesSection = this.findSection(sections, 'Dependencies');
    const examplesSection = this.findSection(sections, 'Examples');
    const testsSection = this.findSection(sections, 'Tests');

    return {
      ...base,
      provider: String(data.provider || ''),
      capabilities: capabilitiesSection
        ? this.extractList(capabilitiesSection.content)
        : Array.isArray(data.capabilities) ? data.capabilities.map(String) : undefined,
      permissions: permissionsSection ? this.parsePermissions(permissionsSection.content) : undefined,
      requires: dependenciesSection ? this.extractList(dependenciesSection.content) : undefined,
      examples: examplesSection ? this.extractText(examplesSection.content) : undefined,
      tests: testsSection ? this.extractText(testsSection.content) : undefined,
    };
  }

  private addMemoryFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    return {
      ...base,
      format: (data.format as 'vector' | 'key-value' | 'relational' | 'graph' | 'document') || 'key-value',
      backend: String(data.backend || 'local'),
      scope: (data.scope as 'module' | 'workspace' | 'global') || 'module',
      ttl: data.ttl ? String(data.ttl) : undefined,
    };
  }

  private addWorkflowFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const workflowSection = this.findSection(sections, 'Workflow');
    const mermaidSection = this.findSection(sections, 'Mermaid');

    let steps: V2StepNode[] = [];
    let edges: V2EdgeNode[] = [];

    // Try to parse from mermaid flowchart
    const mermaidContent = mermaidSection ? this.extractMermaid(mermaidSection.content) : null;
    if (mermaidContent) {
      const parsed = this.parseMermaidFlowchart(mermaidContent);
      steps = parsed.steps;
      edges = parsed.edges;
    }

    // Try to parse from Workflow section lists
    if (steps.length === 0 && workflowSection) {
      const stepNames = this.extractList(workflowSection.content);
      steps = stepNames.map((name, i) => ({
        type: 'StepNode' as const,
        name: name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || `step-${i + 1}`,
        location: this.loc(ast),
      }));
      for (let i = 0; i < steps.length - 1; i++) {
        edges.push({
          type: 'EdgeNode' as const,
          source: steps[i].name,
          target: steps[i + 1].name,
          location: this.loc(ast),
        });
      }
    }

    return {
      ...base,
      steps,
      edges,
    };
  }

  private addTeamFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const membersSection = this.findSection(sections, 'Members');

    return {
      ...base,
      members: membersSection
        ? this.extractList(membersSection.content)
        : Array.isArray(data.members) ? data.members.map(String) : [],
      policy: data.policy ? String(data.policy) : undefined,
    };
  }

  private addPolicyFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const allowSection = this.findSection(sections, 'Allow');
    const denySection = this.findSection(sections, 'Deny');
    const rulesSection = this.findSection(sections, 'Rules');
    const permissionsSection = this.findSection(sections, 'Permissions');

    let allow: string[] = [];
    let deny: string[] = [];
    const otherRules: string[] = [];

    if (allowSection) {
      allow = this.extractList(allowSection.content);
    }
    if (denySection) {
      deny = this.extractList(denySection.content);
    }

    // Fallback: split rules by "allow:" or "deny:" prefix
    if (allow.length === 0 && deny.length === 0 && rulesSection) {
      const rules = this.extractList(rulesSection.content);
      for (const rule of rules) {
        const lower = rule.toLowerCase();
        if (lower.startsWith('allow:')) {
          allow.push(rule.slice(6).trim());
        } else if (lower.startsWith('deny:')) {
          deny.push(rule.slice(5).trim());
        } else {
          otherRules.push(rule);
        }
      }
    }

    return {
      ...base,
      allow,
      deny,
      permissions: permissionsSection ? this.parsePermissions(permissionsSection.content) : undefined,
      rules: otherRules.length > 0 ? otherRules : undefined,
    };
  }

  private addSystemFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const agentsSection = this.findSection(sections, 'Agents');
    const modulesSection = this.findSection(sections, 'Modules');
    const toolsSection = this.findSection(sections, 'Tools');
    const policySection = this.findSection(sections, 'Policy');
    const dependenciesSection = this.findSection(sections, 'Dependencies');
    const permissionsSection = this.findSection(sections, 'Permissions');
    const capabilitiesSection = this.findSection(sections, 'Capabilities');

    return {
      ...base,
      agents: agentsSection
        ? this.extractList(agentsSection.content)
        : Array.isArray(data.agents) ? data.agents.map(String) : undefined,
      modules: modulesSection
        ? this.extractList(modulesSection.content)
        : Array.isArray(data.modules) ? data.modules.map(String) : undefined,
      tools: toolsSection ? this.extractList(toolsSection.content) : undefined,
      policy: policySection ? this.extractText(policySection.content) : undefined,
      capabilities: this.extractCapabilities(data, capabilitiesSection),
      permissions: permissionsSection
        ? this.parsePermissions(permissionsSection.content)
        : this.parsePermissionsFromData(data),
      requires: dependenciesSection
        ? this.extractList(dependenciesSection.content)
        : this.extractDependenciesFromData(data),
    };
  }

  private addGenericFields(base: V2ModuleNode, ast: ParserModule, data: Record<string, unknown>): V2ModuleNode {
    const sections = ast.sections;
    const dependenciesSection = this.findSection(sections, 'Dependencies');
    const permissionsSection = this.findSection(sections, 'Permissions');
    const capabilitiesSection = this.findSection(sections, 'Capabilities');
    const examplesSection = this.findSection(sections, 'Examples');
    const testsSection = this.findSection(sections, 'Tests');
    const inputsSection = this.findSection(sections, 'Inputs');
    const outputsSection = this.findSection(sections, 'Outputs');
    const rulesSection = this.findSection(sections, 'Rules');
    const docsSection = this.findSection(sections, 'Documentation');

    return {
      ...base,
      inputs: inputsSection ? this.parseInputs(inputsSection.content) : undefined,
      outputs: outputsSection ? this.parseOutputs(outputsSection.content) : undefined,
      capabilities: this.extractCapabilities(data, capabilitiesSection),
      requires: dependenciesSection
        ? this.extractList(dependenciesSection.content)
        : this.extractDependenciesFromData(data),
      permissions: permissionsSection
        ? this.parsePermissions(permissionsSection.content)
        : this.parsePermissionsFromData(data),
      examples: examplesSection ? this.extractText(examplesSection.content) : undefined,
      tests: testsSection ? this.extractText(testsSection.content) : undefined,
      rules: rulesSection ? this.extractList(rulesSection.content) : undefined,
      documentation: docsSection ? this.extractText(docsSection.content) : undefined,
    };
  }

  private createGenericModule(ast: ParserModule): V2ModuleNode {
    const data = ast.frontmatter?.data || {};
    return this.createModule(ast, data, 'module');
  }

  // -------------------------------------------------------------------------
  // Content Parsers
  // -------------------------------------------------------------------------

  private parseInputs(content: ContentNode[]): V2PortDefinition[] {
    const table = this.extractTable(content);
    if (table.headers.length > 0) {
      return table.rows.map(row => ({
        name: row[0] || '',
        type: row[1] || 'unknown',
        required: (row[2] || '').toLowerCase() === 'yes' || (row[2] || '').toLowerCase() === 'true',
        description: row[3] || '',
      }));
    }

    const items = this.extractList(content);
    return items.map(item => {
      const match = item.match(/^(\w+)\s*:\s*(\w+)(?:\s*-\s*(.+))?/);
      if (match) {
        return { name: match[1], type: match[2], required: true, description: match[3] || '' };
      }
      return { name: item, type: 'unknown', required: false, description: '' };
    });
  }

  private parseOutputs(content: ContentNode[]): V2PortDefinition[] {
    return this.parseInputs(content);
  }

  private parsePermissions(content: ContentNode[]): V2PermissionSet {
    const permissions: V2PermissionSet = {};
    const items = this.extractList(content);

    for (const item of items) {
      const lower = item.toLowerCase();
      if (lower.includes('network') || lower.includes('internet')) {
        permissions.network = 'internet';
      } else if (lower.includes('internal')) {
        permissions.network = 'internal';
      } else if (lower.includes('filesystem') || lower.includes('file')) {
        permissions.filesystem = lower.includes('write') ? 'write' : 'read';
      } else if (lower.includes('python') || lower.includes('exec')) {
        permissions.python = lower.includes('sandbox') ? 'sandbox' : 'full';
      } else if (lower.includes('memory')) {
        permissions.memory = lower.includes('shared') ? 'shared' : 'local';
      }
    }

    const table = this.extractTable(content);
    if (table.headers.length > 0) {
      for (const row of table.rows) {
        const name = (row[0] || '').toLowerCase();
        const value = (row[1] || '').toLowerCase();
        if (name.includes('network')) permissions.network = value as 'internet' | 'internal' | 'none';
        if (name.includes('filesystem')) permissions.filesystem = value as 'read' | 'write' | 'none';
        if (name.includes('python')) permissions.python = value as 'sandbox' | 'full' | 'none';
        if (name.includes('memory')) permissions.memory = value as 'local' | 'shared' | 'none';
      }
    }

    return permissions;
  }

  /**
   * Capabilities declared either in a `## Capabilities` section
   * (list items and/or `### name` sub-headings) or in front matter.
   */
  private extractCapabilities(data: Record<string, unknown>, section?: ParserSection): string[] | undefined {
    const capabilities: string[] = [];

    if (section) {
      for (const node of section.content) {
        if (node.type === 'heading' && node.value) {
          capabilities.push(String(node.value).trim());
        }
      }
      if (capabilities.length === 0) {
        capabilities.push(...this.extractList(section.content));
      }
    }

    if (capabilities.length === 0 && Array.isArray(data.capabilities)) {
      capabilities.push(...data.capabilities.map((c) => String(c)));
    }

    return capabilities.length > 0 ? capabilities : undefined;
  }

  /**
   * Dependencies declared in front matter, supporting both string entries
   * and structured `{name, version}` entries.
   */
  private extractDependenciesFromData(data: Record<string, unknown>): string[] | undefined {
    const deps = data.dependencies ?? data.requires;
    if (!Array.isArray(deps)) return undefined;
    const result = deps
      .map((dep) => {
        if (typeof dep === 'string') return dep;
        if (dep && typeof dep === 'object') {
          const d = dep as Record<string, unknown>;
          const name = d.name ?? d.id;
          const version = d.version;
          if (!name) return '';
          return version ? `${name}@${version}` : String(name);
        }
        return String(dep);
      })
      .filter(Boolean);
    return result.length > 0 ? result : undefined;
  }

  /**
   * Permissions declared in front matter as either a string list or an
   * object map (`{network: internet, filesystem: read}`).
   */
  private parsePermissionsFromData(data: Record<string, unknown>): V2PermissionSet | undefined {
    const perms = data.permissions;
    if (!perms) return undefined;
    const result: V2PermissionSet = {};

    if (Array.isArray(perms)) {
      for (const item of perms) {
        const lower = String(item).toLowerCase();
        if (lower.includes('network') || lower.includes('internet')) result.network = 'internet';
        else if (lower.includes('filesystem') || lower.includes('file')) result.filesystem = lower.includes('write') ? 'write' : 'read';
        else if (lower.includes('python') || lower.includes('exec')) result.python = lower.includes('sandbox') ? 'sandbox' : 'full';
        else if (lower.includes('memory')) result.memory = lower.includes('shared') ? 'shared' : 'local';
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }

    if (typeof perms === 'object') {
      const p = perms as Record<string, unknown>;
      const asText = (v: unknown): string =>
        Array.isArray(v) ? v.map(String).join(',') : String(v);

      if (p.network !== undefined) {
        const n = asText(p.network).toLowerCase();
        result.network = n.includes('internet') ? 'internet' : n.includes('internal') ? 'internal' : 'none';
      }
      if (p.filesystem !== undefined) {
        const f = asText(p.filesystem).toLowerCase();
        result.filesystem = f.includes('write') ? 'write' : f.includes('none') ? 'none' : 'read';
      }
      if (p.python !== undefined) {
        const py = asText(p.python).toLowerCase();
        result.python = py.includes('sandbox') ? 'sandbox' : py.includes('none') ? 'none' : 'full';
      }
      if (p.memory !== undefined) {
        const m = asText(p.memory).toLowerCase();
        result.memory = m.includes('shared') ? 'shared' : m.includes('none') ? 'none' : 'local';
      }
      if (p.exec !== undefined) {
        const e = asText(p.exec).toLowerCase();
        result.exec = e.includes('deny') || e.includes('none') ? 'denied' : 'allowed';
      }
      const custom: Record<string, string> = {};
      for (const [key, value] of Object.entries(p)) {
        if (!['network', 'filesystem', 'python', 'memory', 'exec'].includes(key)) {
          custom[key] = asText(value);
        }
      }
      if (Object.keys(custom).length > 0) result.custom = custom;

      return Object.keys(result).length > 0 ? result : undefined;
    }

    return undefined;
  }

  private parseMermaidFlowchart(mermaid: string): { steps: V2StepNode[]; edges: V2EdgeNode[] } {
    const steps: V2StepNode[] = [];
    const edges: V2EdgeNode[] = [];
    const nodeMap = new Map<string, string>();

    const lines = mermaid.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      const nodeMatch = trimmed.match(/(\w+)\s*[\[\(\{"](.+?)[\]\)\}"]/);
      if (nodeMatch) {
        const id = nodeMatch[1];
        const label = nodeMatch[2];
        nodeMap.set(id, label.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase());
        steps.push({
          type: 'StepNode',
          name: nodeMap.get(id)!,
          location: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 }, source: 'mermaid' },
        });
      }

      const edgeMatch = trimmed.match(/(\w+)\s*-->\s*(?:\|[^|]*\|\s*)?(\w+)/);
      if (edgeMatch) {
        const source = nodeMap.get(edgeMatch[1]) || edgeMatch[1];
        const target = nodeMap.get(edgeMatch[2]) || edgeMatch[2];
        edges.push({
          type: 'EdgeNode',
          source,
          target,
          location: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 }, source: 'mermaid' },
        });
      }
    }

    return { steps, edges };
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Transform a parsed MAMModule into V2ModuleNode[] for the compiler.
 *
 * Usage:
 * ```ts
 * import { parseMAM } from '@mam/parser';
 * import { transformToV2 } from '@mam/compiler';
 * import { MAMCompiler } from '@mam/compiler';
 *
 * const { ast } = parseMAM(mamContent);
 * const modules = transformToV2(ast);
 * const compiler = new MAMCompiler();
 * const result = compiler.compile(modules, { target: 'python' });
 * ```
 */
export function transformToV2(ast: ParserModule): V2ModuleNode[] {
  const transformer = new MAMTransformer();
  return transformer.transform(ast);
}
