/**
 * MAM Completion Provider
 */

import { CompletionItem, CompletionItemKind } from 'vscode-languageserver-protocol';

const SECTION_NAMES = ['Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Mermaid', 'Python', 'JavaScript', 'TypeScript', 'Prompt', 'Memory', 'Examples', 'Tests', 'References', 'Dependencies', 'Exports', 'Imports', 'Plugins', 'Permissions', 'Capabilities'];
const YAML_KEYS = ['id', 'version', 'name', 'author', 'runtime', 'tags', 'description', 'dependencies', 'permissions', 'license', 'repository', 'mam_version'];
const LANGUAGES = ['python', 'javascript', 'js', 'typescript', 'ts', 'rust', 'go', 'shell', 'bash', 'yaml', 'json', 'mermaid'];

export function getCompletions(line: string): CompletionItem[] {
  const items: CompletionItem[] = [];

  if (line.trimStart().startsWith('##')) {
    for (const name of SECTION_NAMES) {
      items.push({ label: name, kind: CompletionItemKind.Class, detail: 'MAM Section' });
    }
  } else if (line.includes(':') && line.trimStart().startsWith('-')) {
    for (const key of YAML_KEYS) {
      items.push({ label: key, kind: CompletionItemKind.Property, detail: 'YAML Key' });
    }
  } else if (line.includes('```')) {
    for (const lang of LANGUAGES) {
      items.push({ label: lang, kind: CompletionItemKind.Enum, detail: 'Language' });
    }
  } else {
    for (const name of SECTION_NAMES) {
      items.push({ label: `## ${name}`, kind: CompletionItemKind.Snippet, detail: 'MAM Section', insertText: `## ${name}\n\n` });
    }
  }

  return items;
}