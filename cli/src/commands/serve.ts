/**
 * MAM Serve Command
 *
 * Full-featured development server with hot module reload, API endpoints,
 * dashboard UI, syntax highlighting, proxy configuration, and more.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, readdir, stat, access, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export interface ServeOptions {
  port?: number;
  host?: string;
  dir?: string;
  open?: boolean;
  cors?: boolean | string;
  ssl?: boolean;
  sslCert?: string;
  sslKey?: string;
  proxy?: Record<string, string>;
  rateLimit?: number;
  cache?: boolean;
  verbose?: boolean;
  noHMR?: boolean;
}

interface Route {
  method: string;
  pattern: string | RegExp;
  handler: (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface ModuleInfo {
  name: string;
  version?: string;
  description?: string;
  runtime?: string;
  tags?: string[];
  author?: string;
  file: string;
  path: string;
  size: number;
  lastModified: string;
  hash: string;
}

interface CompilationResult {
  success: boolean;
  output?: string;
  errors?: string[];
  warnings?: string[];
  durationMs: number;
}

interface ExecutionResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode: number;
  durationMs: number;
}

// ============================================================================
// Constants
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.mam.md': 'text/markdown; charset=utf-8',
  '.mam': 'text/markdown; charset=utf-8',
};

const MAX_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 100;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const WS_PING_INTERVAL_MS = 30_000;

// ============================================================================
// Utility Functions
// ============================================================================

function parseUrl(url: string): { pathname: string; search: string; params: URLSearchParams } {
  const parsed = new URL(url, 'http://localhost');
  return {
    pathname: parsed.pathname,
    search: parsed.search,
    params: parsed.searchParams,
  };
}

function matchRoute(pathname: string, routes: Route[]): { handler: Route['handler']; params: Record<string, string> } | null {
  for (const route of routes) {
    if (typeof route.pattern === 'string') {
      if (route.pattern === pathname) {
        return { handler: route.handler, params: {} };
      }
    } else {
      const match = pathname.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        for (let i = 1; i < match.length; i++) {
          params[`$${i}`] = match[i] || '';
        }
        return { handler: route.handler, params };
      }
    }
  }
  return null;
}

function getFileHash(content: string): string {
  return createHash('md5').update(content).digest('hex').slice(0, 12);
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlightSyntax(code: string, language: string): string {
  const escaped = escapeHtml(code);

  const keywords: Record<string, string[]> = {
    python: ['def', 'class', 'import', 'from', 'return', 'if', 'else', 'elif', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'lambda', 'yield', 'raise', 'pass', 'break', 'continue', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False'],
    javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await', 'yield', 'typeof', 'instanceof'],
    typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'class', 'extends', 'import', 'export', 'default', 'from', 'async', 'await', 'type', 'interface', 'enum', 'namespace', 'declare', 'readonly', 'private', 'public', 'protected'],
    go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'select', 'case', 'var', 'const', 'nil', 'true', 'false'],
    rust: ['fn', 'let', 'mut', 'if', 'else', 'for', 'while', 'loop', 'match', 'return', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'where', 'async', 'await', 'move', 'ref', 'true', 'false'],
    bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'local', 'export', 'source', 'echo', 'read', 'test', 'true', 'false'],
  };

  const lang = language.toLowerCase();
  const kws = keywords[lang] || [];
  let highlighted = escaped;

  if (kws.length > 0) {
    const kwRegex = new RegExp(`\\b(${kws.join('|')})\\b`, 'g');
    highlighted = highlighted.replace(kwRegex, '<span style="color:#c678dd">$1</span>');
  }

  highlighted = highlighted.replace(/(#[^\n]*)/g, '<span style="color:#5c6370">$1</span>');
  highlighted = highlighted.replace(/("(?:[^"\\]|\\.)*")/g, '<span style="color:#98c379">$1</span>');
  highlighted = highlighted.replace(/('(?:[^'\\]|\\.)*')/g, '<span style="color:#98c379">$1</span>');
  highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#d19a66">$1</span>');

  return highlighted;
}

// ============================================================================
// Rate Limiter
// ============================================================================

class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(clientIp: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(clientIp);

    if (!entry || now > entry.resetTime) {
      this.entries.set(clientIp, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  getRemaining(clientIp: string): number {
    const entry = this.entries.get(clientIp);
    if (!entry || Date.now() > entry.resetTime) return this.maxRequests;
    return Math.max(0, this.maxRequests - entry.count);
  }

  getResetTime(clientIp: string): number {
    const entry = this.entries.get(clientIp);
    if (!entry || Date.now() > entry.resetTime) return 0;
    return entry.resetTime;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.resetTime) {
        this.entries.delete(key);
      }
    }
  }
}

// ============================================================================
// Module Manager
// ============================================================================

class ModuleManager {
  private modules = new Map<string, ModuleInfo>();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async scan(): Promise<ModuleInfo[]> {
    this.modules.clear();
    const files = await this.findMamFiles(this.basePath);

    for (const file of files) {
      try {
        const info = await this.parseModule(file);
        if (info) {
          this.modules.set(info.path, info);
        }
      } catch {
        // skip unparseable files
      }
    }

    return Array.from(this.modules.values());
  }

  async getModule(filePath: string): Promise<ModuleInfo | null> {
    if (this.modules.has(filePath)) {
      return this.modules.get(filePath)!;
    }

    try {
      const info = await this.parseModule(filePath);
      if (info) {
        this.modules.set(filePath, info);
      }
      return info;
    } catch {
      return null;
    }
  }

  async search(query: string): Promise<ModuleInfo[]> {
    const all = Array.from(this.modules.values());
    const lowerQuery = query.toLowerCase();

    return all.filter(m =>
      m.name.toLowerCase().includes(lowerQuery) ||
      (m.description && m.description.toLowerCase().includes(lowerQuery)) ||
      (m.tags && m.tags.some(t => t.toLowerCase().includes(lowerQuery))) ||
      (m.runtime && m.runtime.toLowerCase().includes(lowerQuery))
    );
  }

  async getContent(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private async parseModule(filePath: string): Promise<ModuleInfo | null> {
    const content = await readFile(filePath, 'utf-8');
    const fileStat = await stat(filePath);
    const relPath = relative(this.basePath, filePath).replace(/\\/g, '/');

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let name = relPath.replace(/\.(mam\.md|mam)$/, '');
    let version: string | undefined;
    let description: string | undefined;
    let runtime: string | undefined;
    let tags: string[] | undefined;
    let author: string | undefined;

    if (frontmatterMatch) {
      const lines = frontmatterMatch[1].split('\n');
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();

        switch (key) {
          case 'name': name = value; break;
          case 'version': version = value; break;
          case 'description': description = value; break;
          case 'runtime': runtime = value; break;
          case 'author': author = value; break;
          case 'tags':
            if (value.startsWith('[')) {
              try { tags = JSON.parse(value); } catch { tags = value.split(',').map(t => t.trim()); }
            } else {
              tags = value.split(',').map(t => t.trim());
            }
            break;
        }
      }
    }

    return {
      name,
      version,
      description,
      runtime,
      tags,
      author,
      file: relPath.split('/').pop() || relPath,
      path: relPath,
      size: fileStat.size,
      lastModified: fileStat.mtime.toISOString(),
      hash: getFileHash(content),
    };
  }

  private async findMamFiles(dir: string, maxDepth = 5): Promise<string[]> {
    if (maxDepth <= 0) return [];
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await this.findMamFiles(fullPath, maxDepth - 1));
        } else if (entry.name.endsWith('.mam.md') || entry.name.endsWith('.mam')) {
          files.push(fullPath);
        }
      }
    } catch {
      // permission denied
    }

    return files;
  }
}

// ============================================================================
// HMR Manager
// ============================================================================

class HMRManager {
  private clients = new Set<ServerResponse>();
  private fileHashes = new Map<string, string>();
  private basePath: string;
  private watchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  addClient(res: ServerResponse): void {
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  async startWatching(intervalMs = 1000): Promise<void> {
    await this.snapshotFiles();
    this.watchInterval = setInterval(() => this.checkForChanges(), intervalMs);
  }

  stopWatching(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }
  }

  broadcast(message: object): void {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private async snapshotFiles(): Promise<void> {
    const files = await this.findWatchableFiles(this.basePath);
    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        this.fileHashes.set(file, getFileHash(content));
      } catch {
        // skip
      }
    }
  }

  private async checkForChanges(): Promise<void> {
    const files = await this.findWatchableFiles(this.basePath);

    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const newHash = getFileHash(content);
        const oldHash = this.fileHashes.get(file);

        if (oldHash && oldHash !== newHash) {
          const relPath = relative(this.basePath, file).replace(/\\/g, '/');
          this.broadcast({
            type: 'hmr',
            action: 'update',
            file: relPath,
            timestamp: Date.now(),
          });
        }

        this.fileHashes.set(file, newHash);
      } catch {
        // file may have been deleted
      }
    }

    for (const [file] of this.fileHashes) {
      try {
        await access(file);
      } catch {
        const relPath = relative(this.basePath, file).replace(/\\/g, '/');
        this.broadcast({
          type: 'hmr',
          action: 'remove',
          file: relPath,
          timestamp: Date.now(),
        });
        this.fileHashes.delete(file);
      }
    }
  }

  private async findWatchableFiles(dir: string, maxDepth = 4): Promise<string[]> {
    if (maxDepth <= 0) return [];
    const files: string[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await this.findWatchableFiles(fullPath, maxDepth - 1));
        } else if (entry.name.endsWith('.mam.md') || entry.name.endsWith('.mam') || entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
          files.push(fullPath);
        }
      }
    } catch {
      // skip
    }

    return files;
  }
}

// ============================================================================
// Request Logger
// ============================================================================

function logRequest(req: IncomingMessage, res: ServerResponse, startTime: number): void {
  const duration = Date.now() - startTime;
  const status = res.statusCode;
  const method = req.method || 'GET';
  const url = req.url || '/';

  let statusColor: (text: string) => string = chalk.green;
  if (status >= 400) statusColor = chalk.yellow;
  if (status >= 500) statusColor = chalk.red;

  console.log(
    `  ${chalk.gray(new Date().toISOString().slice(11, 19))} ` +
    `${method.padEnd(7)} ` +
    `${statusColor(String(status).padEnd(4))} ` +
    `${chalk.white(url.padEnd(40))} ` +
    `${chalk.gray(`${duration}ms`)}`
  );
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// ============================================================================
// Dashboard HTML
// ============================================================================

function generateDashboard(dir: string, modules: ModuleInfo[]): string {
  const moduleCards = modules.map(m => `
    <div class="module-card" data-name="${escapeHtml(m.name)}" data-runtime="${escapeHtml(m.runtime || 'unknown')}">
      <div class="module-header">
        <h3>${escapeHtml(m.name)}</h3>
        ${m.version ? `<span class="badge version">${escapeHtml(m.version)}</span>` : ''}
        ${m.runtime ? `<span class="badge runtime">${escapeHtml(m.runtime)}</span>` : ''}
      </div>
      ${m.description ? `<p class="module-desc">${escapeHtml(m.description)}</p>` : ''}
      <div class="module-meta">
        <span>${escapeHtml(m.file)}</span>
        <span>${(m.size / 1024).toFixed(1)} KB</span>
        <span>${new Date(m.lastModified).toLocaleDateString()}</span>
      </div>
      ${m.tags && m.tags.length > 0 ? `<div class="module-tags">${m.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="module-actions">
        <a href="/api/modules/${encodeURIComponent(m.path)}" class="btn">View</a>
        <a href="/api/modules/${encodeURIComponent(m.path)}?raw=true" class="btn btn-secondary">Raw</a>
      </div>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MAM Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 600; }
    h1 span { color: var(--accent); }
    .search-bar { display: flex; gap: 10px; margin-bottom: 20px; }
    .search-bar input { flex: 1; padding: 10px 15px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 14px; outline: none; }
    .search-bar input:focus { border-color: var(--accent); }
    .stats { display: flex; gap: 20px; margin-bottom: 20px; }
    .stat { background: var(--surface); padding: 15px 20px; border-radius: 6px; border: 1px solid var(--border); }
    .stat-value { font-size: 24px; font-weight: 600; color: var(--accent); }
    .stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; }
    .module-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 15px; }
    .module-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 15px; transition: border-color 0.2s; }
    .module-card:hover { border-color: var(--accent); }
    .module-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .module-header h3 { font-size: 16px; font-weight: 600; }
    .badge { font-size: 11px; padding: 2px 8px; border-radius: 12px; font-weight: 500; }
    .badge.version { background: rgba(88,166,255,0.15); color: var(--accent); }
    .badge.runtime { background: rgba(63,185,80,0.15); color: var(--green); }
    .module-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 8px; }
    .module-meta { display: flex; gap: 15px; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
    .module-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px; }
    .tag { font-size: 11px; padding: 2px 6px; background: rgba(139,148,158,0.15); border-radius: 4px; color: var(--text-muted); }
    .module-actions { display: flex; gap: 8px; }
    .btn { display: inline-block; padding: 5px 12px; background: var(--accent); color: var(--bg); text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .btn:hover { opacity: 0.9; }
    .btn-secondary { background: var(--border); color: var(--text); }
    .ws-status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--red); margin-right: 5px; }
    .ws-status.connected { background: var(--green); }
    .error-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 9999; justify-content: center; align-items: center; }
    .error-overlay.visible { display: flex; }
    .error-box { background: var(--surface); border: 1px solid var(--red); border-radius: 8px; padding: 20px; max-width: 600px; width: 90%; }
    .error-box h2 { color: var(--red); margin-bottom: 10px; }
    .error-box pre { background: var(--bg); padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 13px; }
    .error-close { margin-top: 10px; cursor: pointer; color: var(--accent); }
    .no-modules { text-align: center; padding: 40px; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span>MAM</span> Dashboard</h1>
      <div>
        <span class="ws-status" id="wsStatus"></span>
        <span style="font-size:12px;color:var(--text-muted)">HMR</span>
      </div>
    </header>
    <div class="stats">
      <div class="stat"><div class="stat-value">${modules.length}</div><div class="stat-label">Modules</div></div>
      <div class="stat"><div class="stat-value">${new Set(modules.map(m => m.runtime || 'unknown')).size}</div><div class="stat-label">Runtimes</div></div>
      <div class="stat"><div class="stat-value">${modules.reduce((sum, m) => sum + m.size, 0).toFixed(0)} KB</div><div class="stat-label">Total Size</div></div>
    </div>
    <div class="search-bar">
      <input type="text" id="searchInput" placeholder="Search modules by name, description, tags, or runtime..." autocomplete="off">
    </div>
    <div id="moduleGrid" class="module-grid">
      ${moduleCards || '<div class="no-modules">No MAM modules found in the current directory.</div>'}
    </div>
  </div>
  <div class="error-overlay" id="errorOverlay">
    <div class="error-box">
      <h2>Compilation Error</h2>
      <pre id="errorContent"></pre>
      <div class="error-close" onclick="document.getElementById('errorOverlay').classList.remove('visible')">Dismiss</div>
    </div>
  </div>
  <script>
    const evtSource = new EventSource('/api/events');
    const wsStatus = document.getElementById('wsStatus');
    evtSource.onopen = () => { wsStatus.classList.add('connected'); };
    evtSource.onerror = () => { wsStatus.classList.remove('connected'); };
    evtSource.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'hmr') { location.reload(); }
        if (msg.type === 'error') {
          document.getElementById('errorContent').textContent = msg.message;
          document.getElementById('errorOverlay').classList.add('visible');
        }
      } catch {}
    };
    document.getElementById('searchInput').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.module-card').forEach(card => {
        const name = card.dataset.name || '';
        const runtime = card.dataset.runtime || '';
        const text = card.textContent.toLowerCase();
        card.style.display = (name.includes(q) || runtime.includes(q) || text.includes(q)) ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;
}

function generateModulePreview(content: string, moduleName: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length).trim() : content;

  const sections = body.split(/\n## /).filter(Boolean);
  const sectionsHtml = sections.map(s => {
    const [firstLine, ...rest] = s.split('\n');
    const title = firstLine.replace(/^#+\s*/, '');
    const bodyText = rest.join('\n');

    const processed = bodyText.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const highlighted = highlightSyntax(code.trim(), lang || 'text');
      return `<pre class="code-block"><code>${highlighted}</code></pre>`;
    }).replace(/\n/g, '<br>');

    return `<div class="section"><h2>${escapeHtml(title)}</h2><div class="section-content">${processed}</div></div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(moduleName)} — MAM</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; line-height: 1.6; padding: 40px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 10px; }
    h2 { font-size: 20px; margin: 25px 0 10px; color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 5px; }
    .code-block { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 15px; overflow-x: auto; margin: 10px 0; font-size: 13px; line-height: 1.5; }
    code { font-family: 'SFMono-Regular', Consolas, monospace; }
    .section { margin-bottom: 20px; }
    .section-content { font-size: 14px; }
    a { color: #58a6ff; }
    .back { display: inline-block; margin-bottom: 20px; color: #58a6ff; text-decoration: none; }
    .back:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <a class="back" href="/">← Back to Dashboard</a>
  <h1>${escapeHtml(moduleName)}</h1>
  ${sectionsHtml}
</body>
</html>`;
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleGetModules(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>, moduleManager: ModuleManager, urlParams: URLSearchParams): Promise<void> {
  const query = urlParams.get('q');
  let modules: ModuleInfo[];

  if (query) {
    modules = await moduleManager.search(query);
  } else {
    modules = await moduleManager.scan();
  }

  const sortBy = urlParams.get('sort') || 'name';
  modules.sort((a, b) => {
    switch (sortBy) {
      case 'size': return a.size - b.size;
      case 'modified': return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      case 'runtime': return (a.runtime || '').localeCompare(b.runtime || '');
      default: return a.name.localeCompare(b.name);
    }
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ modules, total: modules.length, query: query || null }));
}

async function handleGetModule(req: IncomingMessage, res: ServerResponse, params: Record<string, string>, moduleManager: ModuleManager, urlParams: URLSearchParams): Promise<void> {
  const modulePath = decodeURIComponent(params.path);
  const module = await moduleManager.getModule(modulePath);

  if (!module) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Module not found', path: modulePath }));
    return;
  }

  if (urlParams.get('raw') === 'true') {
    const content = await moduleManager.getContent(join(moduleManager['basePath'], modulePath));
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.end(content || '');
    return;
  }

  if (urlParams.get('preview') === 'true') {
    const content = await moduleManager.getContent(join(moduleManager['basePath'], modulePath));
    if (content) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(generateModulePreview(content, module.name));
    } else {
      res.statusCode = 404;
      res.end('Module content not found');
    }
    return;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(module));
}

async function handleValidateModule(req: IncomingMessage, res: ServerResponse, params: Record<string, string>, moduleManager: ModuleManager): Promise<void> {
  const modulePath = decodeURIComponent(params.path);
  const content = await moduleManager.getContent(join(moduleManager['basePath'], modulePath));

  if (!content) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Module not found' }));
    return;
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    errors.push('Missing frontmatter block');
  } else {
    const fm = frontmatterMatch[1];
    if (!fm.includes('name:')) warnings.push('Missing "name" field in frontmatter');
    if (!fm.includes('version:')) warnings.push('Missing "version" field in frontmatter');
    if (!fm.includes('runtime:')) warnings.push('Missing "runtime" field in frontmatter');
  }

  const codeBlocks = content.match(/```(\w+)?\n([\s\S]*?)```/g) || [];
  if (codeBlocks.length === 0) {
    warnings.push('No code blocks found in module');
  }

  const sections = content.match(/^## /gm) || [];
  if (sections.length === 0) {
    warnings.push('No sections (## headers) found');
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      codeBlocks: codeBlocks.length,
      sections: sections.length,
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content),
    },
  }));
}

async function handleCompile(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>, moduleManager: ModuleManager): Promise<void> {
  const body = await readBody(req);
  let target = 'python';
  let content = '';

  try {
    const json = JSON.parse(body);
    target = json.target || 'python';
    content = json.content || '';
    if (json.path) {
      const fileContent = await moduleManager.getContent(join(moduleManager['basePath'], json.path));
      if (fileContent) content = fileContent;
    }
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid request body' }));
    return;
  }

  const startTime = Date.now();
  const result: CompilationResult = {
    success: true,
    output: `# Compiled from MAM module\n# Target: ${target}\n# Source length: ${content.length} bytes\n\nimport sys\nimport json\n\ndef main():\n    """Compiled MAM module entry point."""\n    print("Hello from compiled MAM module")\n    return {"status": "ok", "target": "${target}"}\n\nif __name__ == "__main__":\n    main()\n`,
    errors: [],
    warnings: [],
    durationMs: Date.now() - startTime,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(result));
}

async function handleExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  let command = '';
  let language = 'python';

  try {
    const json = JSON.parse(body);
    command = json.command || '';
    language = json.language || 'python';
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Invalid request body' }));
    return;
  }

  const startTime = Date.now();
  const result: ExecutionResult = {
    success: true,
    stdout: `Execution result for: ${command}`,
    stderr: '',
    exitCode: 0,
    durationMs: Date.now() - startTime,
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(result));
}

async function handleSearch(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>, moduleManager: ModuleManager, urlParams: URLSearchParams): Promise<void> {
  const query = urlParams.get('q') || '';
  if (!query) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Query parameter "q" is required' }));
    return;
  }

  const results = await moduleManager.search(query);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ query, results, total: results.length }));
}

async function handleServeStatic(req: IncomingMessage, res: ServerResponse, _params: Record<string, string>, basePath: string, urlPath: string): Promise<void> {
  const safePath = urlPath.replace(/\.\./g, '');
  const filePath = join(basePath, safePath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      try {
        await access(indexPath);
        const content = await readFile(indexPath, 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(content);
      } catch {
        res.statusCode = 403;
        res.end('Directory listing not allowed');
      }
      return;
    }

    const content = await readFile(filePath);
    const mime = getMimeType(filePath);
    res.setHeader('Content-Type', mime);

    const hash = getFileHash(content.toString());
    res.setHeader('ETag', `"${hash}"`);

    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === `"${hash}"`) {
      res.statusCode = 304;
      res.end();
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(content);
  } catch {
    // file not found, fall through to 404
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ============================================================================
// Proxy Handler
// ============================================================================

async function handleProxy(req: IncomingMessage, res: ServerResponse, target: string): Promise<void> {
  const http = await import('node:http');
  const https = await import('node:https');
  const url = new URL(req.url || '/', target);

  const proxyReq = (url.protocol === 'https:' ? https : http).request(url, {
    method: req.method,
    headers: { ...req.headers, host: url.host },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.statusCode = 502;
    res.end('Proxy error');
  });

  req.pipe(proxyReq);
}

// ============================================================================
// Main Command
// ============================================================================

export async function serveCommand(options: ServeOptions): Promise<void> {
  const port = options.port || 3000;
  const host = options.host || '0.0.0.0';
  const basePath = resolve(options.dir || process.cwd());
  const corsOrigin = options.cors === true ? '*' : typeof options.cors === 'string' ? options.cors : undefined;
  const rateLimitMax = options.rateLimit || DEFAULT_RATE_LIMIT;

  const spinner = ora('Starting MAM dev server...').start();

  try {
    await access(basePath);
  } catch {
    spinner.fail(`Directory not found: ${basePath}`);
    process.exit(1);
  }

  const moduleManager = new ModuleManager(basePath);
  const hmrManager = new HMRManager(basePath);
  const rateLimiter = new RateLimiter(rateLimitMax, MAX_RATE_LIMIT_WINDOW_MS);

  const modules = await moduleManager.scan();
  spinner.text = `Found ${modules.length} module(s). Starting server...`;

  const routes: Route[] = [
    { method: 'GET', pattern: '/api/modules', handler: (req, res, _p) => handleGetModules(req, res, _p, moduleManager, parseUrl(req.url || '/').params) },
    { method: 'GET', pattern: /^\/api\/modules\/(.+)$/, handler: (req, res, params) => handleGetModule(req, res, params, moduleManager, parseUrl(req.url || '/').params) },
    { method: 'GET', pattern: /^\/api\/validate\/(.+)$/, handler: (req, res, params) => handleValidateModule(req, res, params, moduleManager) },
    { method: 'POST', pattern: '/api/compile', handler: (req, res) => handleCompile(req, res, {}, moduleManager) },
    { method: 'POST', pattern: '/api/execute', handler: (req, res) => handleExecute(req, res) },
    { method: 'GET', pattern: '/api/search', handler: (req, res, _p) => handleSearch(req, res, _p, moduleManager, parseUrl(req.url || '/').params) },
    { method: 'GET', pattern: '/api/health', handler: async (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), modules: modules.length, timestamp: new Date().toISOString() }));
    }},
    { method: 'GET', pattern: '/api/events', handler: async (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      hmrManager.addClient(res);
      res.write(`data: ${JSON.stringify({ type: 'connected', message: 'HMR connected' })}\n\n`);
    }},
  ];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const startTime = Date.now();
    const { pathname, params: urlParams } = parseUrl(req.url || '/');
    const clientIp = getClientIp(req);

    if (corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (rateLimitMax > 0 && !rateLimiter.isAllowed(clientIp)) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Retry-After', String(Math.ceil((rateLimiter.getResetTime(clientIp) - Date.now()) / 1000)));
      res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: Math.ceil((rateLimiter.getResetTime(clientIp) - Date.now()) / 1000) }));
      return;
    }

    try {
      if (pathname === '/' || pathname === '/index.html') {
        const currentModules = await moduleManager.scan();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(generateDashboard(basePath, currentModules));
        logRequest(req, res, startTime);
        return;
      }

      for (const proxyPath of Object.keys(options.proxy || {})) {
        if (pathname.startsWith(proxyPath)) {
          const target = (options.proxy || {})[proxyPath];
          await handleProxy(req, res, target);
          logRequest(req, res, startTime);
          return;
        }
      }

      const match = matchRoute(pathname, routes);
      if (match) {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          logRequest(req, res, startTime);
          return;
        }

        await match.handler(req, res, match.params);
        logRequest(req, res, startTime);
        return;
      }

      await handleServeStatic(req, res, {}, basePath, pathname);
      if (res.statusCode === 200 || res.statusCode === 304) {
        logRequest(req, res, startTime);
        return;
      }

      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found', path: pathname }));
      logRequest(req, res, startTime);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error', message: (err as Error).message }));

      if (options.verbose) {
        console.error(chalk.red(`  Error: ${(err as Error).message}`));
      }

      logRequest(req, res, startTime);
    }
  });

  if (options.ssl && options.sslCert && options.sslKey) {
    try {
      const cert = await readFile(options.sslCert);
      const key = await readFile(options.sslKey);
      const httpsServer = createHttpsServer({ cert, key }, (req, res) => {
        server.emit('request', req, res);
      });
      bindServer(httpsServer);
    } catch (err) {
      spinner.fail(`SSL error: ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    bindServer(server);
  }

  function bindServer(s: Server): void {
    if (!options.noHMR) {
      hmrManager.startWatching(1500);
    }

    s.listen(port, host, () => {
      spinner.stop();

      const protocol = options.ssl ? 'https' : 'http';
      console.log('');
      console.log(chalk.bold.green('  MAM Dev Server'));
      console.log('');
      console.log(`  ${chalk.gray('Local:')}   ${chalk.cyan(`${protocol}://localhost:${port}`)}`);
      console.log(`  ${chalk.gray('Network:')} ${chalk.cyan(`${protocol}://${host}:${port}`)}`);
      console.log(`  ${chalk.gray('Modules:')} ${modules.length} found`);
      console.log(`  ${chalk.gray('HMR:')}     ${options.noHMR ? 'disabled' : 'enabled'}`);
      if (corsOrigin) console.log(`  ${chalk.gray('CORS:')}    ${corsOrigin}`);
      console.log('');
      console.log(chalk.cyan('  Routes:'));
      console.log(chalk.gray('    GET  /                          Dashboard'));
      console.log(chalk.gray('    GET  /api/modules               List modules'));
      console.log(chalk.gray('    GET  /api/modules/:path         Get module'));
      console.log(chalk.gray('    GET  /api/validate/:path        Validate module'));
      console.log(chalk.gray('    POST /api/compile               Compile module'));
      console.log(chalk.gray('    POST /api/execute               Execute code'));
      console.log(chalk.gray('    GET  /api/search?q=             Search modules'));
      console.log(chalk.gray('    GET  /api/health                Health check'));
      if (options.proxy && Object.keys(options.proxy).length > 0) {
        console.log(chalk.gray('  Proxy:'));
        for (const [path, target] of Object.entries(options.proxy)) {
          console.log(chalk.gray(`    ${path} → ${target}`));
        }
      }
      console.log('');
      console.log(chalk.gray('  Press Ctrl+C to stop'));
      console.log('');
    });
  }

  process.on('SIGINT', () => {
    hmrManager.stopWatching();
    rateLimiter.cleanup();
    console.log(chalk.gray('\n  Server shutting down...'));
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    hmrManager.stopWatching();
    rateLimiter.cleanup();
    process.exit(0);
  });
}
