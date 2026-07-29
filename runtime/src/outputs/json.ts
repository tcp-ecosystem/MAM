/**
 * JSON Output Formatter
 *
 * Configurable JSON serialization with pretty-printing, key sorting,
 * metadata wrapping, and section-aware formatting.
 */

export interface JSONOutputOptions {
  /** Number of spaces for indentation. 0 = compact. */
  indent?: number;
  /** Force compact output (overrides indent). */
  compact?: boolean;
  /** Wrap output in a `{ data, meta }` envelope. */
  includeMetadata?: boolean;
  /** Alias for indent > 0. */
  prettyPrint?: boolean;
  /** Alphabetically sort object keys. */
  sortKeys?: boolean;
}

interface FrontmatterData {
  [key: string]: unknown;
}

interface CodeBlockData {
  code: string;
  language?: string;
  filename?: string;
}

interface TableData {
  headers: string[];
  rows: string[][];
  alignments?: ('left' | 'center' | 'right')[];
}

interface ErrorData {
  message: string;
  stack?: string;
  code?: string;
}

const DEFAULT_OPTIONS: Required<JSONOutputOptions> = {
  indent: 2,
  compact: false,
  includeMetadata: false,
  prettyPrint: true,
  sortKeys: false,
};

export class JSONOutput {
  private opts: Required<JSONOutputOptions>;

  constructor(options?: JSONOutputOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    if (this.opts.prettyPrint && this.opts.indent === 0) {
      this.opts.indent = 2;
    }
  }

  // -----------------------------------------------------------------------
  // Core
  // -----------------------------------------------------------------------

  format(data: unknown, options?: JSONOutputOptions): string {
    const opts = { ...this.opts, ...options };
    const serialized = this.serialize(data, opts);

    if (opts.includeMetadata) {
      const envelope = {
        data: serialized.parsed,
        meta: {
          formattedAt: new Date().toISOString(),
          formatVersion: '1.0.0',
          mimeType: 'application/json',
        },
      };
      return this.stringify(envelope, opts);
    }

    return this.stringify(serialized.parsed, opts);
  }

  formatSections(sections: unknown[]): string {
    const formatted = sections.map((s) => {
      const section = s as Record<string, unknown>;
      return {
        name: section.name,
        content: this.coerceContent(section.content),
      };
    });
    return this.stringify(formatted, this.opts);
  }

  // -----------------------------------------------------------------------
  // Specialized formatters
  // -----------------------------------------------------------------------

  formatFrontmatter(fm: FrontmatterData): string {
    return this.stringify(fm, this.opts);
  }

  formatCodeBlock(block: CodeBlockData): string {
    return this.stringify(
      {
        code: block.code,
        language: block.language ?? 'text',
        filename: block.filename,
      },
      this.opts,
    );
  }

  formatTable(table: TableData): string {
    return this.stringify(
      {
        headers: table.headers,
        rows: table.rows,
        alignments: table.alignments,
      },
      this.opts,
    );
  }

  formatError(error: ErrorData): string {
    return this.stringify(
      {
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack,
        },
      },
      this.opts,
    );
  }

  // -----------------------------------------------------------------------
  // OutputFormatter interface
  // -----------------------------------------------------------------------

  getMimeType(): string {
    return 'application/json';
  }

  getExtension(): string {
    return '.json';
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------

  minify(data: unknown): string {
    return JSON.stringify(data);
  }

  prettify(json: string, indent?: number): string {
    const parsed = JSON.parse(json);
    return JSON.stringify(parsed, null, indent ?? this.opts.indent);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private stringify(data: unknown, opts: Required<JSONOutputOptions>): string {
    const space = opts.compact ? 0 : opts.indent;
    if (opts.sortKeys) {
      return JSON.stringify(data, this.createSortedReplacer(), space);
    }
    return JSON.stringify(data, null, space);
  }

  private serialize(data: unknown, opts: Required<JSONOutputOptions>): { parsed: unknown } {
    if (data === null || data === undefined) {
      return { parsed: null };
    }
    if (typeof data === 'string') {
      try {
        return { parsed: JSON.parse(data) };
      } catch {
        return { parsed: data };
      }
    }
    return { parsed: data };
  }

  private coerceContent(content: unknown): unknown {
    if (typeof content === 'string') {
      try {
        return JSON.parse(content);
      } catch {
        return content;
      }
    }
    return content;
  }

  private createSortedReplacer(): (key: string, value: unknown) => unknown {
    return (_key: string, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((sorted, k) => {
            sorted[k] = (value as Record<string, unknown>)[k];
            return sorted;
          }, {});
      }
      return value;
    };
  }
}
