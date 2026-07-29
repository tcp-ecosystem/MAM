/**
 * MAM Code Block Parser
 *
 * Extracts and parses embedded code blocks from MAM sections.
 * Supports Python, JavaScript, Mermaid, and other languages.
 * Provides utilities for extracting, filtering, counting, and
 * manipulating code blocks within MAM documents.
 */

// ============================================================================
// Types
// ============================================================================

export interface ParsedCodeBlock {
  language: string;
  value: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}

export interface CodeBlockParseResult {
  blocks: ParsedCodeBlock[];
  errors: Array<{ message: string; line: number; column: number }>;
}

export interface CodeBlockInfo {
  language: string;
  value: string;
  lineStart: number;
  lineEnd: number;
  index: number;
  metadata: Record<string, string>;
}

export interface CodeBlockMetadata {
  timeout?: string;
  memory?: string;
  requires?: string[];
  [key: string]: string | string[] | undefined;
}

// ============================================================================
// Core Extraction
// ============================================================================

/**
 * Parse code blocks from a raw content string.
 * Returns both parsed blocks and any errors encountered.
 */
export function parseCodeBlocks(content: string): CodeBlockParseResult {
  const blocks: ParsedCodeBlock[] = [];
  const errors: Array<{ message: string; line: number; column: number }> = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockLanguage = '';
  let blockLines: string[] = [];
  let blockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^```(\w*)/);

    if (!inBlock && fenceMatch) {
      inBlock = true;
      blockLanguage = fenceMatch[1] || 'text';
      blockLines = [];
      blockStartLine = i + 1;
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      blocks.push({
        language: blockLanguage,
        value: blockLines.join('\n'),
        location: {
          start: { line: blockStartLine, column: 0 },
          end: { line: i, column: 3 },
        },
      });
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  if (inBlock) {
    errors.push({
      message: 'Unclosed code block',
      line: blockStartLine,
      column: 0,
    });
  }

  return { blocks, errors };
}

/**
 * Extract all code blocks from text with full info (positions, metadata).
 */
export function extractAllCodeBlocks(text: string): CodeBlockInfo[] {
  const lines = text.split('\n');
  const blocks: CodeBlockInfo[] = [];
  let inBlock = false;
  let blockLanguage = '';
  let blockLines: string[] = [];
  let blockStartLine = 0;
  let blockIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^```(\w*)/);

    if (!inBlock && fenceMatch) {
      inBlock = true;
      blockLanguage = fenceMatch[1] || 'text';
      blockLines = [];
      blockStartLine = i + 1;
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      const codeValue = blockLines.join('\n');
      const metadata = parseCodeBlockMetadata(codeValue);
      blocks.push({
        language: blockLanguage,
        value: codeValue,
        lineStart: blockStartLine,
        lineEnd: i + 1,
        index: blockIndex,
        metadata,
      });
      blockIndex++;
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

/**
 * Extract code blocks filtered by language.
 */
export function extractCodeBlocksByLanguage(
  blocksOrText: CodeBlockInfo[] | string,
  language: string
): CodeBlockInfo[] {
  const blocks = typeof blocksOrText === 'string'
    ? extractAllCodeBlocks(blocksOrText)
    : blocksOrText;
  return blocks.filter(b => b.language === language);
}

/**
 * Parse metadata comments from code block content.
 * Looks for patterns like: // @timeout=30s, # @memory=512MB, # @requires=module1
 */
export function getCodeBlockMetadata(codeBlock: CodeBlockInfo): CodeBlockMetadata {
  return codeBlock.metadata;
}

/**
 * Check if any code blocks in text are executable languages.
 */
export function hasExecutableCodeBlocks(text: string): boolean {
  const executableLanguages = new Set([
    'python', 'py', 'javascript', 'js', 'typescript', 'ts',
    'rust', 'rs', 'go', 'shell', 'bash', 'sh', 'zsh',
    'ruby', 'java', 'c', 'cpp', 'csharp', 'cs', 'php',
    'swift', 'kotlin', 'dart', 'lua', 'r', 'perl',
  ]);
  const blocks = extractAllCodeBlocks(text);
  return blocks.some(b => executableLanguages.has(b.language));
}

/**
 * Get the list of unique languages used in code blocks.
 */
export function getCodeBlockLanguages(blocks: ParsedCodeBlock[] | CodeBlockInfo[]): string[] {
  return [...new Set(blocks.map(b => b.language))];
}

/**
 * Count the number of code blocks in text.
 */
export function countCodeBlocks(text: string): number {
  const lines = text.split('\n');
  let count = 0;
  let inBlock = false;

  for (const line of lines) {
    const fenceMatch = line.match(/^```(\w*)/);
    if (!inBlock && fenceMatch) {
      inBlock = true;
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      count++;
    }
  }

  return count;
}

/**
 * Replace a code block at a given index with a new value.
 * Returns the updated text, or the original text if index is out of range.
 */
export function replaceCodeBlock(text: string, index: number, newValue: string): string {
  const blocks = extractAllCodeBlocks(text);
  if (index < 0 || index >= blocks.length) return text;

  const lines = text.split('\n');
  const block = blocks[index]!;

  // lineStart is 1-indexed, convert to 0-indexed for array
  const startIdx = block.lineStart - 1;
  const endIdx = block.lineEnd - 1;

  // Rebuild the fenced block
  const fence = '```' + block.language;
  const newBlock = [fence, newValue, '```'];

  // Replace the lines
  const before = lines.slice(0, startIdx);
  const after = lines.slice(endIdx + 1);

  return [...before, ...newBlock, ...after].join('\n');
}

/**
 * Wrap code in a fenced code block string.
 */
export function wrapCodeBlock(
  code: string,
  language: string,
  metadata?: Record<string, string>
): string {
  let header = '```' + language;
  if (metadata) {
    const metaEntries = Object.entries(metadata);
    if (metaEntries.length > 0) {
      const metaComments = metaEntries
        .map(([k, v]) => `// @${k}=${v}`)
        .join(' ');
      header += ' ' + metaComments;
    }
  }
  return `${header}\n${code}\n\`\`\``;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a language string represents a known language.
 */
export function isKnownLanguage(language: string): boolean {
  const known = new Set([
    'python', 'py', 'javascript', 'js', 'typescript', 'ts',
    'rust', 'rs', 'go', 'shell', 'bash', 'sh', 'zsh',
    'yaml', 'yml', 'json', 'mermaid', 'markdown', 'md',
    'html', 'css', 'sql', 'ruby', 'java', 'c', 'cpp',
    'csharp', 'cs', 'php', 'swift', 'kotlin', 'dart',
    'lua', 'r', 'perl', 'toml', 'xml', 'dockerfile',
    'makefile', 'text', 'plaintext',
  ]);
  return known.has(language.toLowerCase());
}

/**
 * Get the MIME type for a language (useful for syntax highlighting).
 */
export function getLanguageMimeType(language: string): string {
  const mimeMap: Record<string, string> = {
    python: 'text/x-python',
    py: 'text/x-python',
    javascript: 'text/javascript',
    js: 'text/javascript',
    typescript: 'text/typescript',
    ts: 'text/typescript',
    rust: 'text/x-rust',
    rs: 'text/x-rust',
    go: 'text/x-go',
    shell: 'text/x-shellscript',
    bash: 'text/x-shellscript',
    sh: 'text/x-shellscript',
    yaml: 'text/x-yaml',
    yml: 'text/x-yaml',
    json: 'application/json',
    html: 'text/html',
    css: 'text/css',
    sql: 'text/x-sql',
    ruby: 'text/x-ruby',
    java: 'text/x-java',
    c: 'text/x-c',
    cpp: 'text/x-c++',
    php: 'text/x-php',
    mermaid: 'text/x-mermaid',
    markdown: 'text/markdown',
    md: 'text/markdown',
  };
  return mimeMap[language.toLowerCase()] || 'text/plain';
}

// ============================================================================
// Internal
// ============================================================================

/**
 * Parse metadata comments from code block content.
 * Supports: // @key=value, # @key=value, <!-- @key=value -->
 */
function parseCodeBlockMetadata(code: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    let match: RegExpMatchArray | null;

    // // @key=value
    match = trimmed.match(/^\/\/\s*@(\w[\w-]*)=(.+)$/);
    if (match) {
      metadata[match[1]!] = match[2]!.trim();
      continue;
    }

    // # @key=value
    match = trimmed.match(/^#\s*@(\w[\w-]*)=(.+)$/);
    if (match) {
      metadata[match[1]!] = match[2]!.trim();
      continue;
    }

    // <!-- @key=value -->
    match = trimmed.match(/^<!--\s*@(\w[\w-]*)=(.+?)\s*-->$/);
    if (match) {
      metadata[match[1]!] = match[2]!.trim();
      continue;
    }
  }

  return metadata;
}
