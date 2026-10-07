/**
 * MAM Tokenizer Hyphen Tests
 *
 * Regression coverage for hyphen handling:
 *  - standalone hyphens used as prose dashes or minus signs previously produced
 *    a spurious UNEXPECTED_CHARACTER, because the text scanner stopped at the
 *    hyphen and re-lexed it on its own where no token rule matched;
 *  - a line holding only "-" was accepted as a list marker while readListItem
 *    consumed nothing, which hung the tokenizer forever.
 */

import { describe, it, expect } from 'vitest';
import { tokenize, TokenType } from '../../src/lexer/index.js';
import { parseMAM } from '../../src/index.js';

function unexpectedCharacters(input: string) {
  return tokenize(input).errors.filter((e) => e.code === 'UNEXPECTED_CHARACTER');
}

describe('Tokenizer hyphens', () => {
  describe('standalone hyphens in prose', () => {
    it('accepts a spaced dash between words', () => {
      expect(unexpectedCharacters('a - b')).toHaveLength(0);
    });

    it('accepts a dash in a sentence', () => {
      const input = 'This has hyphens - like well-known and state-of-the-art.';

      expect(unexpectedCharacters(input)).toHaveLength(0);
    });

    it('accepts a negative number', () => {
      expect(unexpectedCharacters('value -5 here')).toHaveLength(0);
    });

    it('accepts a negative value on its own line', () => {
      expect(unexpectedCharacters('offset: -1')).toHaveLength(0);
    });

    it('keeps the dash inside the text token', () => {
      const result = tokenize('a - b');
      const text = result.tokens.filter((t) => t.type === TokenType.TEXT);

      expect(text.length).toBeGreaterThan(0);
      expect(text.map((t) => t.value).join('')).toContain('-');
    });
  });

  describe('hyphen-only lines terminate', () => {
    it('tokenizes a line containing only a dash', () => {
      const result = tokenize('a\n-\nb');

      expect(result.tokens.length).toBeGreaterThan(0);
    }, 10000);

    it('tokenizes a dash-only line followed by a list item', () => {
      const result = tokenize('a\n-\n- x\n');

      expect(result.tokens.length).toBeGreaterThan(0);
    }, 10000);

    it('does not treat a dash-only line as a list marker', () => {
      const result = tokenize('a\n-\nb');
      const markers = result.tokens.filter(
        (t) => t.type === TokenType.BULLET_LIST || t.type === TokenType.NUMBERED_LIST
      );

      expect(markers).toHaveLength(0);
    }, 10000);
  });

  describe('hyphens that must keep working', () => {
    it('keeps hyphenated words intact', () => {
      expect(unexpectedCharacters('state-of-the-art')).toHaveLength(0);
    });

    it('still recognizes bullet list markers', () => {
      const input = '- item one\n- item two';
      const result = tokenize(input);
      const markers = result.tokens.filter((t) => t.type === TokenType.BULLET_LIST);

      expect(unexpectedCharacters(input)).toHaveLength(0);
      expect(markers).toHaveLength(2);
    });

    it('still recognizes horizontal rules', () => {
      const result = tokenize('text\n\n---\n\nmore');
      const rules = result.tokens.filter((t) => t.type === TokenType.HORIZONTAL_RULE);

      expect(rules).toHaveLength(1);
    });

    it('still recognizes MAM edge syntax', () => {
      expect(unexpectedCharacters('a -> b')).toHaveLength(0);
    });

    it('still accepts em and en dashes', () => {
      expect(unexpectedCharacters('a \u2014 b')).toHaveLength(0);
      expect(unexpectedCharacters('a \u2013 b')).toHaveLength(0);
    });
  });

  describe('end to end', () => {
    it('parses a document containing prose dashes without lexer errors', () => {
      const input = `---
id: hyphen-doc
name: Hyphen Doc
---

## Purpose

This module covers well-known cases - and it has a -5 offset.
`;

      const result = parseMAM(input);
      const lexerErrors = result.errors.filter((e) => e.code === 'UNEXPECTED_CHARACTER');

      expect(lexerErrors).toHaveLength(0);
    }, 15000);
  });
});