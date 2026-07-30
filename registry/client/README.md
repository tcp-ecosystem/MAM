# @mam/registry-client

> Client library for interacting with the MAM module registry

The Registry Client provides a programmatic interface for publishing, searching, and downloading MAM modules from the central registry.

## Installation

```bash
npm install @mam/registry-client
# or
pnpm add @mam/registry-client
```

## Quick Start

```typescript
import { RegistryClient } from '@mam/registry-client';

const client = new RegistryClient();

// Search for modules
const results = await client.search('authentication');

// Download a module
const module = await client.download('@mam/plugin-auth');

// Publish a module
await client.publish('./my-module', {
  name: '@mam/plugin-custom',
  version: '1.0.0'
});
```

## CLI Usage

```bash
# Search registry
mam search auth

# Install from registry
mam install @mam/plugin-auth

# Publish to registry
mam publish ./my-module

# Login to registry
mam login

# View module info
mam info @mam/plugin-auth
```

## Features

- **Search**: Full-text search across registry modules
- **Download**: Pull modules with dependency resolution
- **Publish**: Push modules to registry with validation
- **Authentication**: Secure token-based authentication
- **Versioning**: Semantic version support
- **Caching**: Local cache for faster installs

## API

### `RegistryClient`

```typescript
class RegistryClient {
  constructor(options?: RegistryOptions);
  
  search(query: string): Promise<SearchResult[]>;
  download(name: string, version?: string): Promise<Module>;
  publish(path: string, options: PublishOptions): Promise<void>;
  login(): Promise<void>;
  logout(): void;
  info(name: string): Promise<ModuleInfo>;
}
```

### `RegistryOptions`

```typescript
interface RegistryOptions {
  registryUrl?: string;
  authToken?: string;
  cacheDir?: string;
}
```

### `SearchResult`

```typescript
interface SearchResult {
  name: string;
  version: string;
  description: string;
  author: string;
  downloads: number;
  keywords: string[];
}
```

### `PublishOptions`

```typescript
interface PublishOptions {
  name: string;
  version: string;
  description?: string;
  keywords?: string[];
}
```

## Configuration

Set registry URL and token:

```typescript
const client = new RegistryClient({
  registryUrl: 'https://registry.mam.dev',
  authToken: process.env.MAM_REGISTRY_TOKEN,
  cacheDir: './node_modules/.cache'
});
```

Or via environment variables:

```bash
MAM_REGISTRY_URL=https://registry.mam.dev
MAM_REGISTRY_TOKEN=your-token-here
```

## License

MIT
