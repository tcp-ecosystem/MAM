# Plugins Guide

> **Extending MAM with custom plugins.**

---

## Overview

MAM's plugin system allows you to add new section types, validation rules, execution contexts, and export formats. This guide covers plugin development.

---

## Plugin Interface

```typescript
interface MAMPlugin {
  name: string;
  version: string;
  description?: string;
  
  // Section registration
  sections?: SectionDefinition[];
  
  // Validation rules
  rules?: ValidationRule[];
  
  // Runtime contexts
  contexts?: ExecutionContext[];
  
  // Exporters
  exporters?: Exporter[];
  
  // Renderers
  renderers?: Renderer[];
}
```

---

## Plugin Types

### Section Plugins

Add new section types:

```typescript
const myPlugin: MAMPlugin = {
  name: 'my-section',
  version: '1.0.0',
  sections: [
    {
      name: 'MySection',
      description: 'A custom section type',
      required: false,
      contentTypes: ['text', 'list'],
      validator: (content) => {
        // Validate content
        return [];
      }
    }
  ]
};
```

### Validation Plugins

Add custom validation rules:

```typescript
const validationPlugin: MAMPlugin = {
  name: 'my-validation',
  version: '1.0.0',
  rules: [
    {
      name: 'no-hardcoded-secrets',
      description: 'Ensure no hardcoded secrets',
      severity: 'error',
      check: (ast) => {
        const errors: ValidationError[] = [];
        // Check for hardcoded secrets
        return errors;
      }
    }
  ]
};
```

### Runtime Plugins

Add execution contexts:

```typescript
const runtimePlugin: MAMPlugin = {
  name: 'my-runtime',
  version: '1.0.0',
  contexts: [
    {
      language: 'python',
      execute: async (code, inputs) => {
        // Execute Python code
        return { success: true, output: 'result' };
      }
    }
  ]
};
```

### Export Plugins

Add output formats:

```typescript
const exportPlugin: MAMPlugin = {
  name: 'my-export',
  version: '1.0.0',
  exporters: [
    {
      format: 'pdf',
      export: (ast) => {
        // Generate PDF
        return Buffer.from('pdf content');
      }
    }
  ]
};
```

---

## Creating a Plugin

### Step 1: Initialize Plugin

```bash
mam init --template plugin
```

This creates:

```
my-plugin/
├── src/
│   └── index.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Step 2: Implement Plugin

```typescript
// src/index.ts
import { MAMPlugin, SectionDefinition } from '@mam/plugin-api';

const myPlugin: MAMPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My custom MAM plugin',
  
  sections: [
    {
      name: 'CustomSection',
      description: 'A custom section',
      required: false,
      contentTypes: ['text']
    }
  ],
  
  rules: [
    {
      name: 'custom-rule',
      description: 'My custom validation rule',
      severity: 'warning',
      check: (ast) => {
        // Custom validation logic
        return [];
      }
    }
  ]
};

export default myPlugin;
```

### Step 3: Build Plugin

```bash
npm run build
```

### Step 4: Test Plugin

```bash
npm test
```

---

## Plugin Loading

Plugins are loaded from multiple sources:

1. **Built-in plugins** — Core MAM plugins
2. **Project plugins** — `.mam/plugins/` directory
3. **Global plugins** — `~/.mam/plugins/` directory
4. **Registry plugins** — Installed from registry

### Loading Order

```
Built-in → Project → Global → Registry
```

### Plugin Configuration

In `mam.config.json`:

```json
{
  "plugins": [
    "my-plugin",
    "@mam/plugin-mermaid",
    "./local-plugin"
  ]
}
```

---

## Hook System

Plugins can hook into the MAM lifecycle:

```typescript
interface PluginHooks {
  beforeParse?: (content: string) => string;
  afterParse?: (ast: MAMModule) => MAMModule;
  beforeValidate?: (ast: MAMModule) => MAMModule;
  afterValidate?: (report: ValidationReport) => ValidationReport;
  beforeExecute?: (context: ExecutionContext) => ExecutionContext;
  afterExecute?: (result: ExecutionResult) => ExecutionResult;
  onError?: (error: Error) => void;
}
```

### Hook Example

```typescript
const loggingPlugin: MAMPlugin = {
  name: 'logging',
  version: '1.0.0',
  hooks: {
    beforeParse: (content) => {
      console.log('Parsing module...');
      return content;
    },
    afterParse: (ast) => {
      console.log(`Parsed ${ast.sections.length} sections`);
      return ast;
    },
    onError: (error) => {
      console.error('Error:', error.message);
    }
  }
};
```

---

## Plugin Registry

### Publishing Plugins

```bash
mam publish --plugin
```

### Installing Plugins

```bash
mam install @mam/plugin-name
```

### Listing Plugins

```bash
mam plugins list
```

---

## Example Plugins

### YAML Validator Plugin

```typescript
const yamlValidator: MAMPlugin = {
  name: 'yaml-validator',
  version: '1.0.0',
  rules: [
    {
      name: 'valid-yaml',
      description: 'Ensure valid YAML in front matter',
      severity: 'error',
      check: (ast) => {
        const errors: ValidationError[] = [];
        
        if (!ast.frontmatter) {
          errors.push({
            type: 'error',
            code: 'FRONTMATTER_MISSING',
            message: 'Front matter is required'
          });
        }
        
        return errors;
      }
    }
  ]
};
```

### Mermaid Renderer Plugin

```typescript
const mermaidRenderer: MAMPlugin = {
  name: 'mermaid-renderer',
  version: '1.0.0',
  renderers: [
    {
      language: 'mermaid',
      render: (code) => {
        // Render Mermaid to SVG
        return `<svg>...</svg>`;
      }
    }
  ]
};
```

---

## Best Practices

### 1. Keep Plugins Focused

Each plugin should do one thing well.

### 2. Follow Naming Conventions

Use `@mam/plugin-name` for official plugins.

### 3. Write Tests

```typescript
describe('My Plugin', () => {
  it('should validate correctly', () => {
    const plugin = myPlugin;
    const errors = plugin.rules[0].check(mockAST);
    expect(errors).toHaveLength(0);
  });
});
```

### 4. Document Your Plugin

Provide clear README with examples.

### 5. Handle Errors Gracefully

```typescript
check: (ast) => {
  try {
    // Validation logic
    return [];
  } catch (error) {
    return [{
      type: 'error',
      code: 'PLUGIN_ERROR',
      message: error.message
    }];
  }
}
```

---

## References

- [Plugin API](../api/sdk.md)
- [Architecture](../architecture/overview.md)

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
