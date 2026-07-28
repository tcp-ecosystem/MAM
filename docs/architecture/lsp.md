# LSP Architecture

> **IDE integration for MAM modules.**

---

## Overview

The Language Server Protocol (LSP) implementation provides real-time feedback and IDE features for MAM modules.

---

## Features

| Feature | Description |
|---------|-------------|
| Autocomplete | Section names, YAML keys, languages |
| Diagnostics | Parse and validation errors |
| Hover | Section documentation |
| Definition | Go to section definition |
| References | Find all references |
| Formatting | Auto-format modules |
| Code Actions | Add missing sections |

---

## LSP Structure

```
┌─────────────────────────────────────────┐
│              LSP Server                 │
├─────────────────────────────────────────┤
│  Features                              │
│  ├── CompletionProvider                │
│  ├── DiagnosticsProvider               │
│  ├── HoverProvider                     │
│  ├── DefinitionProvider                │
│  ├── ReferencesProvider                │
│  ├── DocumentFormattingProvider        │
│  └── CodeActionProvider                │
├─────────────────────────────────────────┤
│  Protocol                              │
│  ├── MAM Protocol Definitions          │
│  └── Custom Messages                   │
└─────────────────────────────────────────┘
```

---

## Server Setup

```typescript
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { MAMLSPServer } from './server';

const connection = createConnection(ProposedFeatures.all);
const server = new MAMLSPServer(connection);

connection.onInitialize(params => {
  return server.initialize(params);
});

connection.listen();
```

---

## Capabilities

```typescript
const capabilities = {
  textDocumentSync: TextDocumentSyncKind.Incremental,
  completionProvider: {
    triggerCharacters: ['#', '-', '"'],
    resolveProvider: false,
  },
  hoverProvider: true,
  definitionProvider: true,
  referencesProvider: true,
  documentFormattingProvider: true,
  codeActionProvider: {
    codeActionKinds: ['quickfix'],
  },
};
```

---

## Completion Provider

Provides auto-completion for:

### Section Names

```typescript
const SECTION_NAMES = [
  'Purpose', 'Inputs', 'Outputs', 'Rules',
  'Workflow', 'Mermaid', 'Python', 'JavaScript',
  'Prompt', 'Memory', 'Examples', 'Tests',
  'References', 'Dependencies', 'Exports',
  'Imports', 'Plugins', 'Permissions', 'Capabilities'
];
```

### YAML Keys

```typescript
const YAML_KEYS = [
  'id', 'version', 'name', 'author', 'runtime',
  'tags', 'description', 'dependencies',
  'permissions', 'license', 'repository', 'mam_version'
];
```

### Languages

```typescript
const LANGUAGES = [
  'python', 'javascript', 'typescript',
  'rust', 'go', 'shell', 'yaml', 'json', 'mermaid'
];
```

### Snippets

```typescript
const SNIPPETS = {
  'section': '## ${1:Name}\n\n${2:Content}',
  'codeblock': '```${1:python}\n${2:code}\n```',
  'table': '| ${1:Name} | ${2:Type} | ${3:Description} |\n|------|------|-------------|',
};
```

---

## Diagnostics Provider

Reports parse and validation errors:

```typescript
connection.onDidChangeContent(change => {
  const document = change.document;
  const diagnostics = server.validate(document);
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics
  });
});
```

### Diagnostic Levels

| Level | Icon | Description |
|-------|------|-------------|
| Error | ❌ | Must be fixed |
| Warning | ⚠️ | Should be fixed |
| Info | ℹ️ | Suggestion |

---

## Hover Provider

Shows documentation on hover:

```typescript
connection.onHover(params => {
  const documentation = server.getHover(params.textDocument, params.position);
  return {
    contents: {
      kind: 'markdown',
      value: documentation
    }
  };
});
```

### Hover Examples

**Section Hover:**

```markdown
## Purpose

The module's objective description.

**Required:** Yes
**Content Type:** Text
```

**YAML Key Hover:**

```markdown
`id` - Unique module identifier

**Type:** string
**Pattern:** `^[a-z][a-z0-9-]{0,63}$`
**Required:** Yes
```

---

## Definition Provider

Go to section definition:

```typescript
connection.onDefinition(params => {
  const definition = server.getDefinition(params.textDocument, params.position);
  return definition;
});
```

---

## References Provider

Find all references:

```typescript
connection.onReferences(params => {
  const references = server.getReferences(params.textDocument, params.position);
  return references;
});
```

---

## Formatting Provider

Auto-format modules:

```typescript
connection.onDocumentFormatting(params => {
  const edits = server.getFormatting(params.textDocument);
  return edits;
});
```

### Formatting Rules

1. Consistent indentation (2 spaces)
2. Blank lines between sections
3. Trailing newlines
4. Consistent code block formatting

---

## Code Actions

Quick fixes for common issues:

```typescript
connection.onCodeAction(params => {
  const actions = server.getCodeActions(params.textDocument, params.range);
  return actions;
});
```

### Available Actions

| Action | Description |
|--------|-------------|
| Add Purpose | Add missing Purpose section |
| Add Front Matter | Add missing front matter |
| Fix ID | Fix invalid ID format |
| Add Language | Add language to code block |

---

## Protocol Extensions

### Custom Messages

```typescript
// MAM-specific notifications
connection.onNotification('mam/ast', params => {
  // Handle AST request
});

connection.onNotification('mam/validate', params => {
  // Handle validation request
});
```

---

## Performance

| Operation | Target | Strategy |
|-----------|--------|----------|
| Completion | <50ms | Cached completions |
| Diagnostics | <100ms | Incremental validation |
| Hover | <50ms | Cached documentation |
| Formatting | <100ms | Incremental formatting |

---

## Example

### Input

```markdown
---
id: hello
version: 1.0.0
---

## Purp
```

### Diagnostics

```
Warning: Unknown section "Purp"
  Did you mean "Purpose"?
  at line 5
```

### Code Action

```
[Quick Fix] Rename "Purp" to "Purpose"
```

---

## References

- [AST Architecture](./ast.md)
- [Parser Architecture](./parser.md)
- [Validator Architecture](./validator.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
