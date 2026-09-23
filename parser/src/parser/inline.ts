/**
 * MAM Inline Markdown Parsing
 *
 * Helpers for recognizing inline Markdown constructs — bold, italic,
 * strikethrough, inline code, links, and images — inside a plain text string.
 * These functions operate directly on strings, which makes them useful both
 * for the token-level parser and for tools that need to inspect or rewrite
 * inline content without building a token stream.
 */

import type { InlineNode } from './sections.js';

/**
 * A single recognized inline construct with its source position.
 *
 * Produced by {@link splitInline}. The `start` and `end` indices are offsets
 * into the original content string, and `raw` is the exact source slice that
 * produced the token (for example `**bold**` or `[text](url)`).
 */
export interface InlineToken {
  /** The kind of inline construct. */
  type: InlineNode['type'];
  /** The content text (link text, alt text, or plain text as appropriate). */
  value: string;
  /** For links and images, the destination URL. */
  url?: string;
  /** For links and images, an optional title attribute. */
  title?: string;
  /** The exact source slice that produced this token. */
  raw: string;
  /** The zero-based start offset in the original content. */
  start: number;
  /** The zero-based end offset (exclusive) in the original content. */
  end: number;
}

/**
 * A link extracted from inline content.
 */
export interface InlineLink {
  /** The visible link text. */
  text: string;
  /** The destination URL. */
  url: string;
  /** An optional title attribute. */
  title?: string;
}

/**
 * An image extracted from inline content.
 */
export interface InlineImage {
  /** The alternate text. */
  alt: string;
  /** The image source URL. */
  url: string;
  /** An optional title attribute. */
  title?: string;
}

/**
 * Split inline Markdown content into a stream of {@link InlineToken} values.
 *
 * Recognized constructs are, in precedence order: images (`![alt](url)`),
 * links (`[text](url)`), bold (`**text**`), strikethrough (`~~text~~`),
 * inline code (`` `text` ``), and italic (`*text*`). Anything else is emitted
 * as a plain `'text'` token. When a construct is opened but never closed, the
 * opener is treated as plain text.
 *
 * @param content - The inline Markdown string to split.
 * @returns An array of {@link InlineToken} values in source order.
 */
export function splitInline(content: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let pos = 0;

  while (pos < content.length) {
    // Image ![alt](url)
    if (content.startsWith('![', pos)) {
      const closeBracket = content.indexOf('](', pos + 2);
      if (closeBracket !== -1) {
        const closeParen = content.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const alt = content.slice(pos + 2, closeBracket);
          const url = content.slice(closeBracket + 2, closeParen);
          tokens.push({
            type: 'image',
            value: alt,
            url,
            raw: content.slice(pos, closeParen + 1),
            start: pos,
            end: closeParen + 1,
          });
          pos = closeParen + 1;
          continue;
        }
      }
    }

    // Link [text](url)
    if (content[pos] === '[') {
      const closeBracket = content.indexOf('](', pos + 1);
      if (closeBracket !== -1) {
        const closeParen = content.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const text = content.slice(pos + 1, closeBracket);
          const url = content.slice(closeBracket + 2, closeParen);
          tokens.push({
            type: 'link',
            value: text,
            url,
            raw: content.slice(pos, closeParen + 1),
            start: pos,
            end: closeParen + 1,
          });
          pos = closeParen + 1;
          continue;
        }
      }
    }

    // Bold **
    if (content.startsWith('**', pos)) {
      const end = content.indexOf('**', pos + 2);
      if (end !== -1) {
        tokens.push({
          type: 'bold',
          value: content.slice(pos + 2, end),
          raw: content.slice(pos, end + 2),
          start: pos,
          end: end + 2,
        });
        pos = end + 2;
        continue;
      }
    }

    // Strikethrough ~~
    if (content.startsWith('~~', pos)) {
      const end = content.indexOf('~~', pos + 2);
      if (end !== -1) {
        tokens.push({
          type: 'strikethrough',
          value: content.slice(pos + 2, end),
          raw: content.slice(pos, end + 2),
          start: pos,
          end: end + 2,
        });
        pos = end + 2;
        continue;
      }
    }

    // Inline code `
    if (content[pos] === '`') {
      const end = content.indexOf('`', pos + 1);
      if (end !== -1) {
        tokens.push({
          type: 'code',
          value: content.slice(pos + 1, end),
          raw: content.slice(pos, end + 1),
          start: pos,
          end: end + 1,
        });
        pos = end + 1;
        continue;
      }
    }

    // Italic * (single asterisk)
    if (content[pos] === '*' && content[pos + 1] !== '*') {
      const end = content.indexOf('*', pos + 1);
      if (end !== -1 && content[end - 1] !== '*') {
        tokens.push({
          type: 'italic',
          value: content.slice(pos + 1, end),
          raw: content.slice(pos, end + 1),
          start: pos,
          end: end + 1,
        });
        pos = end + 1;
        continue;
      }
    }

    // Plain text run
    let textEnd = pos + 1;
    while (textEnd < content.length && !isInlineMarkerChar(content[textEnd]!)) {
      textEnd++;
    }
    tokens.push({
      type: 'text',
      value: content.slice(pos, textEnd),
      raw: content.slice(pos, textEnd),
      start: pos,
      end: textEnd,
    });
    pos = textEnd;
  }

  return tokens;
}

/**
 * Parse inline Markdown content into an array of {@link InlineNode} values.
 *
 * This is a thin convenience wrapper around {@link splitInline} that discards
 * the source positions, producing the same node shape used by the sections
 * parser.
 *
 * @param content - The inline Markdown string to parse.
 * @returns The parsed inline nodes.
 */
export function parseInline(content: string): InlineNode[] {
  return splitInline(content).map((token): InlineNode => {
    const node: InlineNode = { type: token.type, value: token.value };
    if (token.url !== undefined) {
      node.url = token.url;
    }
    if (token.title !== undefined) {
      node.title = token.title;
    }
    return node;
  });
}

/**
 * Remove all inline Markdown markers from a string, keeping only the text.
 *
 * Constructs are replaced by their content: `**bold**` becomes `bold`, links
 * become their link text, and images become their alt text.
 *
 * @param content - The inline Markdown string to strip.
 * @returns The plain text content with all markers removed.
 */
export function stripInlineMarkers(content: string): string {
  return splitInline(content)
    .map((token) => token.value)
    .join('');
}

/**
 * Extract every bold segment from a string.
 *
 * A bold segment is delimited by `**` on both sides and contains at least one
 * character that is not an asterisk.
 *
 * @param text - The text to scan.
 * @returns The contents of every bold segment, without the markers.
 */
export function extractBold(text: string): string[] {
  return matchAll(text, /\*\*([^*]+)\*\*/g, 1);
}

/**
 * Extract every italic segment from a string.
 *
 * An italic segment is delimited by single `*` markers and is not part of a
 * bold `**` construct.
 *
 * @param text - The text to scan.
 * @returns The contents of every italic segment, without the markers.
 */
export function extractItalic(text: string): string[] {
  return matchAll(text, /(?<!\*)\*([^*]+)\*(?!\*)/g, 1);
}

/**
 * Extract every inline code span from a string.
 *
 * An inline code span is delimited by backticks on both sides.
 *
 * @param text - The text to scan.
 * @returns The contents of every code span, without the backticks.
 */
export function extractInlineCode(text: string): string[] {
  return matchAll(text, /`([^`]+)`/g, 1);
}

/**
 * Extract every link from a string.
 *
 * A link has the form `[text](url)` and may carry an optional title such as
 * `[text](url "Title")`.
 *
 * @param text - The text to scan.
 * @returns The extracted links.
 */
export function extractLink(text: string): InlineLink[] {
  const links: InlineLink[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const link: InlineLink = { text: match[1]!, url: match[2]! };
    if (match[3] !== undefined) {
      link.title = match[3];
    }
    links.push(link);
  }
  return links;
}

/**
 * Extract every image from a string.
 *
 * An image has the form `![alt](url)` and may carry an optional title such as
 * `![alt](url "Title")`.
 *
 * @param text - The text to scan.
 * @returns The extracted images.
 */
export function extractImage(text: string): InlineImage[] {
  const images: InlineImage[] = [];
  const re = /!\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const image: InlineImage = { alt: match[1]!, url: match[2]! };
    if (match[3] !== undefined) {
      image.title = match[3];
    }
    images.push(image);
  }
  return images;
}

/**
 * Collect every capture group from a global regular expression.
 *
 * @param text - The text to scan.
 * @param re - A global regular expression with at least one capture group.
 * @param group - The capture group index to collect. Defaults to `1`.
 * @returns The captured strings for every match.
 */
function matchAll(text: string, re: RegExp, group: number): string[] {
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    results.push(match[group]!);
  }
  return results;
}

/**
 * Check whether a character can begin an inline construct.
 *
 * @param char - The character to test.
 * @returns `true` for `*`, `` ` ``, `[`, `!`, and `~`.
 */
function isInlineMarkerChar(char: string): boolean {
  return char === '*' || char === '`' || char === '[' || char === '!' || char === '~';
}