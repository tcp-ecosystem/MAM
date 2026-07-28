# MAM JavaScript SDK

JavaScript/TypeScript SDK for MAM (Markdown as Module).

## Installation

```bash
npm install @mam/sdk-javascript
```

## Usage

```typescript
import { parseMAM, MAMModule } from '@mam/sdk-javascript';

// Parse MAM content
const result = parseMAM(content);

// Create a module
const module = new MAMModule({ name: 'my-module', version: '1.0.0' });
```
