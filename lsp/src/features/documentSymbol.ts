import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule } from '@mam/parser';
import {
  MAMDocumentSymbol,
  MAMSymbolKind,
  findSections,
  findCodeBlocks,
  findModuleDeclarations,
  findVariableReferences,
} from '../protocol/mam.js';

export function getDocumentSymbols(document: TextDocument, ast?: MAMModule | null): MAMDocumentSymbol[] {
  const text = document.getText();
  const lines = text.split('\n');
  const symbols: MAMDocumentSymbol[] = [];
  symbols.push(...getModuleSymbolEntries(text));
  symbols.push(...getSectionSymbolEntries(text, lines));
  if (ast === undefined || ast === null) {
    return symbols;
  }
  return symbols;
}

export function hasDocumentSymbols(document: TextDocument, ast?: MAMModule | null): boolean {
  return getDocumentSymbols(document, ast).length > 0;
}

export function countDocumentSymbols(document: TextDocument, ast?: MAMModule | null): number {
  let total = 0;
  const visit = (symbols: MAMDocumentSymbol[]): void => {
    for (const symbol of symbols) {
      total++;
      visit(symbol.children);
    }
  };
  visit(getDocumentSymbols(document, ast));
  return total;
}

export function findSymbolByName(document: TextDocument, name: string, ast?: MAMModule | null): MAMDocumentSymbol | undefined {
  return flattenSymbols(getDocumentSymbols(document, ast)).find(symbol => symbol.name === name);
}

export function filterSymbolsByKind(document: TextDocument, kind: MAMSymbolKind, ast?: MAMModule | null): MAMDocumentSymbol[] {
  return flattenSymbols(getDocumentSymbols(document, ast)).filter(symbol => symbol.kind === kind);
}

export function flattenSymbols(symbols: MAMDocumentSymbol[]): MAMDocumentSymbol[] {
  const flat: MAMDocumentSymbol[] = [];
  const visit = (nodes: MAMDocumentSymbol[]): void => {
    for (const node of nodes) {
      flat.push(node);
      visit(node.children);
    }
  };
  visit(symbols);
  return flat;
}

export function getSymbolNames(document: TextDocument, ast?: MAMModule | null): string[] {
  return flattenSymbols(getDocumentSymbols(document, ast)).map(symbol => symbol.name);
}

function getModuleSymbolEntries(text: string): MAMDocumentSymbol[] {
  const declarations = findModuleDeclarations(text);
  return declarations.map(decl => ({
    name: decl.name,
    kind: MAMSymbolKind.Module,
    range: {
      start: { line: decl.range.start.line, character: decl.range.start.character },
      end: { line: decl.range.end.line, character: decl.range.end.character },
    },
    children: [],
  }));
}

function getSectionSymbolEntries(text: string, lines: string[]): MAMDocumentSymbol[] {
  const sections = findSections(text);
  const blocks = findCodeBlocks(text);
  const tables = findTableRanges(lines);
  const lists = findListRanges(lines);
  const variables = findVariableReferences(text);
  const symbols: MAMDocumentSymbol[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const endLine = endLineForSection(sections, i, lines.length - 1);
    const range = {
      start: { line: section.line, character: 0 },
      end: { line: endLine, character: lines[endLine]!.length },
    };
    const children: MAMDocumentSymbol[] = [];
    children.push(...getCodeBlockChildSymbols(blocks, lines, section.line, endLine, text));
    children.push(...getTableChildSymbols(tables, lines, section.line, endLine));
    children.push(...getListChildSymbols(lists, lines, section.line, endLine));
    children.push(...getVariableChildSymbols(variables, section.line, endLine));
    children.sort((a, b) => a.range.start.line - b.range.start.line);
    symbols.push({
      name: section.name,
      kind: MAMSymbolKind.Section,
      range,
      children,
    });
  }
  return symbols;
}

function getCodeBlockChildSymbols(
  blocks: Array<{ language: string; line: number; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>,
  lines: string[],
  startLine: number,
  endLine: number,
  text: string,
): MAMDocumentSymbol[] {
  const children: MAMDocumentSymbol[] = [];
  for (const block of blocks) {
    if (block.line <= startLine || block.line > endLine) continue;
    const blockEnd = block.range.end.line;
    const nested = getFunctionChildSymbols(text, lines, block);
    children.push({
      name: `${block.language} block`,
      kind: MAMSymbolKind.CodeBlock,
      range: {
        start: { line: block.line, character: 0 },
        end: { line: blockEnd, character: lines[blockEnd]!.length },
      },
      children: nested,
    });
  }
  return children;
}

function getTableChildSymbols(
  tables: Array<{ line: number; endLine: number; columns: number }>,
  lines: string[],
  startLine: number,
  endLine: number,
): MAMDocumentSymbol[] {
  const children: MAMDocumentSymbol[] = [];
  let index = 0;
  for (const table of tables) {
    if (table.endLine < startLine || table.line > endLine) continue;
    index++;
    children.push({
      name: `table ${index} (${table.columns} columns)`,
      kind: MAMSymbolKind.Table,
      range: {
        start: { line: table.line, character: 0 },
        end: { line: table.endLine, character: lines[table.endLine]!.length },
      },
      children: [],
    });
  }
  return children;
}

function getListChildSymbols(
  lists: Array<{ line: number; endLine: number; items: number }>,
  lines: string[],
  startLine: number,
  endLine: number,
): MAMDocumentSymbol[] {
  const children: MAMDocumentSymbol[] = [];
  let index = 0;
  for (const list of lists) {
    if (list.endLine < startLine || list.line > endLine) continue;
    index++;
    children.push({
      name: `list ${index} (${list.items} items)`,
      kind: MAMSymbolKind.List,
      range: {
        start: { line: list.line, character: 0 },
        end: { line: list.endLine, character: lines[list.endLine]!.length },
      },
      children: [],
    });
  }
  return children;
}

function getVariableChildSymbols(
  variables: Array<{ key: string; line: number; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>,
  startLine: number,
  endLine: number,
): MAMDocumentSymbol[] {
  const children: MAMDocumentSymbol[] = [];
  const seen = new Set<string>();
  for (const variable of variables) {
    if (variable.line <= startLine || variable.line > endLine) continue;
    const key = `${variable.key}:${variable.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    children.push({
      name: variable.key,
      kind: MAMSymbolKind.Variable,
      range: {
        start: { line: variable.range.start.line, character: variable.range.start.character },
        end: { line: variable.range.end.line, character: variable.range.end.character },
      },
      children: [],
    });
  }
  return children;
}

function getFunctionChildSymbols(
  text: string,
  lines: string[],
  block: { language: string; line: number; range: { start: { line: number; character: number }; end: { line: number; character: number } } },
): MAMDocumentSymbol[] {
  const children: MAMDocumentSymbol[] = [];
  const start = block.range.start.line;
  const end = block.range.end.line;
  for (let i = start; i <= end && i < lines.length; i++) {
    const line = lines[i]!;
    const pyFunc = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (pyFunc) {
      children.push(makeFunctionSymbol(pyFunc[1]!, MAMSymbolKind.Function, i, line.indexOf(pyFunc[1]!)));
      continue;
    }
    const pyClass = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]/);
    if (pyClass) {
      children.push(makeFunctionSymbol(pyClass[1]!, MAMSymbolKind.Class, i, line.indexOf(pyClass[1]!)));
      continue;
    }
    const jsFunc = line.match(/^\s*(?:export\s+(?:default\s+)?)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (jsFunc) {
      children.push(makeFunctionSymbol(jsFunc[1]!, MAMSymbolKind.Function, i, line.indexOf(jsFunc[1]!)));
      continue;
    }
    const jsConst = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/);
    if (jsConst) {
      children.push(makeFunctionSymbol(jsConst[1]!, MAMSymbolKind.Function, i, line.indexOf(jsConst[1]!)));
      continue;
    }
    const jsArrow = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
    if (jsArrow) {
      children.push(makeFunctionSymbol(jsArrow[1]!, MAMSymbolKind.Function, i, line.indexOf(jsArrow[1]!)));
      continue;
    }
  }
  void text;
  return children;
}

function makeFunctionSymbol(name: string, kind: MAMSymbolKind, line: number, character: number): MAMDocumentSymbol {
  return {
    name,
    kind,
    range: {
      start: { line, character },
      end: { line, character: character + name.length },
    },
    children: [],
  };
}

function findTableRanges(lines: string[]): Array<{ line: number; endLine: number; columns: number }> {
  const tables: Array<{ line: number; endLine: number; columns: number }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1]!)) {
      const columns = countTableColumns(line);
      let endLine = i + 1;
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]!)) {
        endLine = j;
        j++;
      }
      tables.push({ line: i, endLine, columns });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function findListRanges(lines: string[]): Array<{ line: number; endLine: number; items: number }> {
  const lists: Array<{ line: number; endLine: number; items: number }> = [];
  let i = 0;
  while (i < lines.length) {
    if (!isListItem(lines[i]!)) {
      i++;
      continue;
    }
    const start = i;
    let items = 0;
    while (i < lines.length && (isListItem(lines[i]!) || isListContinuation(lines[i]!))) {
      if (isListItem(lines[i]!)) items++;
      i++;
    }
    lists.push({ line: start, endLine: i - 1, items });
  }
  return lists;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|', 1);
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  const cells = trimmed.slice(1, -1).split('|');
  if (cells.length === 0) return false;
  return cells.every(cell => /^:?-{2,}:?$/.test(cell.trim()));
}

function countTableColumns(headerLine: string): number {
  const trimmed = headerLine.trim();
  return trimmed.slice(1, -1).split('|').length;
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line);
}

function isListContinuation(line: string): boolean {
  if (line.trim() === '') return false;
  if (/^#{1,6}\s+/.test(line)) return false;
  if (line.trim().startsWith('```')) return false;
  return /^\s{2,}\S/.test(line);
}

function endLineForSection(
  sections: Array<{ name: string; line: number; level: number }>,
  index: number,
  lastLine: number,
): number {
  if (index + 1 < sections.length) {
    return sections[index + 1]!.line - 1;
  }
  return lastLine;
}
