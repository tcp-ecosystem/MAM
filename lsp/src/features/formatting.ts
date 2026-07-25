/**
 * MAM Formatting Provider
 */

import { TextEdit } from 'vscode-languageserver-protocol';

export function getFormatting(content: string): TextEdit[] {
  const lines = content.split('\n');
  const formatted: string[] = [];
  let lastEmpty = false;

  for (const line of lines) {
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed === '') {
      if (lastEmpty) continue;
      lastEmpty = true;
    } else {
      lastEmpty = false;
    }
    formatted.push(trimmed);
  }

  const result = formatted.join('\n');
  if (result === content) return [];

  const lastLine = lines.length - 1;
  return [{
    range: { start: { line: 0, character: 0 }, end: { line: lastLine, character: 0 } },
    newText: result,
  }];
}