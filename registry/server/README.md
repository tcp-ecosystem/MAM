# @mam/registry-server

> MAM Hub — Central module registry server for storing and distributing MAM modules

The Registry Server provides the backend API for module storage, versioning, authentication, and distribution.

## Installation

```bash
npm install @mam/registry-server
# or
pnpm add @mam/registry-server
```

## Quick Start

```typescript
import { RegistryServer } from '@mam/registry-server';

const server = new RegistryServer({
  port: 3000,
  storage: './registry-data',
  auth: {
    secret: process.env.JWT_SECRET
  }
});

await server.start();
console.log('Registry server running on port 3000');
```

## CLI Usage

```bash
# Start the server
mam-registry start

# Start with custom config
mam-registry start --port 3000 --storage ./data

# Run database migrations
mam-registry migrate

# Seed test data
mam-registry seed
```

## Features

- **Module Storage**: Store and version MAM modules
- **Authentication**: JWT-based user authentication
- **Authorization**: Role-based access control
- **Search**: Full-text search with indexing
- **Analytics**: Download statistics and metrics
- **Webhooks**: Event notifications for integrations

## API Endpoints

### Modules

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/modules` | List all modules |
| `GET` | `/api/modules/:name` | Get module info |
| `GET` | `/api/modules/:name/versions` | List versions |
| `POST` | `/api/modules` | Publish module |
| `DELETE` | `/api/modules/:name` | Delete module |

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/register` | Register user |
| `POST` | `/api/auth/login` | Login |
| `POST` | `/api/auth/refresh` | Refresh token |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search` | Search modules |
| `GET` | `/api/search/popular` | Popular modules |

## Configuration

```typescript
interface ServerConfig {
  port: number;
  storage: string;
  auth: {
    secret: string;
    expiresIn?: string;
  };
  database?: {
    host: string;
    port: number;
    name: string;
  };
  cache?: {
    driver: 'redis' | 'memory';
    url?: string;
  };
}
```

## License

MIT
