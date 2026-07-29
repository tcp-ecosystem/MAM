# JavaScript Section

## Description
The JavaScript section contains JavaScript/TypeScript code blocks for execution. It defines executable code that runs in a JavaScript runtime environment (Node.js, Deno, Bun, or browser). This section is critical for modules that need to execute JavaScript code, interact with web technologies, or leverage the JavaScript ecosystem.

The JavaScript section supports:
- **JavaScript (ES6+)**: Modern JavaScript with ES modules
- **TypeScript**: Typed JavaScript with compile-time checking
- **JSX/TSX**: React component syntax
- **Node.js**: Server-side JavaScript
- **Deno**: Secure JavaScript runtime
- **Bun**: Fast JavaScript runtime

## Syntax

```markdown
## JavaScript

```javascript
// JavaScript code here
function process(input) {
    return result;
}
```
```

### Language Identifiers

| Identifier | Runtime | Description |
|------------|---------|-------------|
| `javascript` | Any | Standard JavaScript |
| `js` | Any | JavaScript shorthand |
| `typescript` | Any | TypeScript with types |
| `ts` | Any | TypeScript shorthand |
| `jsx` | React | React JSX syntax |
| `tsx` | React | TypeScript JSX |
| `node` | Node.js | Node.js-specific |
| `deno` | Deno | Deno-specific |
| `bun` | Bun | Bun-specific |

### Code Block Format

```markdown
## JavaScript

```javascript
// @mam:runtime=node
// @mam:version=20+
// @mam:timeout=30s

import { createServer } from 'http';

const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
});

server.listen(3000);
```
```

## Rules

1. **Language identifier**: Must specify language (javascript, js, typescript, ts)
2. **Valid syntax**: Code must be syntactically valid
3. **Runtime compatibility**: Code must target specified runtime
4. **No side effects**: Code should not have unintended side effects
5. **Error handling**: Include proper error handling
6. **No secrets**: Never include secrets or API keys
7. **Use metadata**: Use `@mam:` comments for execution hints

### Metadata Comments

```javascript
// @mam:runtime=node
// @mam:version=20+
// @mam:timeout=30s
// @mam:memory=256MB
// @mam:requires=express
// @mam:env=NODE_ENV
```

### Code Quality Rules

| Rule | Good | Bad |
|------|------|-----|
| Use strict mode | `'use strict'` | (missing) |
| Handle errors | `try/catch` | (no handling) |
| Use const/let | `const x = 1` | `var x = 1` |
| Avoid eval | `JSON.parse()` | `eval()` |
| Use async/await | `await fetch()` | `.then()` chains |

## Description

The JavaScript section provides executable code blocks for JavaScript runtimes:

### 1. Basic Functions

Simple JavaScript functions:

```javascript
function greet(name) {
    return `Hello, ${name}!`;
}

function add(a, b) {
    return a + b;
}

module.exports = { greet, add };
```

### 2. ES6 Modules

Modern ES module syntax:

```javascript
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';

export function serve(staticDir) {
    const server = createServer(async (req, res) => {
        const filePath = path.join(staticDir, req.url);
        const content = await readFile(filePath);
        res.end(content);
    });
    
    return server;
}
```

### 3. TypeScript

TypeScript with type annotations:

```typescript
interface User {
    id: string;
    name: string;
    email: string;
    createdAt: Date;
}

interface CreateUserDTO {
    name: string;
    email: string;
}

export function createUser(dto: CreateUserDTO): User {
    return {
        id: crypto.randomUUID(),
        ...dto,
        createdAt: new Date()
    };
}

export function validateUser(user: Partial<User>): boolean {
    return Boolean(user.name && user.email);
}
```

### 4. Async/Await

Asynchronous code:

```javascript
async function fetchUserData(userId) {
    try {
        const response = await fetch(`https://api.example.com/users/${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch user:', error);
        throw error;
    }
}

async function processUsers(userIds) {
    const results = await Promise.all(
        userIds.map(id => fetchUserData(id))
    );
    return results;
}
```

### 5. Class-based Code

Object-oriented JavaScript:

```javascript
class ApiClient {
    #baseUrl;
    #apiKey;
    #timeout;
    
    constructor(config) {
        this.#baseUrl = config.baseUrl;
        this.#apiKey = config.apiKey;
        this.#timeout = config.timeout || 30000;
    }
    
    async request(method, path, data = null) {
        const url = new URL(path, this.#baseUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.#timeout);
        
        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Authorization': `Bearer ${this.#apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: data ? JSON.stringify(data) : null,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
    
    get(path) {
        return this.request('GET', path);
    }
    
    post(path, data) {
        return this.request('POST', path, data);
    }
    
    put(path, data) {
        return this.request('PUT', path, data);
    }
    
    delete(path) {
        return this.request('DELETE', path);
    }
}

export default ApiClient;
```

### 6. React Components

JSX/TSX React components:

```tsx
import React, { useState, useEffect } from 'react';

interface User {
    id: string;
    name: string;
    email: string;
}

interface UserListProps {
    apiUrl: string;
    onSelect?: (user: User) => void;
}

export function UserList({ apiUrl, onSelect }: UserListProps) {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        fetch(apiUrl)
            .then(res => res.json())
            .then(data => {
                setUsers(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [apiUrl]);
    
    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;
    
    return (
        <ul>
            {users.map(user => (
                <li 
                    key={user.id}
                    onClick={() => onSelect?.(user)}
                    style={{ cursor: 'pointer' }}
                >
                    {user.name} ({user.email})
                </li>
            ))}
        </ul>
    );
}
```

### 7. Express.js Server

Node.js Express server:

```javascript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/users', async (req, res) => {
    try {
        const { name, email } = req.body;
        
        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email required' });
        }
        
        const user = await createUser({ name, email });
        res.status(201).json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await getUser(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

export default app;
```

### 8. Utility Functions

Common utility functions:

```javascript
// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Throttle function
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// Deep clone
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    
    if (obj instanceof Array) {
        return obj.map(item => deepClone(item));
    }
    
    if (obj instanceof Object) {
        const copy = {};
        Object.keys(obj).forEach(key => {
            copy[key] = deepClone(obj[key]);
        });
        return copy;
    }
    
    return obj;
}

// Promise with timeout
function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
    
    return Promise.race([promise, timeout]);
}

export { debounce, throttle, deepClone, withTimeout };
```

### 9. Data Processing

Data manipulation functions:

```javascript
// Array utilities
function chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function unique(array, keyFn) {
    const seen = new Set();
    return array.filter(item => {
        const key = keyFn ? keyFn(item) : item;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function groupBy(array, keyFn) {
    return array.reduce((groups, item) => {
        const key = keyFn(item);
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
        return groups;
    }, {});
}

// Object utilities
function pick(obj, keys) {
    return keys.reduce((result, key) => {
        if (key in obj) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

function omit(obj, keys) {
    return Object.keys(obj).reduce((result, key) => {
        if (!keys.includes(key)) {
            result[key] = obj[key];
        }
        return result;
    }, {});
}

export { chunk, unique, groupBy, pick, omit };
```

### 10. Error Handling

Error handling patterns:

```javascript
// Custom error class
class AppError extends Error {
    constructor(message, code, statusCode = 500) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

// Error handler
function handleError(error, req, res, next) {
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({
            error: {
                message: error.message,
                code: error.code
            }
        });
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: {
            message: 'Internal server error',
            code: 'INTERNAL_ERROR'
        }
    });
}

// Async handler wrapper
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

export { AppError, handleError, asyncHandler };
```

## Edge Cases

### 1. Module System Confusion

When mixing CommonJS and ES modules:

```javascript
// CommonJS
const express = require('express');

// ES Module
import express from 'express';
```

**Solution**: Use consistent module system.

### 2. Async/Await Errors

When async errors aren't properly caught:

```javascript
// Bad
async function fetchData() {
    const response = await fetch(url);  // Unhandled rejection
}

// Good
async function fetchData() {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('Fetch failed:', error);
        throw error;
    }
}
```

### 3. Memory Leaks

When event listeners aren't cleaned up:

```javascript
// Bad
function setup() {
    window.addEventListener('resize', handleResize);
}

// Good
function setup() {
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
}
```

### 4. Variable Scope

When using `var` in blocks:

```javascript
// Bad
for (var i = 0; i < 10; i++) {
    setTimeout(() => console.log(i), 100);  // Prints 10 ten times
}

// Good
for (let i = 0; i < 10; i++) {
    setTimeout(() => console.log(i), 100);  // Prints 0-9
}
```

### 5. Type Coercion

When JavaScript coerces types:

```javascript
// Bad
'' == false  // true
0 == ''      // true
null == undefined  // true

// Good
'' === false  // false
0 === ''      // false
null === undefined  // false
```

### 6. Promise Chaining

When promise chains get unwieldy:

```javascript
// Bad
fetchUser(id)
    .then(user => fetchOrders(user.id))
    .then(orders => processOrders(orders))
    .then(result => saveResult(result))
    .catch(handleError);

// Good
async function process(id) {
    try {
        const user = await fetchUser(id);
        const orders = await fetchOrders(user.id);
        const result = await processOrders(orders);
        return await saveResult(result);
    } catch (error) {
        handleError(error);
    }
}
```

### 7. This Binding

When `this` context is lost:

```javascript
// Bad
class Component {
    constructor() {
        this.state = {};
        setInterval(function() {
            this.setState({});  // `this` is wrong
        }, 1000);
    }
}

// Good
class Component {
    constructor() {
        this.state = {};
        setInterval(() => {
            this.setState({});  // `this` is correct
        }, 1000);
    }
}
```

### 8. Prototype Pollution

When objects are vulnerable to prototype pollution:

```javascript
// Bad
function merge(target, source) {
    for (let key in source) {
        if (typeof source[key] === 'object') {
            target[key] = merge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

// Good
function merge(target, source) {
    const result = { ...target };
    for (let key in source) {
        if (key === '__proto__' || key === 'constructor') {
            continue;  // Skip dangerous keys
        }
        if (typeof source[key] === 'object') {
            result[key] = merge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}
```

### 9. Event Loop Blocking

When synchronous operations block the event loop:

```javascript
// Bad
function readFile(path) {
    const fs = require('fs');
    return fs.readFileSync(path);  // Blocks event loop
}

// Good
async function readFile(path) {
    const fs = require('fs/promises');
    return await fs.readFile(path);  // Non-blocking
}
```

### 10. Error Information Leakage

When errors expose sensitive information:

```javascript
// Bad
app.use((err, req, res, next) => {
    res.status(500).json({
        error: err.message,
        stack: err.stack  // Leaks implementation details
    });
});

// Good
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({
        error: 'Internal server error'
    });
});
```

## Best Practices

### 1. Use Strict Mode

Always enable strict mode:

```javascript
'use strict';

// Or use modules (automatically strict)
import { something } from 'module';
```

### 2. Use const and let

Avoid `var`, use `const` and `let`:

```javascript
// Bad
var x = 1;

// Good
const x = 1;  // For constants
let y = 2;    // For variables
```

### 3. Use Arrow Functions

Use arrow functions for callbacks:

```javascript
// Bad
[1, 2, 3].map(function(x) {
    return x * 2;
});

// Good
[1, 2, 3].map(x => x * 2);
```

### 4. Use Destructuring

Use destructuring for objects and arrays:

```javascript
// Bad
const name = user.name;
const email = user.email;

// Good
const { name, email } = user;
```

### 5. Use Template Literals

Use template literals instead of string concatenation:

```javascript
// Bad
const message = 'Hello, ' + name + '!';

// Good
const message = `Hello, ${name}!`;
```

### 6. Use Optional Chaining

Use optional chaining for nested properties:

```javascript
// Bad
const city = user && user.address && user.address.city;

// Good
const city = user?.address?.city;
```

### 7. Use Nullish Coalescing

Use nullish coalescing for default values:

```javascript
// Bad
const value = data !== null && data !== undefined ? data : defaultValue;

// Good
const value = data ?? defaultValue;
```

### 8. Use async/await

Prefer async/await over promise chains:

```javascript
// Bad
fetchData()
    .then(data => process(data))
    .then(result => save(result))
    .catch(handleError);

// Good
try {
    const data = await fetchData();
    const result = await process(data);
    await save(result);
} catch (error) {
    handleError(error);
}
```

### 9. Handle Errors Properly

Always handle errors in async code:

```javascript
// Bad
async function fetchData() {
    const response = await fetch(url);  // Unhandled rejection
}

// Good
async function fetchData() {
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('Fetch failed:', error);
        throw error;
    }
}
```

### 10. Use TypeScript

Use TypeScript for better type safety:

```typescript
// JavaScript
function add(a, b) {
    return a + b;
}

// TypeScript
function add(a: number, b: number): number {
    return a + b;
}
```

## Common Patterns

### Pattern 1: Module Pattern

```javascript
const MyModule = (() => {
    let privateVar = 0;
    
    function privateMethod() {
        privateVar++;
    }
    
    return {
        publicMethod() {
            privateMethod();
            return privateVar;
        }
    };
})();

export default MyModule;
```

### Pattern 2: Factory Pattern

```javascript
function createApiClient(config) {
    const { baseUrl, apiKey, timeout = 30000 } = config;
    
    async function request(method, path, data) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: data ? JSON.stringify(data) : null
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }
    
    return {
        get: (path) => request('GET', path),
        post: (path, data) => request('POST', path, data),
        put: (path, data) => request('PUT', path, data),
        delete: (path) => request('DELETE', path)
    };
}

export default createApiClient;
```

### Pattern 3: Observer Pattern

```javascript
class EventEmitter {
    constructor() {
        this.events = new Map();
    }
    
    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, []);
        }
        this.events.get(event).push(callback);
        return () => this.off(event, callback);
    }
    
    off(event, callback) {
        if (!this.events.has(event)) {
            return;
        }
        const callbacks = this.events.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }
    
    emit(event, ...args) {
        if (!this.events.has(event)) {
            return;
        }
        this.events.get(event).forEach(callback => {
            callback(...args);
        });
    }
}

export default EventEmitter;
```

### Pattern 4: Singleton Pattern

```javascript
class Database {
    static instance = null;
    
    constructor() {
        if (Database.instance) {
            return Database.instance;
        }
        this.connection = null;
        Database.instance = this;
    }
    
    async connect(url) {
        if (this.connection) {
            return this.connection;
        }
        this.connection = await createConnection(url);
        return this.connection;
    }
    
    async query(sql, params) {
        if (!this.connection) {
            throw new Error('Not connected');
        }
        return this.connection.query(sql, params);
    }
    
    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }
}

export default Database;
```

### Pattern 5: Middleware Pattern

```javascript
function createMiddleware() {
    const middlewares = [];
    
    function use(middleware) {
        middlewares.push(middleware);
        return this;
    }
    
    async function execute(context) {
        let index = 0;
        
        async function next() {
            if (index < middlewares.length) {
                const middleware = middlewares[index++];
                await middleware(context, next);
            }
        }
        
        await next();
        return context;
    }
    
    return { use, execute };
}

export default createMiddleware;
```

### Pattern 6: Builder Pattern

```javascript
class QueryBuilder {
    constructor() {
        this.table = null;
        this.conditions = [];
        this.fields = [];
        this.orderByField = null;
        this.limitValue = null;
    }
    
    from(table) {
        this.table = table;
        return this;
    }
    
    select(...fields) {
        this.fields = fields;
        return this;
    }
    
    where(condition) {
        this.conditions.push(condition);
        return this;
    }
    
    orderBy(field, direction = 'ASC') {
        this.orderByField = { field, direction };
        return this;
    }
    
    limit(value) {
        this.limitValue = value;
        return this;
    }
    
    build() {
        let query = `SELECT ${this.fields.join(', ')} FROM ${this.table}`;
        
        if (this.conditions.length > 0) {
            query += ` WHERE ${this.conditions.join(' AND ')}`;
        }
        
        if (this.orderByField) {
            query += ` ORDER BY ${this.orderByField.field} ${this.orderByField.direction}`;
        }
        
        if (this.limitValue) {
            query += ` LIMIT ${this.limitValue}`;
        }
        
        return query;
    }
}

export default QueryBuilder;
```

### Pattern 7: Decorator Pattern

```javascript
function withLogging(fn) {
    return function(...args) {
        console.log(`Calling ${fn.name} with`, args);
        const result = fn.apply(this, args);
        console.log(`${fn.name} returned`, result);
        return result;
    };
}

function withTiming(fn) {
    return function(...args) {
        const start = performance.now();
        const result = fn.apply(this, args);
        const end = performance.now();
        console.log(`${fn.name} took ${end - start}ms`);
        return result;
    };
}

function withRetry(fn, maxRetries = 3) {
    return async function(...args) {
        let lastError;
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn.apply(this, args);
            } catch (error) {
                lastError = error;
                console.log(`Retry ${i + 1}/${maxRetries} failed`);
            }
        }
        throw lastError;
    };
}

export { withLogging, withTiming, withRetry };
```

### Pattern 8: Proxy Pattern

```javascript
function createValidator(schema) {
    return new Proxy({}, {
        set(target, prop, value) {
            if (schema[prop]) {
                const isValid = schema[prop](value);
                if (!isValid) {
                    throw new Error(`Invalid value for ${prop}`);
                }
            }
            target[prop] = value;
            return true;
        },
        get(target, prop) {
            return target[prop];
        }
    });
}

const userValidator = createValidator({
    name: (value) => typeof value === 'string' && value.length > 0,
    age: (value) => typeof value === 'number' && value >= 0,
    email: (value) => typeof value === 'string' && value.includes('@')
});

export default createValidator;
```

### Pattern 9: Chain of Responsibility

```javascript
class Handler {
    constructor() {
        this.next = null;
    }
    
    setNext(handler) {
        this.next = handler;
        return handler;
    }
    
    async handle(request) {
        if (this.next) {
            return this.next.handle(request);
        }
        return null;
    }
}

class AuthHandler extends Handler {
    async handle(request) {
        if (!request.user) {
            throw new Error('Unauthorized');
        }
        return super.handle(request);
    }
}

class ValidationHandler extends Handler {
    async handle(request) {
        if (!request.data) {
            throw new Error('Invalid data');
        }
        return super.handle(request);
    }
}

export { Handler, AuthHandler, ValidationHandler };
```

### Pattern 10: State Machine

```javascript
class StateMachine {
    constructor(initialState, states) {
        this.currentState = initialState;
        this.states = states;
    }
    
    transition(event) {
        const state = this.states[this.currentState];
        if (!state || !state[event]) {
            throw new Error(`Invalid transition: ${this.currentState} -> ${event}`);
        }
        this.currentState = state[event];
        return this.currentState;
    }
    
    getState() {
        return this.currentState;
    }
}

const orderStates = {
    pending: {
        submit: 'processing',
        cancel: 'cancelled'
    },
    processing: {
        complete: 'completed',
        fail: 'failed'
    },
    completed: {},
    failed: {
        retry: 'processing'
    },
    cancelled: {}
};

export { StateMachine, orderStates };
```

## Validation Rules

### Rule 1: Valid Syntax

Code must be syntactically valid:

```javascript
function validateSyntax(code) {
    try {
        new Function(code);
        return true;
    } catch (error) {
        return false;
    }
}
```

### Rule 2: No Secrets

Code must not contain secrets:

```javascript
function checkSecrets(code) {
    const patterns = [
        /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
        /secret\s*[:=]\s*['"][^'"]+['"]/i,
        /password\s*[:=]\s*['"][^'"]+['"]/i,
        /token\s*[:=]\s*['"][^'"]+['"]/i
    ];
    
    return patterns.some(pattern => pattern.test(code));
}
```

### Rule 3: No Eval

Code must not use eval:

```javascript
function checkEval(code) {
    return code.includes('eval(') || code.includes('new Function(');
}
```

### Rule 4: No With Statement

Code must not use with statement:

```javascript
function checkWith(code) {
    return code.includes('with (') || code.includes('with(');
}
```

### Rule 5: Valid Imports

Imports must be valid:

```javascript
function checkImports(code) {
    const importRegex = /import\s+.*?\s+from\s+['"][^'"]+['"]/g;
    const requireRegex = /require\s*\(\s*['"][^'"]+['"]\s*\)/g;
    
    const imports = code.match(importRegex) || [];
    const requires = code.match(requireRegex) || [];
    
    return [...imports, ...requires];
}
```

## Related Sections

- **[Python](python.md)**: Python code blocks
- **[Imports](imports.md)**: Import declarations
- **[Exports](exports.md)**: Public interface
- **[Tests](tests.md)**: Test cases
- **[Dependencies](dependencies.md)**: Package dependencies
- **[Workflow](workflow.md)**: Process flow

## FAQ

### Q: Should I use JavaScript or TypeScript?

**A:** TypeScript is recommended for better type safety and documentation. Use JavaScript for simple scripts or when types aren't needed.

### Q: Can I use React/JSX?

**A:** Yes, use `jsx` or `tsx` language identifiers:

```markdown
```jsx
function Component() {
    return <div>Hello</div>;
}
```
```

### Q: How do I handle module systems?

**A:** Use ES modules (import/export) for modern code. Use CommonJS (require/module.exports) for legacy Node.js.

### Q: Can I use async/await?

**A:** Yes, async/await is supported in modern JavaScript runtimes.

### Q: How do I handle errors?

**A:** Use try/catch for async code:

```javascript
try {
    const result = await asyncOperation();
} catch (error) {
    console.error(error);
}
```

### Q: Can I use private class fields?

**A:** Yes, use `#` prefix for private fields:

```javascript
class MyClass {
    #privateField = 0;
    
    #privateMethod() {}
}
```

### Q: How do I handle TypeScript types?

**A:** Define interfaces and types:

```typescript
interface User {
    id: string;
    name: string;
}

function getUser(): User {
    return { id: '1', name: 'John' };
}
```

### Q: Can I use modern JavaScript features?

**A:** Yes, use modern features like optional chaining, nullish coalescing, etc.

### Q: How do I handle module imports?

**A:** Use ES module syntax:

```javascript
import { something } from 'module';
export { something };
```

### Q: Can I use Node.js-specific APIs?

**A:** Yes, use `node` language identifier and document runtime requirements.

### Q: How do I handle asynchronous code?

**A:** Use async/await or Promises:

```javascript
async function fetchData() {
    const response = await fetch(url);
    return response.json();
}
```

### Q: Can I use decorators?

**A:** Not natively in JavaScript. Use TypeScript with experimental decorators or wrapper functions.

### Q: How do I handle classes?

**A:** Use ES6 class syntax:

```javascript
class MyClass {
    constructor() {}
    method() {}
}
```

### Q: Can I use generators?

**A:** Yes, use function* syntax:

```javascript
function* generator() {
    yield 1;
    yield 2;
}
```

### Q: How do I handle promises?

**A:** Use async/await or .then() chains:

```javascript
// async/await
const result = await fetchData();

// Promise chain
fetchData()
    .then(result => process(result))
    .catch(error => handleError(error));
```

### Q: Can I use iterators?

**A:** Yes, implement Symbol.iterator:

```javascript
class Iterable {
    [Symbol.iterator]() {
        let index = 0;
        const items = this.items;
        
        return {
            next() {
                return index < items.length
                    ? { value: items[index++], done: false }
                    : { done: true };
            }
        };
    }
}
```

### Q: How do I handle modules?

**A:** Use ES modules:

```javascript
// Export
export function myFunction() {}
export default class MyClass {}

// Import
import MyClass, { myFunction } from './module.js';
```

### Q: Can I use optional chaining?

**A:** Yes, use `?.` syntax:

```javascript
const city = user?.address?.city;
const value = obj?.method?.();
```

### Q: How do I handle async iterators?

**A:** Use async generators:

```javascript
async function* asyncGenerator() {
    yield await Promise.resolve(1);
    yield await Promise.resolve(2);
}
```

### Q: Can I use top-level await?

**A:** Yes, in ES modules:

```javascript
// In ES module
const response = await fetch(url);
const data = await response.json();
```

## Implementation Notes

### Code Extraction

```javascript
function extractCodeBlocks(content) {
    const blocks = [];
    const regex = /```(?:javascript|js|typescript|ts|jsx|tsx)\n([\s\S]*?)```/g;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
        blocks.push({
            language: match[0].split('\n')[0].replace('```', ''),
            code: match[1]
        });
    }
    
    return blocks;
}
```

### Syntax Validation

```javascript
function validateJavaScript(code) {
    try {
        new Function(code);
        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            error: error.message,
            line: error.lineNumber,
            column: error.columnNumber
        };
    }
}
```

### TypeScript Validation

```javascript
function validateTypeScript(code) {
    // Simple validation - in practice use TypeScript compiler API
    const issues = [];
    
    // Check for type annotations
    const typeAnnotationRegex = /:\s*(string|number|boolean|any|void|never|object|symbol|bigint)/g;
    let match;
    
    while ((match = typeAnnotationRegex.exec(code)) !== null) {
        // Valid type annotation
    }
    
    return { valid: issues.length === 0, issues };
}
```

## References

- [MAM Specification - JavaScript](../SPEC.md#javascript)
- [JavaScript Documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Node.js Documentation](https://nodejs.org/docs/)
- [ECMAScript Specification](https://tc39.es/ecma262/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable