# @mam/package-manager

> MAMP — MAM Package Manager for dependency resolution and module distribution

MAMP handles dependency resolution, version management, and module distribution for MAM projects.

## Installation

```bash
npm install @mam/package-manager
# or
pnpm add @mam/package-manager
```

## Quick Start

```typescript
import { MAMP } from '@mam/package-manager';

const mamp = new MAMP();

// Install dependencies
await mamp.install();

// Add a dependency
await mamp.add('@mam/plugin-auth');

// Remove a dependency
await mamp.remove('@mam/plugin-auth');

// Update dependencies
await mamp.update();
```

## CLI Usage

```bash
# Install all dependencies
mamp install

# Add a dependency
mamp add @mam/plugin-auth

# Remove a dependency
mamp remove @mam/plugin-auth

# Update all dependencies
mamp update

# Check for outdated dependencies
mamp outdated

# Audit dependencies for vulnerabilities
mamp audit
```

## Features

- **Dependency Resolution**: Automatic conflict resolution
- **Version Locking**: Reproducible builds via lock files
- **Workspace Support**: Monorepo-friendly package management
- **Registry Integration**: Seamless registry publishing
- **Cache Management**: Efficient local caching

## Configuration

Configure in `mam.config.json`:

```json
{
  "dependencies": {
    "@mam/plugin-auth": "^1.0.0",
    "@mam/plugin-memory": "^0.5.0"
  },
  "devDependencies": {
    "@mam/testing": "^1.0.0"
  },
  "registry": "https://registry.mam.dev",
  "cache": "./node_modules/.cache"
}
```

## API

### `MAMP`

```typescript
class MAMP {
  install(): Promise<void>;
  add(name: string, version?: string): Promise<void>;
  remove(name: string): Promise<void>;
  update(): Promise<void>;
  list(): Dependency[];
  outdated(): OutdatedDependency[];
  audit(): AuditResult;
}
```

### `Dependency`

```typescript
interface Dependency {
  name: string;
  version: string;
  resolved: string;
  integrity: string;
}
```

## License

MIT
