# @mam/cli

> Production-grade command-line interface for MAM (Markdown as Module)

The MAM CLI provides 35 commands for creating, compiling, validating, testing, and managing MAM modules and projects.

## Installation

```bash
npm install -g @mam/cli
# or
pnpm add -g @mam/cli
```

## Quick Start

```bash
# Initialize a new MAM project
mam init my-project

# Create a new module
mam create module auth-system

# Compile a module to Python
mam compile auth-system.mam.md --target python

# Validate a module
mam validate auth-system.mam.md

# Run module tests
mam test auth-system.mam.md
```

## Commands Overview

### Core Commands

| Command | Description |
|---------|-------------|
| `mam init` | Initialize a new MAM project |
| `mam create` | Create modules, plugins, or templates |
| `mam compile` | Compile MAM to target language |
| `mam validate` | Validate module syntax and semantics |
| `mam test` | Run module test suites |
| `mam build` | Build project and dependencies |

### Module Management

| Command | Description |
|---------|-------------|
| `mam info` | Display module metadata |
| `mam deps` | List module dependencies |
| `mam graph` | Show dependency graph |
| `mam cache` | Manage build cache |
| `mam clean` | Remove build artifacts |

### Registry & Packages

| Command | Description |
|---------|-------------|
| `mam publish` | Publish module to registry |
| `mam install` | Install module dependencies |
| `mam search` | Search registry for modules |
| `mam login` | Authenticate with registry |
| `mam logout` | Sign out of registry |

### Development Tools

| Command | Description |
|---------|-------------|
| `mam watch` | Watch for file changes |
| `mam dev` | Start development server |
| `mam lint` | Lint MAM files |
| `mam format` | Format MAM files |
| `mam repl` | Start interactive REPL |

### Visualization & Export

| Command | Description |
|---------|-------------|
| `mam visualize` | Render module as diagram |
| `mam export` | Export to various formats |
| `mam diff` | Compare module versions |
| `mam merge` | Merge module changes |
| `mam snapshot` | Create module snapshot |

## Usage Examples

### Compiling to Multiple Targets

```bash
mam compile pipeline.mam.md --target python
mam compile pipeline.mam.md --target javascript
mam compile pipeline.mam.md --target openai
```

### Validation with Strict Mode

```bash
mam validate module.mam.md --strict
mam validate module.mam.md --format json
```

### Project Initialization

```bash
mam init my-ai-system --template agent
mam init my-pipeline --template pipeline
mam init my-api --template api
```

## Configuration

The CLI reads configuration from `mam.config.json`:

```json
{
  "defaultTarget": "python",
  "strict": true,
  "outputDir": "./dist",
  "registry": "https://registry.mam.dev"
}
```

## API

```typescript
import { MAMCli } from '@mam/cli';

const cli = new MAMCli();
await cli.compile('module.mam.md', { target: 'python' });
```

## License

MIT
