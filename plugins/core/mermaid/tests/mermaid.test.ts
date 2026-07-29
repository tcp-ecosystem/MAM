import { describe, it, expect } from 'vitest';
import { detectDiagramType, validateMermaidDiagram, countNodes, hasSubgraphs, hasArrows, getDiagramTypeLabel, VALID_DIAGRAM_TYPES } from '../src/validator.js';
import { mermaidHtmlRenderer, mermaidMarkdownRenderer, mermaidTextRenderer, mermaidJsonRenderer } from '../src/renderer.js';
import { mermaidRule } from '../src/rule.js';
import { mermaidSection, MERMAID_MANIFEST, getMermaidSection } from '../src/manifest.js';
import { getDiagramInfo, DEFAULT_MERMAID_CONFIG, mergeConfig } from '../src/types.js';
import mermaidPlugin from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
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
});

describe('Mermaid Plugin - Renderers', () => {
  const mermaidContent = [{ type: 'CodeBlock', language: 'mermaid', value: 'flowchart TD\n  A-->B' }];

  it('html renderer should wrap in mermaid div', () => {
    const result = mermaidHtmlRenderer.render(mermaidContent as any);
    expect(result).toContain('class="mermaid"');
    expect(result).toContain('flowchart TD');
  });

  it('markdown renderer should output code block', () => {
    const result = mermaidMarkdownRenderer.render(mermaidContent as any);
    expect(result).toContain('```mermaid');
    expect(result).toContain('flowchart TD');
  });

  it('text renderer should include diagram type label', () => {
    const result = mermaidTextRenderer.render(mermaidContent as any);
    expect(result).toContain('Flowchart');
  });

  it('json renderer should output valid JSON', () => {
    const result = mermaidJsonRenderer.render(mermaidContent as any);
    const parsed = JSON.parse(result);
    expect(parsed.diagrams).toHaveLength(1);
    expect(parsed.diagrams[0].type).toBe('flowchart');
  });

  it('html renderer should escape HTML', () => {
    const content = [{ type: 'CodeBlock', language: 'mermaid', value: 'A-->B <script>alert(1)</script>' }];
    const result = mermaidHtmlRenderer.render(content as any);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

describe('Mermaid Plugin - Rule', () => {
  it('should report empty diagrams', () => {
    const mod = makeModule([{
      name: 'Diagrams',
      content: [{ type: 'CodeBlock', language: 'mermaid', value: '' }],
    }]);
    const results = mermaidRule.check(mod);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should pass valid diagrams', () => {
    const mod = makeModule([{
      name: 'Diagrams',
      content: [{ type: 'CodeBlock', language: 'mermaid', value: 'flowchart TD\n  A-->B' }],
    }]);
    const results = mermaidRule.check(mod);
    expect(results.every((r) => r.valid)).toBe(true);
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
    const results = mermaidSection.validator!([
      { type: 'CodeBlock', language: 'mermaid', value: '' },
    ] as any);
    expect(results.some((r) => !r.valid)).toBe(true);
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
});

describe('Mermaid Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(mermaidPlugin.manifest.name).toBe('@mam/plugin-mermaid');
    expect(mermaidPlugin.sections).toHaveLength(1);
    expect(mermaidPlugin.rules).toHaveLength(1);
    expect(mermaidPlugin.renderers!.length).toBeGreaterThanOrEqual(1);
  });
});
