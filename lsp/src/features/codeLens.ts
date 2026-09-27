import type { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeLens, Command, Range } from 'vscode-languageserver-protocol';
import {
  createRange,
  findSections,
  findCodeBlocks,
} from '../protocol/mam.js';

export function getCodeLenses(document: TextDocument): CodeLens[] {
  const lenses: CodeLens[] = [];
  lenses.push(...getSectionCodeLenses(document));
  lenses.push(...getCodeBlockCodeLenses(document));
  lenses.push(...getPurposeWordCountLenses(document));
  lenses.push(...getMissingPurposeLenses(document));
  lenses.push(...getValidateLenses(document));
  lenses.push(...getSectionOutlineLenses(document));
  lenses.push(...getMermaidCodeLenses(document));
  lenses.push(...getTableCodeLenses(document));
  return sortCodeLenses(lenses);
}

export function hasCodeLenses(document: TextDocument): boolean {
  return getCodeLenses(document).length > 0;
}

export function countCodeLenses(document: TextDocument): number {
  return getCodeLenses(document).length;
}

export function getSectionCodeLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const lenses: CodeLens[] = [];
  for (const section of findSections(text)) {
    const count = countSectionMentions(text, section.name, section.line);
    lenses.push({
      range: section.range,
      command: makeLensCommand(
        `${count} reference${count === 1 ? '' : 's'}`,
        'mam.showReferences',
        [uri, section.line],
      ),
    });
  }
  return lenses;
}

export function getCodeBlockCodeLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const lines = text.split('\n');
  const lenses: CodeLens[] = [];
  for (const block of findCodeBlocks(text)) {
    const lineCount = block.range.end.line - block.line + 1;
    lenses.push({
      range: createRange(block.line, 0, block.line, lines[block.line]!.length),
      command: makeLensCommand(
        `Run ${block.language} block (${lineCount} lines)`,
        'mam.runCodeBlock',
        [uri, block.line],
      ),
    });
  }
  return lenses;
}

export function filterCodeLensesByCommand(lenses: CodeLens[], command: string): CodeLens[] {
  return lenses.filter(lens => lens.command?.command === command);
}

export function getCodeLensCommands(document: TextDocument): string[] {
  const commands = new Set<string>();
  for (const lens of getCodeLenses(document)) {
    if (lens.command) {
      commands.add(lens.command.command);
    }
  }
  return Array.from(commands);
}

function getPurposeWordCountLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const lines = text.split('\n');
  const lenses: CodeLens[] = [];
  const sections = findSections(text);
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    if (section.name !== 'Purpose') continue;
    const endLine = i + 1 < sections.length ? sections[i + 1]!.line - 1 : lines.length - 1;
    const words = countWordsInRange(lines, section.line + 1, endLine);
    lenses.push({
      range: createRange(section.line, 0, section.line, lines[section.line]!.length),
      command: makeLensCommand(`${words} words`, 'mam.showWordCount', [uri, section.line]),
    });
  }
  return lenses;
}

function getMissingPurposeLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const sections = findSections(text);
  const hasPurpose = sections.some(section => section.name === 'Purpose');
  if (hasPurpose) return [];
  return [
    {
      range: createRange(0, 0, 0, 0),
      command: makeLensCommand('Add Purpose section', 'mam.addSection', [uri, 'Purpose']),
    },
  ];
}

function getValidateLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const lines = text.split('\n');
  return [
    {
      range: createRange(0, 0, 0, lines[0]!.length),
      command: makeLensCommand('Validate document', 'mam.validate', [uri]),
    },
  ];
}

function getSectionOutlineLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const lines = text.split('\n');
  const lenses: CodeLens[] = [];
  for (const section of findSections(text)) {
    lenses.push({
      range: createRange(section.line, 0, section.line, lines[section.line]!.length),
      command: makeLensCommand(`Section: ${section.name}`, 'mam.revealSection', [uri, section.line]),
    });
  }
  return lenses;
}

function getMermaidCodeLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const text = document.getText();
  const lines = text.split('\n');
  const lenses: CodeLens[] = [];
  let inMermaid = false;
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith('```')) {
      if (!inMermaid && trimmed.slice(3).trim().toLowerCase() === 'mermaid') {
        inMermaid = true;
        startLine = i;
      } else if (inMermaid) {
        lenses.push({
          range: createRange(startLine, 0, startLine, lines[startLine]!.length),
          command: makeLensCommand('Preview diagram', 'mam.previewMermaid', [uri, startLine]),
        });
        inMermaid = false;
        startLine = -1;
      }
    }
  }
  return lenses;
}

function getTableCodeLenses(document: TextDocument): CodeLens[] {
  const uri = document.uri;
  const lines = document.getText().split('\n');
  const lenses: CodeLens[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!isLensTableRow(line) || i + 1 >= lines.length || !isLensSeparatorRow(lines[i + 1]!)) {
      i++;
      continue;
    }
    const columns = countLensTableColumns(line);
    let endLine = i + 1;
    let rows = 0;
    let j = i + 2;
    while (j < lines.length && isLensTableRow(lines[j]!)) {
      endLine = j;
      rows++;
      j++;
    }
    lenses.push({
      range: createRange(i, 0, i, line.length),
      command: makeLensCommand(
        `${columns} columns x ${rows} rows`,
        'mam.inspectTable',
        [uri, i],
      ),
    });
    void endLine;
    i = j;
  }
  return lenses;
}

function isLensTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isLensSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  return trimmed.slice(1, -1).split('|').every(cell => /^:?-{2,}:?$/.test(cell.trim()));
}

function countLensTableColumns(headerLine: string): number {
  return headerLine.trim().slice(1, -1).split('|').length;
}

function countSectionMentions(text: string, name: string, declarationLine: number): number {
  const lines = text.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i === declarationLine) continue;
    const line = lines[i]!;
    let from = 0;
    while (from <= line.length - name.length) {
      const idx = line.indexOf(name, from);
      if (idx < 0) break;
      const before = idx === 0 ? '' : line[idx - 1]!;
      const after = idx + name.length >= line.length ? '' : line[idx + name.length]!;
      if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) {
        count++;
      }
      from = idx + name.length;
    }
  }
  return count;
}

function countWordsInRange(lines: string[], start: number, end: number): number {
  let words = 0;
  for (let i = start; i <= end && i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (line.trim().startsWith('```')) continue;
    const parts = line.trim().split(/\s+/).filter(part => part.length > 0);
    words += parts.length;
  }
  return words;
}

function makeLensCommand(title: string, command: string, args: Array<string | number>): Command {
  return { title, command, arguments: args };
}

function sortCodeLenses(lenses: CodeLens[]): CodeLens[] {
  return [...lenses].sort((a, b) =>
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character,
  );
}

function deduplicateCodeLenses(lenses: CodeLens[]): CodeLens[] {
  const seen = new Set<string>();
  const result: CodeLens[] = [];
  for (const lens of lenses) {
    const key = `${lens.range.start.line}:${lens.command?.command ?? ''}:${lens.command?.title ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(lens);
    }
  }
  return result;
}

function mergeCodeLenses(primary: CodeLens[], secondary: CodeLens[]): CodeLens[] {
  return sortCodeLenses(deduplicateCodeLenses([...primary, ...secondary]));
}

function getLensTitle(lens: CodeLens): string {
  return lens.command?.title ?? '';
}

function getLensCommandId(lens: CodeLens): string | undefined {
  return lens.command?.command;
}

function hasLensCommand(lens: CodeLens): boolean {
  return lens.command !== undefined;
}

function countLensesByCommand(lenses: CodeLens[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lens of lenses) {
    const command = lens.command?.command ?? 'none';
    counts[command] = (counts[command] ?? 0) + 1;
  }
  return counts;
}

function isLensOnLine(lens: CodeLens, line: number): boolean {
  return lens.range.start.line <= line && lens.range.end.line >= line;
}

function findLensesOnLine(lenses: CodeLens[], line: number): CodeLens[] {
  return lenses.filter(lens => isLensOnLine(lens, line));
}

function collectLensRanges(lenses: CodeLens[]): Range[] {
  return lenses.map(lens => lens.range);
}

function getUnresolvedLenses(lenses: CodeLens[]): CodeLens[] {
  return lenses.filter(lens => lens.command === undefined);
}
