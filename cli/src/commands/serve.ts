/**
 * MAM Serve Command
 * 
 * Starts a development server for MAM modules.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import chalk from 'chalk';

export interface ServeOptions {
  port?: number;
  dir?: string;
  open?: boolean;
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  const port = options.port || 3000;
  const dir = options.dir || process.cwd();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    try {
      if (url === '/' || url === '/index.html') {
        // Serve main page
        res.setHeader('Content-Type', 'text/html');
        res.end(generateIndexPage(dir));
      } else if (url.startsWith('/api/modules')) {
        // List modules
        const files = await findMAMFiles(dir);
        const modules = [];
        for (const file of files) {
          const content = await readFile(file, 'utf-8');
          const match = content.match(/^---\n([\s\S]*?)\n---/);
          if (match) {
            const lines = match[1].split('\n');
            const name = lines.find(l => l.startsWith('name:'))?.split(':')[1]?.trim();
            const version = lines.find(l => l.startsWith('version:'))?.split(':')[1]?.trim();
            modules.push({ name, version, file: file.split('/').pop() });
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(modules));
      } else if (url.startsWith('/api/module/')) {
        // Get specific module
        const moduleName = url.split('/api/module/')[1];
        const files = await findMAMFiles(dir);
        const file = files.find(f => f.includes(moduleName || ''));
        if (file) {
          const content = await readFile(file, 'utf-8');
          res.setHeader('Content-Type', 'text/markdown');
          res.end(content);
        } else {
          res.statusCode = 404;
          res.end('Module not found');
        }
      } else {
        res.statusCode = 404;
        res.end('Not found');
      }
    } catch (error) {
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    console.log(chalk.green(`\nMAM Dev Server running at http://localhost:${port}\n`));
    console.log(chalk.gray('  Press Ctrl+C to stop'));
    console.log('');
    console.log(chalk.cyan('  Routes:'));
    console.log(chalk.gray('    GET /              - Dashboard'));
    console.log(chalk.gray('    GET /api/modules   - List modules'));
    console.log(chalk.gray('    GET /api/module/:name - Get module'));
  });
}

function generateIndexPage(dir: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>MAM Dev Server</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    .module { background: #f5f5f5; padding: 10px; margin: 10px 0; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>MAM Dev Server</h1>
  <p>Directory: ${dir}</p>
  <h2>API Endpoints</h2>
  <ul>
    <li><a href="/api/modules">GET /api/modules</a> - List all modules</li>
    <li>GET /api/module/:name - Get specific module</li>
  </ul>
</body>
</html>`;
}

async function findMAMFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.mam.md') || entry.endsWith('.mam')) {
        files.push(join(dir, entry));
      }
    }
  } catch { /* ignore */ }
  return files;
}