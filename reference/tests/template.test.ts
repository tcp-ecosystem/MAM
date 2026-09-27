import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_TEMPLATE_KINDS,
  isTemplateKind,
  getStarterTemplate,
  renderTemplate,
  listTemplateVariables,
  createModuleStarter,
  getTemplateDescription,
} from '../src/template.js';

describe('SUPPORTED_TEMPLATE_KINDS', () => {
  it('should offer module, agent, and tool', () => {
    expect([...SUPPORTED_TEMPLATE_KINDS]).toEqual(['module', 'agent', 'tool']);
  });
});

describe('isTemplateKind', () => {
  it('should validate kind names', () => {
    expect(isTemplateKind('module')).toBe(true);
    expect(isTemplateKind('agent')).toBe(true);
    expect(isTemplateKind('Agent')).toBe(false);
    expect(isTemplateKind('pipeline')).toBe(false);
  });
});

describe('getStarterTemplate', () => {
  it('should return distinct templates with placeholders', () => {
    const module = getStarterTemplate('module');
    const agent = getStarterTemplate('agent');
    const tool = getStarterTemplate('tool');
    expect(module).toContain('{{slug}}');
    expect(agent).toContain('role');
    expect(tool).toContain('Capabilities');
    expect(new Set([module, agent, tool]).size).toBe(3);
  });
});

describe('renderTemplate', () => {
  it('should substitute variables', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'MAM' })).toBe('Hello MAM!');
    expect(renderTemplate('{{a}} and {{b}}', { a: '1', b: '2' })).toBe('1 and 2');
  });

  it('should leave unknown variables untouched', () => {
    expect(renderTemplate('Hi {{missing}}', {})).toBe('Hi {{missing}}');
  });
});

describe('listTemplateVariables', () => {
  it('should list unique variable names', () => {
    expect(listTemplateVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
    expect(listTemplateVariables('no vars')).toEqual([]);
  });
});

describe('createModuleStarter', () => {
  it('should render a complete starter', () => {
    const starter = createModuleStarter('My Module');
    expect(starter).toContain('My Module');
    expect(starter).toContain('my-module');
    expect(starter).not.toContain('{{');
    expect(starter).toContain('## Purpose');
  });

  it('should support agent and tool kinds', () => {
    expect(createModuleStarter('Bot', 'agent')).toContain('role');
    expect(createModuleStarter('Runner', 'tool')).toContain('Capabilities');
  });
});

describe('getTemplateDescription', () => {
  it('should describe each kind', () => {
    expect(getTemplateDescription('module')).toContain('Generic');
    expect(getTemplateDescription('agent')).toContain('agent');
    expect(getTemplateDescription('tool')).toContain('tool');
  });
});
