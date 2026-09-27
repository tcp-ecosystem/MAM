import type { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentHighlight, DocumentHighlightKind, Range } from 'vscode-languageserver-protocol';
import {
  getWordAtPosition,
  createRange,
  findSections,
  findModuleDeclarations,
  findCodeBlocks,
  findVariableReferences,
} from '../protocol/mam.js';

export function getDocumentHighlights(
  document: TextDocument,
  position: { line: number; character: number },
): DocumentHighlight[] {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return [];
  const word = getWordAtPosition(line, position.character);
  if (!word) return [];
  const occurrences = collectWordOccurrences(lines, word, position.line);
  const highlights = occurrences.map(occurrence => ({
    range: occurrence.range,
    kind: occurrence.write ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
  }));
  const merged = mergeHighlightRanges(highlights.map(highlight => highlight.range));
  return merged.map(range => ({
    range,
    kind: inferMergedHighlightKind(highlights, range),
  }));
}

export function hasHighlights(
  document: TextDocument,
  position: { line: number; character: number },
): boolean {
  return getDocumentHighlights(document, position).length > 0;
}

export function countHighlights(
  document: TextDocument,
  position: { line: number; character: number },
): number {
  return getDocumentHighlights(document, position).length;
}

export function getHighlightRanges(
  document: TextDocument,
  position: { line: number; character: number },
): Range[] {
  return getDocumentHighlights(document, position).map(highlight => highlight.range);
}

export function groupHighlightsByKind(highlights: DocumentHighlight[]): Map<number, DocumentHighlight[]> {
  const groups = new Map<number, DocumentHighlight[]>();
  for (const highlight of highlights) {
    const kind = highlight.kind ?? DocumentHighlightKind.Text;
    let group = groups.get(kind);
    if (group === undefined) {
      group = [];
      groups.set(kind, group);
    }
    group.push(highlight);
  }
  return groups;
}

export function isHighlightableAt(
  document: TextDocument,
  position: { line: number; character: number },
): boolean {
  const lines = document.getText().split('\n');
  const line = lines[position.line];
  if (!line) return false;
  if (line.trim().startsWith('```')) return false;
  const word = getWordAtPosition(line, position.character);
  return word !== null && word.length > 0;
}

export function sortHighlights(highlights: DocumentHighlight[]): DocumentHighlight[] {
  return [...highlights].sort((a, b) =>
    a.range.start.line - b.range.start.line ||
    a.range.start.character - b.range.start.character,
  );
}

interface WordOccurrence {
  range: Range;
  write: boolean;
}

function collectWordOccurrences(lines: string[], word: string, currentLine: number): WordOccurrence[] {
  const occurrences: WordOccurrence[] = [];
  const declarations = collectDeclarationLines(lines, word);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith('```')) continue;
    let from = 0;
    while (from <= line.length - word.length) {
      const idx = line.indexOf(word, from);
      if (idx < 0) break;
      const before = idx === 0 ? '' : line[idx - 1]!;
      const after = idx + word.length >= line.length ? '' : line[idx + word.length]!;
      if (isHighlightBoundary(before) && isHighlightBoundary(after)) {
        occurrences.push({
          range: createRange(i, idx, i, idx + word.length),
          write: declarations.has(`${i}:${idx}`),
        });
      }
      from = idx + word.length;
    }
  }
  void currentLine;
  return occurrences;
}

function collectDeclarationLines(lines: string[], word: string): Set<string> {
  const declarations = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      const name = heading[2]!.trim();
      if (name === word) {
        const idx = line.indexOf(word);
        declarations.add(`${i}:${idx}`);
      }
      continue;
    }
    const moduleDecl = line.match(/^(module|agent|tool|memory|workflow|team|policy|system|service|component|resource|interface|contract|plugin|extension|runtime|package|repository|documentation)\s+(.+)/);
    if (moduleDecl) {
      const name = moduleDecl[2]!.trim().split(/\s+/)[0]!;
      if (name === word) {
        declarations.add(`${i}:${line.indexOf(word)}`);
      }
      continue;
    }
    const yamlKey = line.match(/^(\s*)([\w-]+)\s*:/);
    if (yamlKey && yamlKey[2] === word) {
      declarations.add(`${i}:${yamlKey[1]!.length}`);
      continue;
    }
    if (isFunctionDeclarationLine(line, word)) {
      declarations.add(`${i}:${line.indexOf(word)}`);
    }
  }
  return declarations;
}

function isFunctionDeclarationLine(line: string, word: string): boolean {
  const escaped = escapeHighlightRegex(word);
  if (new RegExp(`^\\s*def\\s+${escaped}\\s*\\(`).test(line)) return true;
  if (new RegExp(`^\\s*class\\s+${escaped}\\s*[\\(:]`).test(line)) return true;
  if (new RegExp(`^\\s*(?:export\\s+(?:default\\s+)?)?function\\s+${escaped}\\s*\\(`).test(line)) return true;
  if (new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=`).test(line)) return true;
  return false;
}

function isHighlightBoundary(ch: string): boolean {
  if (ch === '') return true;
  return !/[A-Za-z0-9_-]/.test(ch);
}

function escapeHighlightRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSectionHighlightRanges(text: string, word: string): Range[] {
  const ranges: Range[] = [];
  for (const section of findSections(text)) {
    if (section.name === word) {
      ranges.push(section.range);
    }
  }
  return ranges;
}

function findModuleHighlightRanges(text: string, word: string): Range[] {
  const ranges: Range[] = [];
  for (const decl of findModuleDeclarations(text)) {
    if (decl.name === word) {
      ranges.push(decl.range);
    }
  }
  return ranges;
}

function findCodeHighlightRanges(text: string, word: string): Range[] {
  const ranges: Range[] = [];
  const lines = text.split('\n');
  const blocks = findCodeBlocks(text);
  const escaped = escapeHighlightRegex(word);
  const pattern = new RegExp(`\\b${escaped}\\b`);
  for (const block of blocks) {
    for (let i = block.range.start.line; i <= block.range.end.line && i < lines.length; i++) {
      const line = lines[i]!;
      const match = line.match(pattern);
      if (match && match.index !== undefined) {
        ranges.push(createRange(i, match.index, i, match.index + word.length));
      }
    }
  }
  return ranges;
}

function findVariableHighlightRanges(text: string, word: string): Range[] {
  const ranges: Range[] = [];
  for (const ref of findVariableReferences(text)) {
    if (ref.key === word) {
      ranges.push(ref.range);
    }
  }
  return ranges;
}

function collectAllHighlightRanges(text: string, word: string): Range[] {
  return [
    ...findSectionHighlightRanges(text, word),
    ...findModuleHighlightRanges(text, word),
    ...findCodeHighlightRanges(text, word),
    ...findVariableHighlightRanges(text, word),
  ];
}

function deduplicateHighlightRanges(ranges: Range[]): Range[] {
  const seen = new Set<string>();
  const result: Range[] = [];
  for (const range of ranges) {
    const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(range);
    }
  }
  return result;
}

function countWriteHighlights(highlights: DocumentHighlight[]): number {
  return highlights.filter(h => h.kind === DocumentHighlightKind.Write).length;
}

function countReadHighlights(highlights: DocumentHighlight[]): number {
  return highlights.filter(h => h.kind === DocumentHighlightKind.Read).length;
}

function getHighlightKindName(kind: number | undefined): string {
  if (kind === DocumentHighlightKind.Write) return 'write';
  if (kind === DocumentHighlightKind.Read) return 'read';
  return 'text';
}

function summarizeHighlights(highlights: DocumentHighlight[]): string {
  const writes = countWriteHighlights(highlights);
  const reads = countReadHighlights(highlights);
  return `${highlights.length} highlights (${writes} write, ${reads} read)`;
}

function mergeHighlightRanges(ranges: Range[]): Range[] {
  const sorted = deduplicateHighlightRanges(ranges).sort((a, b) =>
    a.start.line - b.start.line || a.start.character - b.start.character,
  );
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start.line === last.end.line && range.start.character <= last.end.character) {
      last.end = range.end;
    } else {
      merged.push({ ...range, start: { ...range.start }, end: { ...range.end } });
    }
  }
  return merged;
}

function getHighlightCoverage(highlights: DocumentHighlight[], lineCount: number): number {
  if (lineCount <= 0) return 0;
  const lines = new Set(highlights.map(h => h.range.start.line));
  return lines.size / lineCount;
}

function inferMergedHighlightKind(highlights: DocumentHighlight[], range: Range): DocumentHighlightKind {
  for (const highlight of highlights) {
    if (highlight.range.start.line === range.start.line &&
      highlight.range.start.character === range.start.character) {
      return highlight.kind ?? DocumentHighlightKind.Text;
    }
  }
  return DocumentHighlightKind.Text;
}

function findDeclarationHighlight(highlights: DocumentHighlight[]): DocumentHighlight | undefined {
  return highlights.find(highlight => highlight.kind === DocumentHighlightKind.Write);
}

function getHighlightSummary(highlights: DocumentHighlight[]): string {
  const declaration = findDeclarationHighlight(highlights);
  const declarationPart = declaration
    ? `, declaration at line ${declaration.range.start.line + 1}`
    : ', no declaration';
  return summarizeHighlights(highlights) + declarationPart;
}

function getHighlightsOnLine(highlights: DocumentHighlight[], line: number): DocumentHighlight[] {
  return highlights.filter(highlight => highlight.range.start.line === line);
}

function hasWriteHighlight(highlights: DocumentHighlight[]): boolean {
  return findDeclarationHighlight(highlights) !== undefined;
}
