import type { TextDocument } from 'vscode-languageserver-textdocument';
import { TextEdit, Range } from 'vscode-languageserver-protocol';
import {
  getWordAtPosition,
  createRange,
  findSections,
  findModuleDeclarations,
  findCodeBlocks,
  findVariableReferences,
} from '../protocol/mam.js';

export function prepareRename(
  document: TextDocument,
  position: { line: number; character: number },
): { range: Range; placeholder: string } | null {
  const range = getRenameRange(document, position);
  if (!range) return null;
  const lines = document.getText().split('\n');
  const line = lines[position.line];
  if (!line) return null;
  const word = getWordAtPosition(line, position.character);
  if (!word) return null;
  return { range, placeholder: word };
}

export function getRenameEdits(
  document: TextDocument,
  position: { line: number; character: number },
  newName: string,
): { changes: Record<string, TextEdit[]> } {
  if (!validateNewName(newName)) return { changes: {} };
  const targets = findRenameTargets(document, position);
  if (targets.length === 0) return { changes: {} };
  const edits: TextEdit[] = targets.map(target => ({ range: target, newText: newName }));
  return { changes: { [document.uri]: edits } };
}

export function isRenameableAt(
  document: TextDocument,
  position: { line: number; character: number },
): boolean {
  return getRenameRange(document, position) !== null;
}

export function getRenameRange(
  document: TextDocument,
  position: { line: number; character: number },
): Range | null {
  const lines = document.getText().split('\n');
  const line = lines[position.line];
  if (!line) return null;
  const word = getWordAtPosition(line, position.character);
  if (!word) return null;
  if (!isRenameableWord(word, line, position.character)) return null;
  const start = findWordStart(line, word, position.character);
  return createRange(position.line, start, position.line, start + word.length);
}

export function countRenameTargets(
  document: TextDocument,
  position: { line: number; character: number },
): number {
  return findRenameTargets(document, position).length;
}

export function validateNewName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.length > 128) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return false;
  return true;
}

export function findRenameTargets(
  document: TextDocument,
  position: { line: number; character: number },
): Range[] {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return [];
  const word = getWordAtPosition(line, position.character);
  if (!word) return [];
  const kind = classifyRenameWord(word, line, text, position);
  if (kind === 'section') {
    return findSectionRenameTargets(word, text);
  }
  if (kind === 'module') {
    return findModuleRenameTargets(word, text);
  }
  if (kind === 'function') {
    return findFunctionRenameTargets(word, text);
  }
  return findVariableRenameTargets(word, text);
}

function classifyRenameWord(
  word: string,
  line: string,
  text: string,
  position: { line: number; character: number },
): 'section' | 'module' | 'function' | 'variable' {
  const heading = line.match(/^#{1,6}\s+(.+)/);
  if (heading && heading[1]!.trim() === word) return 'section';
  if (isModuleDeclarationLine(line, word)) return 'module';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i]!;
    if (isFunctionDefinitionLine(current, word)) {
      return 'function';
    }
  }
  void position;
  return 'variable';
}

function isModuleDeclarationLine(line: string, word: string): boolean {
  const match = line.match(/^(module|agent|tool|memory|workflow|team|policy|system|service|component|resource|interface|contract|plugin|extension|runtime|package|repository|documentation)\s+(.+)/);
  if (!match) return false;
  return match[2]!.trim().split(/\s+/)[0] === word;
}

function isFunctionDefinitionLine(line: string, word: string): boolean {
  const escaped = escapeRenameRegex(word);
  if (new RegExp(`^\\s*def\\s+${escaped}\\s*\\(`).test(line)) return true;
  if (new RegExp(`^\\s*class\\s+${escaped}\\s*[\\(:]`).test(line)) return true;
  if (new RegExp(`^\\s*(?:export\\s+(?:default\\s+)?)?function\\s+${escaped}\\s*\\(`).test(line)) return true;
  if (new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\s*=`).test(line)) return true;
  return false;
}

function isRenameableWord(word: string, line: string, character: number): boolean {
  if (word.length === 0) return false;
  if (/^(import|export|from|return|if|else|for|while|def|class|function|const|let|var)$/.test(word)) {
    return false;
  }
  const fence = line.trim().startsWith('```');
  if (fence) return false;
  void character;
  return true;
}

function findWordStart(line: string, word: string, character: number): number {
  let start = character;
  while (start > 0 && isRenameChar(line[start - 1]!)) start--;
  if (line.slice(start, start + word.length) !== word) {
    const idx = line.indexOf(word);
    return idx >= 0 ? idx : start;
  }
  return start;
}

function findSectionRenameTargets(word: string, text: string): Range[] {
  const targets: Range[] = [];
  const sections = findSections(text);
  const lines = text.split('\n');
  for (const section of sections) {
    if (section.name !== word) continue;
    const line = lines[section.line]!;
    const idx = line.indexOf(word);
    if (idx >= 0) {
      targets.push(createRange(section.line, idx, section.line, idx + word.length));
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,6}\s+/.test(line)) continue;
    targets.push(...scanLineOccurrences(lines, i, word, 'word'));
  }
  return deduplicateRenameRanges(targets);
}

function findModuleRenameTargets(word: string, text: string): Range[] {
  const targets: Range[] = [];
  const declarations = findModuleDeclarations(text);
  const lines = text.split('\n');
  for (const decl of declarations) {
    if (decl.name !== word) continue;
    targets.push(decl.range);
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isModuleDeclarationLine(line, word)) continue;
    targets.push(...scanLineOccurrences(lines, i, word, 'word'));
  }
  return deduplicateRenameRanges(targets);
}

function findFunctionRenameTargets(word: string, text: string): Range[] {
  const targets: Range[] = [];
  const lines = text.split('\n');
  const blocks = findCodeBlocks(text);
  const inBlock = (line: number): boolean =>
    blocks.some(block => line >= block.range.start.line && line <= block.range.end.line);
  for (let i = 0; i < lines.length; i++) {
    if (!inBlock(i)) continue;
    targets.push(...scanLineOccurrences(lines, i, word, 'code'));
  }
  return deduplicateRenameRanges(targets);
}

function findVariableRenameTargets(word: string, text: string): Range[] {
  const targets: Range[] = [];
  targets.push(...findYamlKeyRenameTargets(word, text));
  targets.push(...findTextOccurrenceRenameTargets(word, text));
  return deduplicateRenameRanges(targets);
}

function findYamlKeyRenameTargets(word: string, text: string): Range[] {
  const targets: Range[] = [];
  const refs = findVariableReferences(text);
  for (const ref of refs) {
    if (ref.key !== word) continue;
    targets.push(ref.range);
  }
  return targets;
}

function findTextOccurrenceRenameTargets(word: string, text: string): Range[] {
  const targets: Range[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,6}\s+/.test(line)) continue;
    if (line.trim().startsWith('```')) continue;
    if (isReservedRenameWord(line, i, word)) continue;
    targets.push(...scanLineOccurrences(lines, i, word, 'word'));
  }
  return targets;
}

function isReservedRenameWord(line: string, lineIndex: number, word: string): boolean {
  void lineIndex;
  const reserved = getReservedRenameWords();
  if (!reserved.has(word)) return false;
  return new RegExp(`\\b${escapeRenameRegex(word)}\\b`).test(line);
}

function getReservedRenameWords(): Set<string> {
  return new Set([
    'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while',
    'def', 'class', 'function', 'const', 'let', 'var', 'true', 'false',
    'null', 'none', 'and', 'or', 'not', 'in', 'is', 'async', 'await',
  ]);
}

function scanLineOccurrences(
  lines: string[],
  lineIndex: number,
  word: string,
  mode: 'word' | 'code',
): Range[] {
  const ranges: Range[] = [];
  const line = lines[lineIndex]!;
  let from = 0;
  while (from <= line.length - word.length) {
    const idx = line.indexOf(word, from);
    if (idx < 0) break;
    const before = idx === 0 ? '' : line[idx - 1]!;
    const after = idx + word.length >= line.length ? '' : line[idx + word.length]!;
    if (isRenameBoundary(before, mode) && isRenameBoundary(after, mode)) {
      ranges.push(createRange(lineIndex, idx, lineIndex, idx + word.length));
    }
    from = idx + word.length;
  }
  return ranges;
}

function isRenameBoundary(ch: string, mode: 'word' | 'code'): boolean {
  if (ch === '') return true;
  if (mode === 'code') {
    return !/[A-Za-z0-9_]/.test(ch);
  }
  return !/[A-Za-z0-9_-]/.test(ch);
}

function isRenameChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch);
}

function deduplicateRenameRanges(ranges: Range[]): Range[] {
  const seen = new Set<string>();
  const result: Range[] = [];
  for (const range of ranges) {
    const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(range);
    }
  }
  result.sort((a, b) =>
    a.start.line - b.start.line || a.start.character - b.start.character,
  );
  return result;
}

function escapeRenameRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRenameWordAt(line: string, character: number): string | null {
  if (character < 0 || character > line.length) return null;
  let start = character;
  let end = character;
  while (start > 0 && isRenameChar(line[start - 1]!)) start--;
  while (end < line.length && isRenameChar(line[end]!)) end++;
  if (start === end) return null;
  return line.slice(start, end);
}
