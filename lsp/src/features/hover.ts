/**
 * MAM Hover Provider
 */

import { Hover, MarkupKind } from 'vscode-languageserver-protocol';

const SECTION_DOCS: Record<string, string> = {
  Purpose: 'Module objective description. **Required section.**',
  Inputs: 'Expected input parameters in table format (Name, Type, Required, Description).',
  Outputs: 'Expected output values in table format (Name, Type, Description).',
  Rules: 'Behavioral constraints and guidelines. Use bullet list format.',
  Workflow: 'Process definition using Mermaid diagrams.',
  Mermaid: 'Visual diagram definitions using Mermaid syntax.',
  Python: 'Python code blocks for execution. Supports `@mam:` metadata comments.',
  JavaScript: 'JavaScript/TypeScript code blocks for execution.',
  TypeScript: 'TypeScript code blocks for execution.',
  Prompt: 'LLM instructions and prompts for AI agents.',
  Memory: 'Persistent state and knowledge. Use `**key**: value` format.',
  Examples: 'Usage demonstrations with runnable code.',
  Tests: 'Validation rules and test cases.',
  References: 'External links and documentation.',
  Dependencies: 'Required modules and packages.',
  Exports: 'Public interface definitions.',
  Imports: 'Required imports and dependencies.',
  Plugins: 'Required plugins for the module.',
  Permissions: 'Security permissions: network, filesystem, environment, exec, memory.',
  Capabilities: 'System capabilities required by the module.',
};

export function getHover(line: string): Hover | null {
  const match = line.match(/^##\s+(.+)/);
  if (match) {
    const name = match[1]!.trim();
    const doc = SECTION_DOCS[name];
    if (doc) {
      return { contents: { kind: MarkupKind.Markdown, value: doc } };
    }
  }
  return null;
}