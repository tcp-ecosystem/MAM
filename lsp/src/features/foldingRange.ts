import type { TextDocument } from 'vscode-languageserver-textdocument';
import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver-protocol';
import {
  findSections,
  findCodeBlocks,
  findFrontmatterRange,
} from '../protocol/mam.js';

export function getFoldingRanges(document: TextDocument): FoldingRange[] {
  const ranges: FoldingRange[] = [];
  ranges.push(...getSectionFoldingRanges(document));
  ranges.push(...getCodeBlockFoldingRanges(document));
  const frontmatter = getFrontmatterFoldingRange(document);
  if (frontmatter) ranges.push(frontmatter);
  ranges.push(...getListFoldingRanges(document));
  ranges.push(...getTableFoldingRanges(document));
  ranges.push(...getMermaidFoldingRanges(document));
  ranges.push(...getCommentFoldingRanges(document));
  ranges.push(...getIndentedFoldingRanges(document));
  return normalizeFoldingRanges(ranges);
}

export function hasFoldingRanges(document: TextDocument): boolean {
  return getFoldingRanges(document).length > 0;
}

export function countFoldingRanges(document: TextDocument): number {
  return getFoldingRanges(document).length;
}

export function getSectionFoldingRanges(document: TextDocument): FoldingRange[] {
  const text = document.getText();
  const lines = text.split('\n');
  const sections = findSections(text);
  const ranges: FoldingRange[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const endLine = i + 1 < sections.length ? sections[i + 1]!.line - 1 : lines.length - 1;
    if (endLine - section.line >= 1) {
      ranges.push({
        startLine: section.line,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
        kind: FoldingRangeKind.Region,
      });
    }
  }
  return ranges;
}

export function getCodeBlockFoldingRanges(document: TextDocument): FoldingRange[] {
  const text = document.getText();
  const lines = text.split('\n');
  const ranges: FoldingRange[] = [];
  for (const block of findCodeBlocks(text)) {
    const endLine = block.range.end.line;
    if (endLine - block.line >= 1) {
      ranges.push({
        startLine: block.line,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
      });
    }
  }
  return ranges;
}

export function getFrontmatterFoldingRange(document: TextDocument): FoldingRange | null {
  const text = document.getText();
  const lines = text.split('\n');
  const range = findFrontmatterRange(text);
  if (!range) return null;
  if (range.end - range.start < 1) return null;
  return {
    startLine: range.start,
    startCharacter: 0,
    endLine: range.end,
    endCharacter: lines[range.end]!.length,
    kind: FoldingRangeKind.Comment,
  };
}

export function findLargestFoldingRange(document: TextDocument): FoldingRange | null {
  const ranges = getFoldingRanges(document);
  if (ranges.length === 0) return null;
  let largest = ranges[0]!;
  for (const range of ranges) {
    if (foldingRangeSize(range) > foldingRangeSize(largest)) {
      largest = range;
    }
  }
  return largest;
}

function getListFoldingRanges(document: TextDocument): FoldingRange[] {
  const lines = document.getText().split('\n');
  const ranges: FoldingRange[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isFoldingListItem(lines[i]!)) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && (isFoldingListItem(lines[i]!) || isFoldingListContinuation(lines[i]!))) {
      i++;
    }
    const endLine = i - 1;
    if (endLine - start >= 2) {
      ranges.push({
        startLine: start,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
      });
    }
  }
  return ranges;
}

function getTableFoldingRanges(document: TextDocument): FoldingRange[] {
  const lines = document.getText().split('\n');
  const ranges: FoldingRange[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isFoldingTableRow(lines[i]!)) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && isFoldingTableRow(lines[i]!)) {
      i++;
    }
    const endLine = i - 1;
    if (endLine - start >= 2) {
      ranges.push({
        startLine: start,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
      });
    }
  }
  return ranges;
}

function getMermaidFoldingRanges(document: TextDocument): FoldingRange[] {
  const text = document.getText();
  const lines = text.split('\n');
  const ranges: FoldingRange[] = [];
  for (const block of findCodeBlocks(text)) {
    if (block.language.toLowerCase() !== 'mermaid') continue;
    const endLine = block.range.end.line;
    if (endLine - block.line >= 1) {
      ranges.push({
        startLine: block.line,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
        kind: FoldingRangeKind.Region,
      });
    }
  }
  return ranges;
}

function getCommentFoldingRanges(document: TextDocument): FoldingRange[] {
  const lines = document.getText().split('\n');
  const ranges: FoldingRange[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isHtmlCommentStart(lines[i]!)) {
      i++;
      continue;
    }
    const start = i;
    let endLine = i;
    if (!isHtmlCommentEnd(lines[i]!)) {
      let j = i + 1;
      while (j < lines.length && !isHtmlCommentEnd(lines[j]!)) {
        j++;
      }
      if (j < lines.length) {
        endLine = j;
        i = j + 1;
      } else {
        i++;
        continue;
      }
    } else {
      i++;
    }
    if (endLine - start >= 1) {
      ranges.push({
        startLine: start,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
        kind: FoldingRangeKind.Comment,
      });
    }
  }
  return ranges;
}

function getIndentedFoldingRanges(document: TextDocument): FoldingRange[] {
  const lines = document.getText().split('\n');
  const ranges: FoldingRange[] = [];
  let i = 0;
  while (i < lines.length) {
    const indent = countIndent(lines[i]!);
    if (indent === 0 || lines[i]!.trim() === '') {
      i++;
      continue;
    }
    const start = i;
    let j = i + 1;
    while (j < lines.length && (lines[j]!.trim() === '' || countIndent(lines[j]!) >= indent)) {
      j++;
    }
    const endLine = j - 1;
    if (endLine - start >= 2 && hasDeeperIndent(lines, start, endLine, indent)) {
      ranges.push({
        startLine: start,
        startCharacter: 0,
        endLine,
        endCharacter: lines[endLine]!.length,
      });
    }
    i = j;
  }
  return ranges;
}

function normalizeFoldingRanges(ranges: FoldingRange[]): FoldingRange[] {
  const seen = new Set<string>();
  const result: FoldingRange[] = [];
  for (const range of ranges) {
    if (range.endLine <= range.startLine) continue;
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(range);
  }
  result.sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  return result;
}

function foldingRangeSize(range: FoldingRange): number {
  return range.endLine - range.startLine;
}

function foldingRangeContains(outer: FoldingRange, inner: FoldingRange): boolean {
  return outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
}

function findNestedFoldingRanges(ranges: FoldingRange[], parent: FoldingRange): FoldingRange[] {
  return ranges.filter(range => range !== parent && foldingRangeContains(parent, range));
}

function countIndent(line: string): number {
  let indent = 0;
  while (indent < line.length && (line[indent] === ' ' || line[indent] === '\t')) {
    indent++;
  }
  return indent;
}

function hasDeeperIndent(lines: string[], start: number, end: number, indent: number): boolean {
  for (let i = start + 1; i <= end; i++) {
    if (lines[i]!.trim() !== '' && countIndent(lines[i]!) > indent) {
      return true;
    }
  }
  return false;
}

function isFoldingListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line);
}

function isFoldingListContinuation(line: string): boolean {
  if (line.trim() === '') return true;
  if (/^#{1,6}\s+/.test(line)) return false;
  if (line.trim().startsWith('```')) return false;
  return /^\s+\S/.test(line);
}

function isFoldingTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isHtmlCommentStart(line: string): boolean {
  return line.includes('<!--');
}

function isHtmlCommentEnd(line: string): boolean {
  return line.includes('-->');
}
