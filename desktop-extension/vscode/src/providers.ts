/**
 * MAM language service providers.
 *
 * - MamFormattingProvider: trim trailing whitespace, collapse the tail to a
 *   single newline, and normalize frontmatter delimiter indentation.
 * - MamFoldingProvider: fold the YAML frontmatter block, each heading section,
 *   and fenced code blocks.
 * - MamDocumentSymbolProvider: `#` title → module, `##` → section,
 *   `###` → sub-section (e.g. capabilities).
 * - MamHoverProvider: rich hover over section headings and frontmatter keys.
 */

import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export class MamFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    _token: vscode.CancellationToken,
  ): vscode.TextEdit[] {
    const edits: vscode.TextEdit[] = [];

    // 1. Trim trailing whitespace on every line.
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const match = /[ \t]+$/.exec(line.text);
      if (match) {
        edits.push(
          vscode.TextEdit.replace(
            new vscode.Range(line.lineNumber, match.index, line.lineNumber, line.text.length),
            '',
          ),
        );
      }
    }

    // 2. Normalize frontmatter delimiters to column 0.
    const raw = document.getText();
    const lines = raw.split('\n');
    const fixDelimiter = (text: string): string | null => {
      const m = /^\s+(---)\s*$/.exec(text);
      return m ? '---' : null;
    };
    for (let i = 0; i < Math.min(lines.length, 200); i++) {
      const fixed = fixDelimiter(lines[i]!);
      if (fixed !== null) {
        edits.push(
          vscode.TextEdit.replace(
            new vscode.Range(i, 0, i, lines[i]!.length),
            fixed,
          ),
        );
      }
    }

    // 3. Enforce a single trailing newline at EOF.
    if (raw.length > 0) {
      const trailing = /(\n+)$/.exec(raw);
      if (trailing) {
        const extra = trailing[1].length - 1;
        if (extra > 0) {
          const start = document.positionAt(raw.length - extra);
          const end = document.positionAt(raw.length);
          edits.push(vscode.TextEdit.replace(new vscode.Range(start, end), ''));
        }
      } else {
        edits.push(vscode.TextEdit.insert(document.positionAt(raw.length), '\n'));
      }
    }

    return edits;
  }
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

export class MamFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const lines = document.getText().split('\n');

    // Frontmatter block (--- ... ---).
    if (/^\s*---\s*$/.test(lines[0] ?? '')) {
      for (let i = 1; i < lines.length; i++) {
        if (/^\s*---\s*$/.test(lines[i]!)) {
          if (i > 1) ranges.push(new vscode.FoldingRange(0, i));
          break;
        }
      }
    }

    // Heading sections (fold each heading down to the next same-or-higher level).
    const headings: Array<{ level: number; line: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,6})\s+/.exec(lines[i]!);
      if (m) headings.push({ level: m[1].length, line: i });
    }
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i]!;
      let end = lines.length - 1;
      for (let j = i + 1; j < headings.length; j++) {
        if (headings[j]!.level <= heading.level) {
          end = headings[j]!.line - 1;
          break;
        }
      }
      if (end > heading.line) ranges.push(new vscode.FoldingRange(heading.line, end));
    }

    // Fenced code blocks.
    let inFence = false;
    let fenceStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i]!)) {
        if (!inFence) {
          inFence = true;
          fenceStart = i;
        } else {
          if (i > fenceStart) ranges.push(new vscode.FoldingRange(fenceStart, i));
          inFence = false;
        }
      }
    }

    return ranges;
  }
}

// ---------------------------------------------------------------------------
// Document Symbols (outline)
// ---------------------------------------------------------------------------

export class MamDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.DocumentSymbol[] {
    const root: vscode.DocumentSymbol[] = [];
    const stackLevels: number[] = [];
    const stackSymbols: vscode.DocumentSymbol[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      const match = /^(#{1,6})\s+(.*)$/.exec(text);
      if (!match) continue;

      const level = match[1].length;
      const name = match[2]!.trim();
      const lineRange = new vscode.Range(i, 0, i, text.length);

      const kind =
        level === 1
          ? vscode.SymbolKind.Module
          : level === 2
            ? vscode.SymbolKind.Namespace
            : level === 3
              ? vscode.SymbolKind.Class
              : vscode.SymbolKind.Method;

      const symbol = new vscode.DocumentSymbol(name, '', kind, lineRange, lineRange);

      while (stackLevels.length > 0 && stackLevels[stackLevels.length - 1]! >= level) {
        stackLevels.pop();
        stackSymbols.pop();
      }

      const parent = stackSymbols[stackSymbols.length - 1];
      if (parent) {
        parent.children.push(symbol);
      } else {
        root.push(symbol);
      }

      stackLevels.push(level);
      stackSymbols.push(symbol);
    }

    return root;
  }
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export class MamHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): vscode.Hover | undefined {
    const line = document.lineAt(position.line);

    // Hover over a heading: show the section name + its first paragraph.
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.text);
    if (headingMatch && position.character >= headingMatch[1].length) {
      const level = headingMatch[1].length;
      const name = headingMatch[2]!.trim();
      const body = this.sectionBody(document, position.line);
      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`**${'#'.repeat(level)} ${name}**`);
      if (body) {
        md.appendMarkdown('\n\n---\n\n');
        md.appendMarkdown(body);
      } else {
        md.appendMarkdown('\n\n_Empty section — add content._');
      }
      const headingRange = new vscode.Range(
        position.line,
        headingMatch[1].length,
        position.line,
        line.text.length,
      );
      return new vscode.Hover(md, headingRange);
    }

    // Hover over a frontmatter key: show metadata help.
    if (this.isFrontmatterLine(document, position.line)) {
      const kv = /^(\w[\w-]*)\s*:\s*(.*)$/.exec(line.text);
      if (kv) {
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**Frontmatter: \`${kv[1]}\`**`);
        if (kv[2]!.trim()) md.appendMarkdown(`\n\n\`${kv[2]!.trim()}\``);
        md.appendMarkdown('\n\n_MAM module metadata (YAML)._');
        return new vscode.Hover(md, new vscode.Range(position.line, 0, position.line, line.text.length));
      }
    }

    return undefined;
  }

  /** True when the given line is inside the YAML frontmatter block. */
  private isFrontmatterLine(document: vscode.TextDocument, line: number): boolean {
    const text = document.getText();
    const lines = text.split('\n');
    if (!/^\s*---\s*$/.test(lines[0] ?? '')) return false;
    if (line === 0) return true;
    for (let i = 1; i < lines.length && i <= line; i++) {
      if (/^\s*---\s*$/.test(lines[i]!)) return i > line;
    }
    return line > 0;
  }

  /** Collect the first non-empty paragraph after a heading (capped length). */
  private sectionBody(document: vscode.TextDocument, headingLine: number): string {
    const parts: string[] = [];
    for (let i = headingLine + 1; i < document.lineCount; i++) {
      const text = document.lineAt(i).text;
      if (/^#{1,6}\s+/.test(text)) break;
      if (text.trim() !== '') parts.push(text.trim());
      else if (parts.length > 0) break;
      if (parts.join(' ').length > 400) break;
    }
    return parts.join(' ').slice(0, 400);
  }
}