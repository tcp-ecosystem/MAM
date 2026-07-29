/**
 * MAM Runtime Output Formats
 *
 * Provides formatters for JSON, HTML, Markdown, and plain-text output.
 */

import { JSONOutput } from './json.js';
import { HTMLOutput } from './html.js';
import { MarkdownOutput } from './markdown.js';

export type { JSONOutputOptions } from './json.js';
export type { HTMLOutputOptions } from './html.js';
export type { MarkdownOutputOptions } from './markdown.js';

export { JSONOutput, HTMLOutput, MarkdownOutput };

// ---------------------------------------------------------------------------
// Shared formatter interface
// ---------------------------------------------------------------------------

export interface OutputFormatter {
  /** Serialize arbitrary data to a string. */
  format(data: unknown): string;
  /** MIME type of the output. */
  getMimeType(): string;
  /** Default file extension (with dot). */
  getExtension(): string;
  /** Render an array of named sections. */
  formatSections(sections: unknown[]): string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

type OutputType = 'json' | 'html' | 'markdown' | 'text';

class TextOutput implements OutputFormatter {
  format(data: unknown): string {
    if (typeof data === 'string') return data;
    if (data === null || data === undefined) return '';
    return JSON.stringify(data, null, 2);
  }

  formatSections(sections: unknown[]): string {
    return sections
      .map((s) => {
        const sec = s as Record<string, unknown>;
        const name = String(sec.name ?? '');
        const content = sec.content;
        const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        return `${name}\n${'='.repeat(name.length)}\n\n${body}`;
      })
      .join('\n\n');
  }

  getMimeType(): string {
    return 'text/plain';
  }

  getExtension(): string {
    return '.txt';
  }
}

/**
 * Create an `OutputFormatter` for the given type.
 */
export function createFormatter(type: OutputType): OutputFormatter {
  let instance: OutputFormatter;
  switch (type) {
    case 'json':
      instance = new JSONOutput();
      break;
    case 'html':
      instance = new HTMLOutput();
      break;
    case 'markdown':
      instance = new MarkdownOutput();
      break;
    case 'text':
      instance = new TextOutput();
      break;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown output type: ${_exhaustive}`);
    }
  }
  return instance;
}
