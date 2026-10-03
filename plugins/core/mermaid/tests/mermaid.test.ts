import { describe, it, expect, afterEach } from 'vitest';
import {
  detectDiagramType, validateMermaidDiagram, countNodes, hasSubgraphs, hasArrows,
  getDiagramTypeLabel, VALID_DIAGRAM_TYPES, DIAGRAM_TYPE_VARIANTS, extractNodes, countArrows,
  extractMermaidBlocks, hasBalancedSubgraphs, countUnclosedSubgraphs, findSubgraphLines,
  getHeaderLine, getCodeLines, stripComments, filterIssues, formatValidationSummary,
} from '../src/validator.js';
import {
  mermaidHtmlRenderer, mermaidMarkdownRenderer, mermaidTextRenderer, mermaidJsonRenderer,
  ALL_MERMAID_RENDERERS, describeDiagrams, renderDiagram, renderInitScript, renderWith,
  getRenderer, getRendererForTarget, escapeHtml, escapeScriptContent,
} from '../src/renderer.js';
import {
  mermaidRule, createMermaidRule, createMermaidRules, createMermaidValidationRule,
  configureMermaidRules, resetMermaidRuleConfig, runMermaidRules, formatMermaidRuleSummary,
  findMermaidBlocks, countMermaidDiagrams, MERMAID_RULES, emptyDiagramRule, unknownTypeRule,
  subgraphRule, emptyNodeRule, sizeRule, complexityRule,
} from '../src/rule.js';
import {
  mermaidSection, MERMAID_MANIFEST, getMermaidSection, createMermaidManifest,
  validateMermaidContent, validateMermaidConfig, isSupportedDiagramType,
  getSupportedDiagramTypes, MERMAID_SECTION_NAME, MERMAID_LIMITS, MERMAID_EXAMPLE,
} from '../src/manifest.js';
import {
  getDiagramInfo, DEFAULT_MERMAID_CONFIG, mergeConfig, mergeConfigs, normalizeConfig,
  validateConfig, getPresetForType, getConfigForDiagram, getAllSupportedTypes, gradeComplexity,
  countStatements, longestLine, formatDiagramInfo, DIAGRAM_PRESETS, MERMAID_THEMES,
  MERMAID_SECURITY_LEVELS, stripDiagramComments, DEFAULT_THRESHOLDS,
} from '../src/types.js';
import mermaidPlugin, {
  createMermaidPlugin, createMermaidApi, describeMermaidPlugin, MERMAID_PLUGIN_VERSION,
} from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
}

function mermaidContent(value: string) {
  return [{ type: 'CodeBlock', language: 'mermaid', value }];
}

describe('Mermaid Plugin - Validator', () => {
  it('should detect flowchart', () => {
    expect(detectDiagramType('flowchart TD\n  A-->B')).toBe('flowchart');
  });

  it('should detect sequenceDiagram', () => {
    expect(detectDiagramType('sequenceDiagram\n  Alice->>Bob: Hello')).toBe('sequenceDiagram');
  });

  it('should detect classDiagram', () => {
    expect(detectDiagramType('classDiagram\n  Animal <|-- Duck')).toBe('classDiagram');
  });

  it('should return unknown for unrecognized type', () => {
    expect(detectDiagramType('something unknown')).toBe('unknown');
  });

  it('should validate a valid diagram', () => {
    const result = validateMermaidDiagram('flowchart TD\n  A-->B\n  B-->C');
    expect(result.valid).toBe(true);
    expect(result.diagramType).toBe('flowchart');
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.hasArrows).toBe(true);
  });

  it('should detect empty diagram', () => {
    const result = validateMermaidDiagram('  ');
    expect(result.valid).toBe(false);
    expect(result.lineCount).toBe(0);
  });

  it('should count nodes correctly', () => {
    const code = 'flowchart TD\n  A[Start]-->B{Decision}\n  B-->C[End]';
    expect(countNodes(code)).toBeGreaterThanOrEqual(2);
  });

  it('should detect subgraphs', () => {
    expect(hasSubgraphs('flowchart TD\n  subgraph SG\n    A-->B\n  end')).toBe(true);
    expect(hasSubgraphs('flowchart TD\n  A-->B')).toBe(false);
  });

  it('should detect arrows', () => {
    expect(hasArrows('A-->B')).toBe(true);
    expect(hasArrows('A --- B')).toBe(true);
    expect(hasArrows('A B')).toBe(false);
  });

  it('should get diagram type labels', () => {
    expect(getDiagramTypeLabel('flowchart')).toBe('Flowchart');
    expect(getDiagramTypeLabel('sequenceDiagram')).toBe('Sequence Diagram');
    expect(getDiagramTypeLabel('unknown')).toBe('Unknown');
  });

  it('VALID_DIAGRAM_TYPES should contain 18 types', () => {
    expect(VALID_DIAGRAM_TYPES.length).toBe(18);
  });

  describe('regression: word-boundary type detection', () => {
    it('should not read graphicalLayout as graph', () => {
      expect(detectDiagramType('graphicalLayout\n A-->B')).toBe('unknown');
    });

    it('should not read pieChart as pie', () => {
      expect(detectDiagramType('pieChart\n A-->B')).toBe('unknown');
    });

    it('should distinguish stateDiagram-v2 from stateDiagram', () => {
      expect(detectDiagramType('stateDiagram-v2\n [*] --> Still')).toBe('stateDiagram-v2');
      expect(detectDiagramType('stateDiagram\n [*] --> Still')).toBe('stateDiagram');
    });

    it('should label the v2 variant', () => {
      expect(getDiagramTypeLabel('stateDiagram-v2')).toBe('State Diagram (v2)');
    });

    it('should accept a flags suffix on the header line', () => {
      expect(detectDiagramType('graph TD;')).toBe('graph');
    });

    it('should skip a %%{init}%% directive before the header', () => {
      expect(detectDiagramType('%%{init: {"theme":"dark"}}%%\nflowchart TD\n A-->B')).toBe('flowchart');
    });

    it('should skip frontmatter before the header', () => {
      expect(detectDiagramType('---\ntitle: X\n---\nsequenceDiagram\n A->>B: hi')).toBe('sequenceDiagram');
    });

    it('should return unknown for an empty document', () => {
      expect(detectDiagramType('')).toBe('unknown');
      expect(detectDiagramType('   \n  ')).toBe('unknown');
    });

    it('getSupportedDiagramTypes should include the variants', () => {
      expect(getSupportedDiagramTypes().length).toBe(19);
      expect(getSupportedDiagramTypes()).toContain('stateDiagram-v2');
    });
  });

  describe('regression: node and edge extraction', () => {
    it('should count unlabelled nodes on both sides of an edge', () => {
      expect(extractNodes('flowchart TD\n  A-->B\n  B-->C')).toEqual(['A', 'B', 'C']);
    });

    it('should count a node declared only as an edge target', () => {
      expect(extractNodes('flowchart TD\n  A-->B')).toEqual(['A', 'B']);
    });

    it('should treat one node with two labels as a single node', () => {
      expect(extractNodes('flowchart TD\n A[x]-->A[y]')).toEqual(['A']);
    });

    it('should report zero nodes for a header-only diagram', () => {
      expect(countNodes('flowchart TD')).toBe(0);
    });

    it('should reject a header-only diagram as invalid', () => {
      // countNodes previously returned Math.max(count, 1), so nodeCount > 0 was
      // always true and this diagram was accepted with nothing in it.
      const result = validateMermaidDiagram('flowchart TD');
      expect(result.nodeCount).toBe(0);
      expect(result.valid).toBe(false);
      expect(result.message).toMatch(/no nodes/);
    });

    it('should detect every mermaid edge form', () => {
      expect(hasArrows('A --> B')).toBe(true);
      expect(hasArrows('A --- B')).toBe(true);
      expect(hasArrows('A -.-> B')).toBe(true);
      expect(hasArrows('A ==> B')).toBe(true);
      expect(hasArrows('A --o B')).toBe(true);
      expect(hasArrows('A --x B')).toBe(true);
      expect(hasArrows('A -->> B')).toBe(true);
      expect(hasArrows('A B')).toBe(false);
    });

    it('countArrows should count each edge once', () => {
      expect(countArrows('flowchart TD\n A -.-> B\n B ==> C')).toBe(2);
      expect(countArrows('flowchart TD\n A --> B')).toBe(1);
      expect(countArrows('no edges here')).toBe(0);
    });
  });

  describe('subgraph balance', () => {
    it('should count unclosed subgraphs', () => {
      expect(countUnclosedSubgraphs('flowchart TD\n subgraph S\n  A-->B')).toBe(1);
      expect(countUnclosedSubgraphs('flowchart TD\n subgraph S\n  A-->B\n end')).toBe(0);
    });

    it('should report an unclosed subgraph as an error', () => {
      const result = validateMermaidDiagram('flowchart TD\n subgraph S\n  A-->B');
      expect(result.valid).toBe(false);
      expect(result.unclosedSubgraphs).toBe(1);
      expect(result.message).toMatch(/Unclosed subgraph/);
    });

    it('hasBalancedSubgraphs should detect a stray end', () => {
      expect(hasBalancedSubgraphs('flowchart TD\n A-->B\n end')).toBe(false);
      expect(hasBalancedSubgraphs('flowchart TD\n A-->B')).toBe(true);
    });

    it('findSubgraphLines should report 1-based line numbers', () => {
      expect(findSubgraphLines('flowchart TD\n subgraph A\n end\n subgraph B\n end')).toEqual([2, 4]);
    });
  });

  describe('source preprocessing', () => {
    it('stripComments should remove %% comments', () => {
      expect(stripComments('flowchart TD %% note\n A-->B')).toBe('flowchart TD \n A-->B');
    });

    it('getCodeLines should preserve line count', () => {
      expect(getCodeLines('a\nb\nc')).toHaveLength(3);
    });

    it('getHeaderLine should return the first meaningful line', () => {
      expect(getHeaderLine('\n\n  flowchart TD\n A-->B')).toBe('flowchart TD');
    });

    it('extractMermaidBlocks should pull only mermaid blocks', () => {
      const content = [
        { type: 'CodeBlock', language: 'mermaid', value: 'flowchart TD\n A-->B' },
        { type: 'CodeBlock', language: 'js', value: 'const a = 1' },
        { type: 'Paragraph', value: 'text' },
      ];
      expect(extractMermaidBlocks(content)).toEqual(['flowchart TD\n A-->B']);
    });
  });

  describe('issues', () => {
    it('should report an unknown type with a line number', () => {
      const result = validateMermaidDiagram('nopeDiagram\n A-->B');
      const issue = result.issues.find((i) => i.code === 'unknown-type');
      expect(issue?.line).toBe(1);
      expect(issue?.severity).toBe('error');
    });

  it('should sort errors before warnings', () => {
    // No nodes (error) and two lines against a one-line cap (warning).
    const result = validateMermaidDiagram('flowchart TD\n subgraph S', { maxLines: 1 });
    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
    expect(result.issues[result.issues.length - 1]?.severity).toBe('warning');
  });


    it('filterIssues should select by severity', () => {
      const result = validateMermaidDiagram('flowchart TD');
      expect(filterIssues(result, 'error')).toHaveLength(1);
      expect(filterIssues(result, 'warning')).toHaveLength(0);
    });

    it('formatValidationSummary should describe the outcome', () => {
      expect(formatValidationSummary(validateMermaidDiagram('flowchart TD\n A-->B'))).toBe('Flowchart: no problems');
      expect(formatValidationSummary(validateMermaidDiagram('flowchart TD'))).toMatch(/1 error/);
    });

    it('should optionally require edges', () => {
      const code = 'flowchart TD\n A[Only]';
      expect(validateMermaidDiagram(code, { requireEdges: true }).issues.some((i) => i.code === 'no-edges')).toBe(true);
      expect(validateMermaidDiagram(code).issues.some((i) => i.code === 'no-edges')).toBe(false);
    });

    it('should flag too many nodes', () => {
      const code = 'flowchart TD\n A-->B\n B-->C\n C-->D';
      expect(validateMermaidDiagram(code, { maxNodes: 2 }).issues.some((i) => i.code === 'too-many-nodes')).toBe(true);
    });
  });
});

describe('Mermaid Plugin - Renderers', () => {
  const mermaidNode = mermaidContent('flowchart TD\n  A-->B');

  it('html renderer should wrap in mermaid div', () => {
    const result = mermaidHtmlRenderer.render(mermaidNode as any);
    expect(result).toContain('class="mermaid"');
    expect(result).toContain('flowchart TD');
  });

  it('markdown renderer should output code block', () => {
    const result = mermaidMarkdownRenderer.render(mermaidNode as any);
    expect(result).toContain('```mermaid');
    expect(result).toContain('flowchart TD');
  });

  it('text renderer should include diagram type label', () => {
    const result = mermaidTextRenderer.render(mermaidNode as any);
    expect(result).toContain('Flowchart');
  });

  it('json renderer should output valid JSON', () => {
    const result = mermaidJsonRenderer.render(mermaidNode as any);
    const parsed = JSON.parse(result);
    expect(parsed.diagrams).toHaveLength(1);
    expect(parsed.diagrams[0].type).toBe('flowchart');
  });

  it('html renderer should escape HTML', () => {
    const content = mermaidContent('A-->B <script>alert(1)</script>');
    const result = mermaidHtmlRenderer.render(content as any);
    // The renderer emits its own <script> block for mermaid.initialize, so the
    // check targets the injected payload rather than any script tag.
    expect(result).not.toContain('<script>alert(1)</script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapeHtml should cover the single quote', () => {
    expect(escapeHtml(`a'b`)).toBe('a&#39;b');
    expect(escapeHtml('a&b<c>"d"')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;');
  });

  it('escapeScriptContent should neutralise a closing script tag', () => {
    expect(escapeScriptContent('a</script>b')).not.toContain('</script>');
  });

  it('html renderer should include the mermaid initialize script', () => {
    const result = mermaidHtmlRenderer.render(mermaidNode as any);
    expect(result).toContain('mermaid.initialize');
    expect(result).toContain('securityLevel');
  });

  it('renderInitScript should not double-initialise', () => {
    const script = renderInitScript({ theme: 'dark' });
    expect(script).toContain('__mamInitialised');
    expect(script).toContain('"theme": "dark"');
  });

  it('html renderer should give every diagram a unique id', () => {
    const content = [...mermaidNode, ...mermaidContent('sequenceDiagram\n A->>B: hi')];
    const result = mermaidHtmlRenderer.render(content as any);
    expect(result).toContain('id="mam-diagram-0"');
    expect(result).toContain('id="mam-diagram-1"');
  });

  it('html renderer should mark each diagram with its type', () => {
    expect(mermaidHtmlRenderer.render(mermaidNode as any)).toContain('data-diagram-type="flowchart"');
  });

  it('html renderer should report a message when there are no diagrams', () => {
    const result = mermaidHtmlRenderer.render([{ type: 'Paragraph', value: 'hi' }] as any);
    expect(result).toContain('No Mermaid diagrams');
  });

  it('html renderer should emit an error placeholder for an invalid diagram', () => {
    const result = mermaidHtmlRenderer.render(mermaidContent('notARealDiagram\n A-->B') as any);
    expect(result).toContain('mermaid-error');
    expect(result).toContain('role="alert"');
  });

  it('html renderer should respect a custom container class', () => {
    const result = mermaidHtmlRenderer.render(mermaidNode as any, { containerClass: 'my-diagrams' });
    expect(result).toContain('class="my-diagrams"');
  });

  it('html renderer should omit the init script when asked', () => {
    const result = mermaidHtmlRenderer.render(mermaidNode as any, { includeInit: false });
    expect(result).not.toContain('mermaid.initialize');
  });

  it('html renderer should apply the theme as a data attribute', () => {
    expect(mermaidHtmlRenderer.render(mermaidNode as any, { theme: 'dark' })).toContain('data-theme="dark"');
  });

  it('html renderer should expose styles and scripts through the interface', () => {
    expect(mermaidHtmlRenderer.getStyles?.()).toContain('.mermaid-container');
    expect(mermaidHtmlRenderer.getScripts?.()[0]).toContain('mermaid.initialize');
  });

  it('markdown renderer should annotate each diagram', () => {
    expect(mermaidMarkdownRenderer.render(mermaidNode as any)).toContain('<!-- Flowchart, 2 nodes -->');
  });

  it('markdown renderer should return an empty string with no diagrams', () => {
    expect(mermaidMarkdownRenderer.render([] as any)).toBe('');
  });

  it('text renderer should include node and edge counts', () => {
    const result = mermaidTextRenderer.render(mermaidNode as any);
    expect(result).toContain('2 nodes');
    expect(result).toContain('1 edges');
  });

  it('json renderer should report validation and metrics', () => {
    const parsed = JSON.parse(mermaidJsonRenderer.render(mermaidNode as any));
    expect(parsed.count).toBe(1);
    expect(parsed.diagrams[0].valid).toBe(true);
    expect(parsed.diagrams[0].info.nodeCount).toBe(2);
    expect(parsed.version).toBe(1);
  });

  it('json renderer should carry the issues for an invalid diagram', () => {
    const parsed = JSON.parse(mermaidJsonRenderer.render(mermaidContent('bogusType\n A-->B') as any));
    expect(parsed.diagrams[0].valid).toBe(false);
    expect(parsed.diagrams[0].issues.length).toBeGreaterThan(0);
  });

  it('describeDiagrams should index each diagram', () => {
    const content = [...mermaidNode, ...mermaidContent('pie\n "a" : 1')];
    const described = describeDiagrams(content);
    expect(described.map((d) => d.index)).toEqual([0, 1]);
    expect(described[1]!.type).toBe('pie');
  });

  it('renderDiagram should render a valid diagram as a figure', () => {
    const html = renderDiagram(describeDiagrams(mermaidNode)[0]!);
    expect(html).toContain('<figure');
    expect(html).toContain('2 nodes)');
  });

  it('ALL_MERMAID_RENDERERS should cover four targets', () => {
    expect(ALL_MERMAID_RENDERERS.map((r) => r.target).sort()).toEqual(['html', 'json', 'markdown', 'text']);
  });

  it('getRenderer and getRendererForTarget should find renderers', () => {
    expect(getRenderer('mermaid-html')?.target).toBe('html');
    expect(getRendererForTarget('json')?.name).toBe('mermaid-json');
    expect(getRenderer('nope')).toBeUndefined();
  });

  it('renderWith should delegate to a named renderer', () => {
    expect(renderWith('mermaid-text', mermaidNode as any)).toContain('Flowchart');
    expect(renderWith('nope', mermaidNode as any)).toBeUndefined();
  });
});

describe('Mermaid Plugin - Rule', () => {
  afterEach(() => {
    resetMermaidRuleConfig();
  });

  it('should report empty diagrams', () => {
    const mod = makeModule([{ name: 'Diagrams', content: mermaidContent('') }]);
    const results = mermaidRule.check(mod);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should pass valid diagrams', () => {
    const mod = makeModule([{ name: 'Diagrams', content: mermaidContent('flowchart TD\n  A-->B') }]);
    const results = mermaidRule.check(mod);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it('mermaidRule should stay empty-only, as before', () => {
    const mod = makeModule([{ name: 'Diagrams', content: mermaidContent('bogusType\n A-->B') }]);
    expect(mermaidRule.check(mod)).toEqual([]);
  });

  it('should find mermaid blocks across every section', () => {
    const mod = makeModule([
      { name: 'One', content: mermaidContent('') },
      { name: 'Two', content: mermaidContent('') },
    ]);
    expect(mermaidRule.check(mod)).toHaveLength(2);
  });

  it('should carry the node location when available', () => {
    const node = { type: 'CodeBlock', language: 'mermaid', value: '', location: { start: { line: 4, column: 2 } } };
    const results = mermaidRule.check(makeModule([{ name: 'D', content: [node] }]));
    expect(results[0].location).toEqual({ line: 4, column: 2 });
  });

  it('findMermaidBlocks and countMermaidDiagrams should collect blocks', () => {
    const mod = makeModule([
      { name: 'A', content: [...mermaidContent('flowchart TD\n A-->B'), { type: 'CodeBlock', language: 'js', value: 'x' }] },
    ]);
    expect(countMermaidDiagrams(mod)).toBe(1);
    expect(findMermaidBlocks(mod)[0]!.code).toContain('flowchart');
  });

  it('emptyDiagramRule should report blank blocks', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('   ') }]);
    expect(emptyDiagramRule.check(mod)).toHaveLength(1);
  });

  it('unknownTypeRule should reject an unrecognised header', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('bogusType\n A-->B') }]);
    const results = unknownTypeRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe('mermaid-unknown-type');
  });

  it('subgraphRule should report an unclosed subgraph', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('flowchart TD\n subgraph S\n  A-->B') }]);
    const results = subgraphRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].message).toMatch(/Unclosed subgraph/);
  });

  it('subgraphRule should pass a balanced diagram', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('flowchart TD\n subgraph S\n  A-->B\n end') }]);
    expect(subgraphRule.check(mod)).toEqual([]);
  });

  it('emptyNodeRule should report a diagram with no nodes', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('flowchart TD') }]);
    expect(emptyNodeRule.check(mod)).toHaveLength(1);
  });

  it('sizeRule should be quiet until limits are configured', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('flowchart TD\n A-->B\n B-->C') }]);
    expect(sizeRule.check(mod)).toEqual([]);
    configureMermaidRules({ maxNodes: 1 });
    expect(sizeRule.check(mod).length).toBeGreaterThan(0);
  });

  it('sizeRule should flag long diagrams', () => {
    const mod = makeModule([{ name: 'D', content: mermaidContent('flowchart TD\n A-->B\n B-->C') }]);
    configureMermaidRules({ maxLines: 1 });
    expect(sizeRule.check(mod).some((r) => r.message.includes('lines'))).toBe(true);
  });

  it('complexityRule should report a large diagram as info', () => {
    const body = Array.from({ length: 40 }, (_, i) => `  N${i}-->N${i + 1}`).join('\n');
    const mod = makeModule([{ name: 'D', content: mermaidContent(`flowchart TD\n${body}`) }]);
    const results = complexityRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('info');
    expect(results[0].valid).toBe(true);
  });

  it('MERMAID_RULES should contain the full family', () => {
    expect(MERMAID_RULES).toHaveLength(6);
    expect(new Set(MERMAID_RULES.map((r) => r.name)).size).toBe(MERMAID_RULES.length);
  });

  it('createMermaidRule should override the severity', () => {
    expect(createMermaidRule('error').severity).toBe('error');
    expect(createMermaidRule().severity).toBe('warning');
  });

  it('createMermaidRules should re-level every rule', () => {
    expect(createMermaidRules('info').every((r) => r.severity === 'info')).toBe(true);
  });

  it('createMermaidValidationRule should report every problem', () => {
    const mod = makeModule([{
      name: 'D',
      content: mermaidContent('bogusType\n subgraph S\n  A-->B'),
    }]);
    const results = createMermaidValidationRule().check(mod);
    expect(results.every((r) => r.rule === 'mermaid-validate')).toBe(true);
    const messages = results.map((r) => r.message).join(' | ');
    expect(messages).toMatch(/Unrecognized Mermaid diagram type/);
    expect(messages).toMatch(/Unclosed subgraph/);
    expect(results.filter((r) => !r.valid).length).toBeGreaterThanOrEqual(2);
  });

  it('runMermaidRules should flatten results and contain a throwing rule', () => {
    const exploding = {
      name: 'boom', description: '', severity: 'error' as const,
      check: () => { throw new Error('kaboom'); },
    };
    const results = runMermaidRules(makeModule([]), [exploding]);
    expect(results[0].message).toMatch(/kaboom/);
  });

  it('formatMermaidRuleSummary should count each severity', () => {
    expect(formatMermaidRuleSummary([])).toBe('no problems');
    expect(formatMermaidRuleSummary([{ valid: false, message: 'a' }])).toBe('1 error');
    expect(formatMermaidRuleSummary([
      { valid: false, message: 'a' },
      { valid: true, message: 'b', severity: 'warning' },
      { valid: true, message: 'c', severity: 'info' },
    ])).toBe('1 error, 1 warning, 1 info');
  });

  it('rules should return nothing for a module with no mermaid blocks', () => {
    const mod = makeModule([{ name: 'D', content: [{ type: 'Paragraph', value: 'hi' }] }]);
    for (const rule of MERMAID_RULES) {
      expect(rule.check(mod)).toEqual([]);
    }
  });
});

describe('Mermaid Plugin - Manifest', () => {
  it('should have correct manifest', () => {
    expect(MERMAID_MANIFEST.name).toBe('@mam/plugin-mermaid');
    expect(MERMAID_MANIFEST.keywords).toContain('mermaid');
  });

  it('getMermaidSection should return a copy', () => {
    const s1 = getMermaidSection();
    const s2 = getMermaidSection();
    expect(s1).not.toBe(s2);
  });

  it('section validator should reject empty diagrams', () => {
    const results = mermaidSection.validator!(mermaidContent('') as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should require a MAM version the host can satisfy', () => {
    expect(MERMAID_MANIFEST.mamVersion).toBe('>=0.1.0');
  });

  it('should point main at a file the package actually ships', () => {
    expect(MERMAID_MANIFEST.main).toBe('./dist/index.js');
    expect(MERMAID_MANIFEST.version).toBe('0.1.0');
  });

  it('should export the section name, limits and example', () => {
    expect(MERMAID_SECTION_NAME).toBe('Mermaid');
    expect(MERMAID_LIMITS.maxLines).toBeGreaterThan(0);
    expect(MERMAID_EXAMPLE).toContain('flowchart');
  });

  it('isSupportedDiagramType should recognise known headers', () => {
    expect(isSupportedDiagramType('flowchart')).toBe(true);
    expect(isSupportedDiagramType('stateDiagram-v2')).toBe(true);
    expect(isSupportedDiagramType('nope')).toBe(false);
  });

  it('section validator should reject an unknown diagram type', () => {
    const results = mermaidSection.validator!(mermaidContent('bogusType\n A-->B') as any);
    expect(results.some((r) => !r.valid && r.rule === 'mermaid-unknown-type')).toBe(true);
  });

  it('section validator should reject an unclosed subgraph', () => {
    const results = mermaidSection.validator!(mermaidContent('flowchart TD\n subgraph S\n  A-->B') as any);
    expect(results.some((r) => r.message?.includes('Unclosed subgraph'))).toBe(true);
  });

  it('section validator should accept a valid diagram', () => {
    expect(mermaidSection.validator!(mermaidContent('flowchart TD\n A-->B') as any)).toEqual([]);
  });

  it('section validator should ignore non-mermaid blocks', () => {
    expect(mermaidSection.validator!([{ type: 'CodeBlock', language: 'js', value: 'x' }] as any)).toEqual([]);
  });

  it('getMermaidSection should apply overridden limits', () => {
    const section = getMermaidSection({ maxLines: 1 });
    const results = section.validator!(mermaidContent('flowchart TD\n A-->B\n B-->C') as any);
    expect(results.some((r) => r.rule === 'mermaid-too-many-lines')).toBe(true);
  });

  it('createMermaidManifest should override without mutating the original', () => {
    const custom = createMermaidManifest({ version: '2.0.0', keywords: ['custom'] });
    expect(custom.version).toBe('2.0.0');
    expect(custom.keywords).toEqual(['custom']);
    expect(MERMAID_MANIFEST.version).toBe('0.1.0');
    expect(MERMAID_MANIFEST.keywords).toContain('mermaid');
  });

  it('validateMermaidConfig should surface a bad theme', () => {
    const results = validateMermaidConfig({ theme: 'chartreuse' as never });
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('theme');
  });

  it('validateMermaidConfig should pass a valid config', () => {
    expect(validateMermaidConfig({ theme: 'dark', fontSize: 12 })).toEqual([]);
  });
});

describe('Mermaid Plugin - Types', () => {
  it('getDiagramInfo should return info', () => {
    const code = 'flowchart TD\n  subgraph SG\n    A-->B\n  end';
    const info = getDiagramInfo(code, 'flowchart');
    expect(info.type).toBe('flowchart');
    expect(info.lineCount).toBe(4);
    expect(info.subgraphCount).toBe(1);
    expect(info.complexity).toBe('moderate');
  });

  it('DEFAULT_MERMAID_CONFIG should have sensible defaults', () => {
    expect(DEFAULT_MERMAID_CONFIG.theme).toBe('default');
    expect(DEFAULT_MERMAID_CONFIG.securityLevel).toBe('strict');
  });

  it('mergeConfig should override base', () => {
    const merged = mergeConfig(DEFAULT_MERMAID_CONFIG, { theme: 'dark' });
    expect(merged.theme).toBe('dark');
    expect(merged.fontFamily).toBe(DEFAULT_MERMAID_CONFIG.fontFamily);
  });

  it('getDiagramInfo should count dotted edges', () => {
    const info = getDiagramInfo('flowchart TD\n A -.-> B', 'flowchart');
    expect(info.arrowCount).toBe(1);
  });

  it('getDiagramInfo should count unlabelled nodes', () => {
    expect(getDiagramInfo('flowchart TD\n A-->B\n B-->C', 'flowchart').nodeCount).toBe(3);
  });

  it('getDiagramInfo should detect the type when none is given', () => {
    expect(getDiagramInfo('sequenceDiagram\n A->>B: hi').type).toBe('sequenceDiagram');
  });

  it('getDiagramInfo should report extra metrics', () => {
    const info = getDiagramInfo('flowchart TD\n A-->B', 'flowchart');
    expect(info.label).toBe('Flowchart');
    expect(info.statementCount).toBe(2);
    expect(info.longestLine).toBeGreaterThan(0);
    expect(info.unclosedSubgraphs).toBe(0);
    expect(info.headerLine).toBe(1);
  });

  it('getDiagramInfo should locate the header after a directive', () => {
    const info = getDiagramInfo('%%{init: {}}%%\nflowchart TD\n A-->B');
    expect(info.headerLine).toBe(2);
  });

  it('formatDiagramInfo should summarise the diagram', () => {
    const text = formatDiagramInfo(getDiagramInfo('flowchart TD\n A-->B', 'flowchart'));
    expect(text).toContain('Flowchart');
    expect(text).toContain('2 nodes');
  });

  it('gradeComplexity should honour custom thresholds', () => {
    expect(gradeComplexity({ lineCount: 40, nodeCount: 1, subgraphCount: 0 })).toBe('complex');
    expect(gradeComplexity(
      { lineCount: 40, nodeCount: 1, subgraphCount: 0 },
      { ...DEFAULT_THRESHOLDS, complexLines: 100 },
    )).not.toBe('complex');
  });

  it('countStatements should skip blanks and comments', () => {
    expect(countStatements('flowchart TD\n\n%% note\n A-->B')).toBe(2);
  });

  it('longestLine should find the widest line', () => {
    expect(longestLine('ab\nabcd\na')).toBe(4);
  });

  it('mergeConfig should recurse into nested sections', () => {
    const merged = mergeConfig(
      { flowchart: { useMaxWidth: true, curve: 'basis' } },
      { flowchart: { curve: 'linear' } },
    );
    expect(merged.flowchart).toEqual({ useMaxWidth: true, curve: 'linear' });
  });

  it('mergeConfig should ignore undefined overrides', () => {
    expect(mergeConfig({ theme: 'dark' }, { theme: undefined }).theme).toBe('dark');
  });

  it('mergeConfigs should layer left to right over the defaults', () => {
    const merged = mergeConfigs({ theme: 'forest' }, { fontSize: 20 }, undefined);
    expect(merged.theme).toBe('forest');
    expect(merged.fontSize).toBe(20);
    expect(merged.securityLevel).toBe('strict');
  });

  it('normalizeConfig should fill in every default', () => {
    const config = normalizeConfig({ theme: 'dark' });
    expect(config.fontSize).toBe(DEFAULT_MERMAID_CONFIG.fontSize);
    expect(config.theme).toBe('dark');
  });

  it('validateConfig should accept valid values', () => {
    expect(validateConfig({
      theme: 'dark', logLevel: 'warn', securityLevel: 'sandbox', fontSize: 12,
      flowchart: { curve: 'linear' },
    })).toEqual([]);
  });

  it('validateConfig should reject bad enum values', () => {
    expect(validateConfig({ logLevel: 'loud' as never })).toHaveLength(1);
    expect(validateConfig({ flowchart: { curve: 'wiggly' as never } })).toHaveLength(1);
  });

  it('validateConfig should reject an out-of-range font size', () => {
    expect(validateConfig({ fontSize: 0 })).toHaveLength(1);
    expect(validateConfig({ fontSize: 500 })).toHaveLength(1);
  });

  it('validateConfig should flag htmlLabels under strict security', () => {
    const issues = validateConfig({ securityLevel: 'strict', flowchart: { htmlLabels: true } });
    expect(issues[0].path).toBe('flowchart.htmlLabels');
  });

  it('getPresetForType should fall back to the flowchart preset', () => {
    expect(getPresetForType('sequenceDiagram')).toEqual(DIAGRAM_PRESETS.sequenceDiagram);
    expect(getPresetForType('unknown')).toEqual(DIAGRAM_PRESETS.flowchart);
  });

  it('getConfigForDiagram should detect the type and layer overrides', () => {
    const config = getConfigForDiagram('sequenceDiagram\n A->>B: hi', { fontSize: 18 });
    expect(config.sequence?.mirrorActors).toBe(true);
    expect(config.fontSize).toBe(18);
  });

  it('getAllSupportedTypes should include the variants', () => {
    expect(getAllSupportedTypes()).toHaveLength(19);
  });

  it('stripDiagramComments should remove comments', () => {
    expect(stripDiagramComments('flowchart TD %% x\n A-->B')).toBe('flowchart TD \n A-->B');
  });

  it('should export the allowed theme and security levels', () => {
    expect(MERMAID_THEMES).toContain('forest');
    expect(MERMAID_SECURITY_LEVELS).toEqual(['strict', 'loose', 'sandbox']);
  });
});

describe('Mermaid Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(mermaidPlugin.manifest.name).toBe('@mam/plugin-mermaid');
    expect(mermaidPlugin.sections).toHaveLength(1);
    expect(mermaidPlugin.rules).toHaveLength(1);
    expect(mermaidPlugin.renderers!.length).toBeGreaterThanOrEqual(1);
  });

  it('should install all four renderers without duplicating the html one', () => {
    const names = mermaidPlugin.renderers!.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(['mermaid-html', 'mermaid-json', 'mermaid-markdown', 'mermaid-text']);
  });
});

describe('Mermaid Plugin - Factories', () => {
  it('createMermaidPlugin should build a default plugin', () => {
    const plugin = createMermaidPlugin();
    expect(plugin.rules).toHaveLength(1);
    expect(plugin.sections?.[0]?.name).toBe(MERMAID_SECTION_NAME);
    expect(plugin.renderers).toHaveLength(4);
  });

  it('createMermaidPlugin should include the full rule family on request', () => {
    expect(createMermaidPlugin({ allRules: true }).rules).toHaveLength(6);
  });

  it('createMermaidPlugin should apply a severity', () => {
    const plugin = createMermaidPlugin({ allRules: true, severity: 'error' });
    expect(plugin.rules?.every((r) => r.severity === 'error')).toBe(true);
  });

  it('createMermaidPlugin should restrict render targets', () => {
    const plugin = createMermaidPlugin({ targets: ['json'] });
    expect(plugin.renderers?.map((r) => r.target)).toEqual(['json']);
  });

  it('createMermaidPlugin should bake config into the html renderer', () => {
    const plugin = createMermaidPlugin({ config: { theme: 'forest' } });
    const html = plugin.renderers!.find((r) => r.name === 'mermaid-html')!;
    expect(html.render(mermaidContent('flowchart TD\n A-->B') as any)).toContain('data-theme="forest"');
  });

  it('createMermaidPlugin should override the manifest', () => {
    expect(createMermaidPlugin({ manifest: { version: '9.9.9' } }).manifest.version).toBe('9.9.9');
  });

  it('createMermaidApi should bundle rules, renderers and config', () => {
    const api = createMermaidApi({ theme: 'dark' });
    expect(api.version).toBe(MERMAID_PLUGIN_VERSION);
    expect(api.sectionName).toBe('Mermaid');
    expect(api.rules).toHaveLength(6);
    expect(api.renderers).toHaveLength(4);
    expect(api.config.theme).toBe('dark');
    expect(api.supportedTypes).toHaveLength(19);
    expect(api.example).toContain('flowchart');
    expect(api.limits.maxLines).toBeGreaterThan(0);
  });

  it('createMermaidApi should render by target', () => {
    const api = createMermaidApi();
    expect(api.render('text', mermaidContent('flowchart TD\n A-->B') as any)).toContain('Flowchart');
    expect(api.render('nope', mermaidContent('flowchart TD\n A-->B') as any)).toBeUndefined();
  });

  it('describeMermaidPlugin should summarise the surface', () => {
    const text = describeMermaidPlugin();
    expect(text).toContain(MERMAID_PLUGIN_VERSION);
    expect(text).toContain('19 diagram types');
  });
});
