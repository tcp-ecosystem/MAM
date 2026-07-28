/**
 * MAM Code Block Parser
 * 
 * Extracts and parses embedded code blocks from MAM sections.
 * Supports Python, JavaScript, Mermaid, and other languages.
 */

export interface ParsedCodeBlock {
  language: string;
  value: string;
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}

export interface CodeBlockParseResult {
  blocks: ParsedCodeBlock[];
  errors: Array<{ message: string; line: number; column: number }>;
}

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

export function extractCodeBlocksByLanguage(blocks: ParsedCodeBlock[], language: string): ParsedCodeBlock[] {
  return blocks.filter(b => b.language === language);
}

export function hasCodeBlocks(blocks: ParsedCodeBlock[]): boolean {
  return blocks.length > 0;
}

export function getCodeBlockLanguages(blocks: ParsedCodeBlock[]): string[] {
  return [...new Set(blocks.map(b => b.language))];
}
