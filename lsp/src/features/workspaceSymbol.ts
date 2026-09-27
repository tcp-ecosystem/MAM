import type { TextDocument } from 'vscode-languageserver-textdocument';
import { SymbolInformation, SymbolKind, Location } from 'vscode-languageserver-protocol';
import {
  createLocation,
  createRange,
  findSections,
  findModuleDeclarations,
  findCodeBlocks,
  findVariableReferences,
} from '../protocol/mam.js';

export function getWorkspaceSymbols(documents: TextDocument[], query: string): SymbolInformation[] {
  const symbols: SymbolInformation[] = [];
  for (const document of documents) {
    symbols.push(...collectDocumentSymbols(document));
  }
  return sortWorkspaceSymbols(filterSymbolsByQuery(symbols, query));
}

export function hasWorkspaceSymbol(documents: TextDocument[], query: string): boolean {
  return getWorkspaceSymbols(documents, query).length > 0;
}

export function countWorkspaceSymbols(documents: TextDocument[], query: string): number {
  return getWorkspaceSymbols(documents, query).length;
}

export function filterSymbolsByQuery(symbols: SymbolInformation[], query: string): SymbolInformation[] {
  const normalized = query.toLowerCase();
  if (normalized.length === 0) return [...symbols];
  return symbols.filter(symbol => symbol.name.toLowerCase().includes(normalized));
}

export function sortWorkspaceSymbols(symbols: SymbolInformation[]): SymbolInformation[] {
  return [...symbols].sort((a, b) => a.name.localeCompare(b.name));
}

export function getWorkspaceSymbolNames(documents: TextDocument[], query: string): string[] {
  return getWorkspaceSymbols(documents, query).map(symbol => symbol.name);
}

export function groupSymbolsByDocument(symbols: SymbolInformation[]): Map<string, SymbolInformation[]> {
  const groups = new Map<string, SymbolInformation[]>();
  for (const symbol of symbols) {
    const uri = symbol.location.uri;
    let group = groups.get(uri);
    if (group === undefined) {
      group = [];
      groups.set(uri, group);
    }
    group.push(symbol);
  }
  return groups;
}

function collectDocumentSymbols(document: TextDocument): SymbolInformation[] {
  const text = document.getText();
  const uri = document.uri;
  const symbols: SymbolInformation[] = [];
  symbols.push(...collectSectionSymbols(text, uri));
  symbols.push(...collectModuleSymbols(text, uri));
  symbols.push(...collectCodeBlockSymbols(text, uri));
  symbols.push(...collectYamlKeySymbols(text, uri));
  symbols.push(...collectFunctionSymbols(text, uri));
  symbols.push(...collectTableSymbols(text, uri));
  symbols.push(...collectListSymbols(text, uri));
  return symbols;
}

function collectSectionSymbols(text: string, uri: string): SymbolInformation[] {
  return findSections(text).map(section => ({
    name: section.name,
    kind: SymbolKind.Class,
    location: createLocation(uri, section.range),
    containerName: undefined,
  }));
}

function collectModuleSymbols(text: string, uri: string): SymbolInformation[] {
  return findModuleDeclarations(text).map(decl => ({
    name: decl.name,
    kind: SymbolKind.Module,
    location: createLocation(uri, decl.range),
    containerName: decl.type,
  }));
}

function collectCodeBlockSymbols(text: string, uri: string): SymbolInformation[] {
  const lines = text.split('\n');
  return findCodeBlocks(text).map((block, index) => ({
    name: `${block.language} block ${index + 1}`,
    kind: SymbolKind.Function,
    location: createLocation(
      uri,
      createRange(block.line, 0, block.range.end.line, lines[block.range.end.line]!.length),
    ),
    containerName: undefined,
  }));
}

function collectYamlKeySymbols(text: string, uri: string): SymbolInformation[] {
  const seen = new Set<string>();
  const symbols: SymbolInformation[] = [];
  for (const ref of findVariableReferences(text)) {
    if (seen.has(ref.key)) continue;
    seen.add(ref.key);
    symbols.push({
      name: ref.key,
      kind: SymbolKind.Variable,
      location: createLocation(uri, ref.range),
      containerName: 'frontmatter',
    });
  }
  return symbols;
}

function collectFunctionSymbols(text: string, uri: string): SymbolInformation[] {
  const lines = text.split('\n');
  const symbols: SymbolInformation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pyFunc = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (pyFunc) {
      symbols.push(makeFunctionSymbolInfo(uri, pyFunc[1]!, i, line.indexOf(pyFunc[1]!), SymbolKind.Function));
      continue;
    }
    const pyClass = line.match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[\(:]/);
    if (pyClass) {
      symbols.push(makeFunctionSymbolInfo(uri, pyClass[1]!, i, line.indexOf(pyClass[1]!), SymbolKind.Class));
      continue;
    }
    const jsFunc = line.match(/^\s*(?:export\s+(?:default\s+)?)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (jsFunc) {
      symbols.push(makeFunctionSymbolInfo(uri, jsFunc[1]!, i, line.indexOf(jsFunc[1]!), SymbolKind.Function));
      continue;
    }
    const jsConst = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/);
    if (jsConst) {
      symbols.push(makeFunctionSymbolInfo(uri, jsConst[1]!, i, line.indexOf(jsConst[1]!), SymbolKind.Variable));
      continue;
    }
  }
  return symbols;
}

function collectTableSymbols(text: string, uri: string): SymbolInformation[] {
  const lines = text.split('\n');
  const symbols: SymbolInformation[] = [];
  let tableIndex = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!isSymbolTableRow(line) || i + 1 >= lines.length || !isSymbolSeparatorRow(lines[i + 1]!)) {
      i++;
      continue;
    }
    tableIndex++;
    const columns = line.trim().slice(1, -1).split('|').length;
    let endLine = i + 1;
    let j = i + 2;
    while (j < lines.length && isSymbolTableRow(lines[j]!)) {
      endLine = j;
      j++;
    }
    symbols.push({
      name: `table ${tableIndex} (${columns} columns)`,
      kind: SymbolKind.Struct,
      location: createLocation(uri, createRange(i, 0, endLine, lines[endLine]!.length)),
      containerName: undefined,
    });
    i = j;
  }
  return symbols;
}

function collectListSymbols(text: string, uri: string): SymbolInformation[] {
  const lines = text.split('\n');
  const symbols: SymbolInformation[] = [];
  let listIndex = 0;
  let i = 0;
  while (i < lines.length) {
    if (!isSymbolListItem(lines[i]!)) {
      i++;
      continue;
    }
    listIndex++;
    const start = i;
    let items = 0;
    while (i < lines.length && (isSymbolListItem(lines[i]!) || isSymbolListContinuation(lines[i]!))) {
      if (isSymbolListItem(lines[i]!)) items++;
      i++;
    }
    symbols.push({
      name: `list ${listIndex} (${items} items)`,
      kind: SymbolKind.Array,
      location: createLocation(uri, createRange(start, 0, i - 1, lines[i - 1]!.length)),
      containerName: undefined,
    });
  }
  return symbols;
}

function isSymbolTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function isSymbolSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
  return trimmed.slice(1, -1).split('|').every(cell => /^:?-{2,}:?$/.test(cell.trim()));
}

function isSymbolListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line);
}

function isSymbolListContinuation(line: string): boolean {
  if (line.trim() === '') return false;
  if (/^#{1,6}\s+/.test(line)) return false;
  if (line.trim().startsWith('```')) return false;
  return /^\s+\S/.test(line);
}

function makeFunctionSymbolInfo(
  uri: string,
  name: string,
  line: number,
  character: number,
  kind: SymbolKind,
): SymbolInformation {
  return {
    name,
    kind,
    location: createLocation(uri, createRange(line, character, line, character + name.length)),
    containerName: undefined,
  };
}

function filterSymbolsByKind(symbols: SymbolInformation[], kind: SymbolKind): SymbolInformation[] {
  return symbols.filter(symbol => symbol.kind === kind);
}

function findSymbolByName(symbols: SymbolInformation[], name: string): SymbolInformation | undefined {
  return symbols.find(symbol => symbol.name === name);
}

function fuzzyMatchSymbol(name: string, query: string): boolean {
  const target = name.toLowerCase();
  const pattern = query.toLowerCase();
  if (pattern.length === 0) return true;
  let position = 0;
  for (const ch of pattern) {
    const idx = target.indexOf(ch, position);
    if (idx < 0) return false;
    position = idx + 1;
  }
  return true;
}

function filterSymbolsFuzzy(symbols: SymbolInformation[], query: string): SymbolInformation[] {
  return symbols.filter(symbol => fuzzyMatchSymbol(symbol.name, query));
}

function scoreSymbolMatch(name: string, query: string): number {
  const target = name.toLowerCase();
  const pattern = query.toLowerCase();
  if (target === pattern) return 0;
  if (target.startsWith(pattern)) return 1;
  if (target.includes(pattern)) return 2;
  if (fuzzyMatchSymbol(name, query)) return 3;
  return 4;
}

function sortSymbolsByRelevance(symbols: SymbolInformation[], query: string): SymbolInformation[] {
  return [...symbols].sort((a, b) =>
    scoreSymbolMatch(a.name, query) - scoreSymbolMatch(b.name, query) ||
    a.name.localeCompare(b.name),
  );
}

function getTopSymbols(symbols: SymbolInformation[], limit: number): SymbolInformation[] {
  return symbols.slice(0, Math.max(0, limit));
}

function countSymbolsByKind(symbols: SymbolInformation[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const symbol of symbols) {
    counts[symbol.kind] = (counts[symbol.kind] ?? 0) + 1;
  }
  return counts;
}

function groupSymbolsByKind(symbols: SymbolInformation[]): Map<SymbolKind, SymbolInformation[]> {
  const groups = new Map<SymbolKind, SymbolInformation[]>();
  for (const symbol of symbols) {
    let group = groups.get(symbol.kind);
    if (group === undefined) {
      group = [];
      groups.set(symbol.kind, group);
    }
    group.push(symbol);
  }
  return groups;
}

function getSymbolLocations(symbols: SymbolInformation[]): Location[] {
  return symbols.map(symbol => symbol.location);
}

function getSymbolUris(symbols: SymbolInformation[]): string[] {
  return Array.from(new Set(symbols.map(symbol => symbol.location.uri)));
}

function mergeSymbolLists(primary: SymbolInformation[], secondary: SymbolInformation[]): SymbolInformation[] {
  const seen = new Set<string>();
  const merged: SymbolInformation[] = [];
  for (const symbol of [...primary, ...secondary]) {
    const key = `${symbol.location.uri}:${symbol.name}:${symbol.location.range.start.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(symbol);
    }
  }
  return merged;
}
