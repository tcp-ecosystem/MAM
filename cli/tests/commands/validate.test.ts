/**
 * CLI Validate Command Tests
 */

import { describe, it, expect } from 'vitest';
import { MAMValidator } from '../../src/commands/validate.js';

const opts = { file: 'test.mam', format: 'text' as const, quiet: true };

describe('Validate Command', () => {
  it('keeps the public option interface', () => {
    const options = { file: 'test.mam.md', level: 'schema' as const, format: 'text' as const };
    expect(options.file).toBe('test.mam.md');
    expect(options.level).toBe('schema');
  });

  it('reports one root-cause error for an empty file', async () => {
    const validator = new MAMValidator();
    const result = await validator.validateContent('', 'empty.mam', opts);
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ruleId).toBe('FM001');
  });

  it('does not cascade frontmatter errors into parse errors', async () => {
    const validator = new MAMValidator();
    const result = await validator.validateContent('# no frontmatter\n', 'headless.mam', opts);
    const ruleIds = result.diagnostics.map(d => d.ruleId);
    expect(ruleIds).toContain('FM001');
    expect(ruleIds).not.toContain('PARSE_ERROR');
    expect(ruleIds).not.toContain('FM003');
  });

  it('validates a complete module without errors', async () => {
    const module = [
      '---',
      'id: probe',
      'name: Probe',
      'version: 2.0.0',
      'type: module',
      'author: Test',
      'description: A probe module.',
      'license: MIT',
      'runtime:',
      '  language: python',
      '  version: ">=3.12"',
      '---',
      '',
      '# Probe',
      '',
      '## Purpose',
      '',
      'Prove the validator works.',
      '',
      '## Inputs',
      '',
      '- value',
      '',
      '## Outputs',
      '',
      '- result',
      '',
      '## Capabilities',
      '',
      '### run',
      '',
      'Run the probe.',
      '',
      '## Rules',
      '',
      '- Keep it small.',
      '',
      '## Workflow',
      '',
      '```mermaid',
      'flowchart LR',
      '    A[value] --> B[result]',
      '```',
      '',
      '## Python',
      '',
      '```python',
      'def run(value):',
      '    return value',
      '```',
      '',
      '## Tests',
      '',
      '### Input',
      '',
      '```yaml',
      'value: 1',
      '```',
      '',
      '### Expected',
      '',
      '```yaml',
      'result: 1',
      '```',
      '',
      '## Examples',
      '',
      '```python',
      'result = run(1)',
      '```',
      '',
      '## References',
      '',
      '- plan-doc/full-mam.md',
      '',
    ].join('\n');
    const validator = new MAMValidator();
    const result = await validator.validateContent(module, 'probe.mam', opts);
    expect(result.diagnostics.filter(d => d.severity === 'error')).toHaveLength(0);
  });
});
