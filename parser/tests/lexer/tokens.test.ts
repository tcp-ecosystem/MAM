/**
 * Token Tests
 */

import { describe, it, expect } from 'vitest';
import {
  TokenType,
  VALID_LANGUAGES,
  STANDARD_SECTIONS,
  createToken,
  isLanguageValid,
  isSectionNameValid,
} from '../../src/lexer/tokens.js';

describe('Token Definitions', () => {
  // ==========================================================================
  // Token Types
  // ==========================================================================

  describe('TokenType enum', () => {
    it('should have all special tokens', () => {
      expect(TokenType.EOF).toBe('EOF');
      expect(TokenType.ERROR).toBe('ERROR');
    });

    it('should have all front matter tokens', () => {
      expect(TokenType.FRONTMATTER_SEPARATOR).toBe('FRONTMATTER_SEPARATOR');
    });

    it('should have all heading tokens', () => {
      expect(TokenType.HEADING_1).toBe('HEADING_1');
      expect(TokenType.HEADING_2).toBe('HEADING_2');
      expect(TokenType.HEADING_3).toBe('HEADING_3');
      expect(TokenType.HEADING_4).toBe('HEADING_4');
      expect(TokenType.HEADING_5).toBe('HEADING_5');
      expect(TokenType.HEADING_6).toBe('HEADING_6');
      expect(TokenType.HEADING_TEXT).toBe('HEADING_TEXT');
    });

    it('should have all code tokens', () => {
      expect(TokenType.CODE_FENCE_BACKTICK).toBe('CODE_FENCE_BACKTICK');
      expect(TokenType.CODE_FENCE_TILDE).toBe('CODE_FENCE_TILDE');
      expect(TokenType.CODE_LANGUAGE).toBe('CODE_LANGUAGE');
      expect(TokenType.CODE_CONTENT).toBe('CODE_CONTENT');
      expect(TokenType.CODE_METADATA).toBe('CODE_METADATA');
    });

    it('should have all list tokens', () => {
      expect(TokenType.BULLET_LIST).toBe('BULLET_LIST');
      expect(TokenType.NUMBERED_LIST).toBe('NUMBERED_LIST');
      expect(TokenType.LIST_ITEM_TEXT).toBe('LIST_ITEM_TEXT');
      expect(TokenType.TASK_CHECKED).toBe('TASK_CHECKED');
      expect(TokenType.TASK_UNCHECKED).toBe('TASK_UNCHECKED');
    });

    it('should have all table tokens', () => {
      expect(TokenType.TABLE_PIPE).toBe('TABLE_PIPE');
      expect(TokenType.TABLE_HYPHEN).toBe('TABLE_HYPHEN');
      expect(TokenType.TABLE_COLON).toBe('TABLE_COLON');
      expect(TokenType.TABLE_HEADER_CELL).toBe('TABLE_HEADER_CELL');
      expect(TokenType.TABLE_ROW_CELL).toBe('TABLE_ROW_CELL');
      expect(TokenType.TABLE_NEWLINE).toBe('TABLE_NEWLINE');
    });

    it('should have all inline formatting tokens', () => {
      expect(TokenType.BOLD_OPEN).toBe('BOLD_OPEN');
      expect(TokenType.BOLD_CLOSE).toBe('BOLD_CLOSE');
      expect(TokenType.ITALIC_OPEN).toBe('ITALIC_OPEN');
      expect(TokenType.ITALIC_CLOSE).toBe('ITALIC_CLOSE');
      expect(TokenType.STRIKETHROUGH_OPEN).toBe('STRIKETHROUGH_OPEN');
      expect(TokenType.STRIKETHROUGH_CLOSE).toBe('STRIKETHROUGH_CLOSE');
      expect(TokenType.CODE_INLINE).toBe('CODE_INLINE');
      expect(TokenType.LINK_OPEN).toBe('LINK_OPEN');
      expect(TokenType.LINK_TEXT).toBe('LINK_TEXT');
      expect(TokenType.LINK_SEPARATOR).toBe('LINK_SEPARATOR');
      expect(TokenType.LINK_URL).toBe('LINK_URL');
      expect(TokenType.LINK_TITLE).toBe('LINK_TITLE');
      expect(TokenType.LINK_CLOSE).toBe('LINK_CLOSE');
      expect(TokenType.IMAGE_OPEN).toBe('IMAGE_OPEN');
      expect(TokenType.IMAGE_ALT).toBe('IMAGE_ALT');
      expect(TokenType.IMAGE_SEPARATOR).toBe('IMAGE_SEPARATOR');
    });

    it('should have all block element tokens', () => {
      expect(TokenType.BLOCKQUOTE).toBe('BLOCKQUOTE');
      expect(TokenType.HORIZONTAL_RULE).toBe('HORIZONTAL_RULE');
      expect(TokenType.PARAGRAPH_BREAK).toBe('PARAGRAPH_BREAK');
    });

    it('should have all YAML tokens', () => {
      expect(TokenType.YAML_KEY).toBe('YAML_KEY');
      expect(TokenType.YAML_VALUE).toBe('YAML_VALUE');
      expect(TokenType.YAML_SEPARATOR).toBe('YAML_SEPARATOR');
      expect(TokenType.YAML_LIST_ITEM).toBe('YAML_LIST_ITEM');
    });

    it('should have all whitespace/structure tokens', () => {
      expect(TokenType.NEWLINE).toBe('NEWLINE');
      expect(TokenType.INDENT).toBe('INDENT');
      expect(TokenType.DEDENT).toBe('DEDENT');
      expect(TokenType.WHITESPACE).toBe('WHITESPACE');
      expect(TokenType.TEXT).toBe('TEXT');
    });
  });

  // ==========================================================================
  // Token Creation
  // ==========================================================================

  describe('createToken', () => {
    it('should create token with correct properties', () => {
      const token = createToken(TokenType.TEXT, 'hello', 1, 0, 0);
      expect(token.type).toBe(TokenType.TEXT);
      expect(token.value).toBe('hello');
      expect(token.line).toBe(1);
      expect(token.column).toBe(0);
      expect(token.offset).toBe(0);
      expect(token.length).toBe(5);
    });

    it('should calculate length from value', () => {
      const token = createToken(TokenType.TEXT, 'hello world', 1, 0, 0);
      expect(token.length).toBe(11);
    });

    it('should handle empty value', () => {
      const token = createToken(TokenType.TEXT, '', 1, 0, 0);
      expect(token.length).toBe(0);
    });

    it('should accept metadata parameter', () => {
      const token = createToken(TokenType.TEXT, 'test', 1, 0, 0, { language: 'python' });
      expect(token.metadata?.language).toBe('python');
    });

    it('should create tokens for all token types', () => {
      const types = Object.values(TokenType);
      for (const type of types) {
        const token = createToken(type as TokenType, 'test', 1, 0, 0);
        expect(token.type).toBe(type);
      }
    });

    it('should preserve line and column numbers', () => {
      const token = createToken(TokenType.TEXT, 'x', 42, 15, 500);
      expect(token.line).toBe(42);
      expect(token.column).toBe(15);
      expect(token.offset).toBe(500);
    });
  });

  // ==========================================================================
  // Language Validation
  // ==========================================================================

  describe('isLanguageValid', () => {
    it('should validate python', () => {
      expect(isLanguageValid('python')).toBe(true);
    });

    it('should validate javascript', () => {
      expect(isLanguageValid('javascript')).toBe(true);
    });

    it('should validate typescript', () => {
      expect(isLanguageValid('typescript')).toBe(true);
    });

    it('should validate rust', () => {
      expect(isLanguageValid('rust')).toBe(true);
    });

    it('should validate go', () => {
      expect(isLanguageValid('go')).toBe(true);
    });

    it('should validate shell variants', () => {
      expect(isLanguageValid('shell')).toBe(true);
      expect(isLanguageValid('bash')).toBe(true);
      expect(isLanguageValid('sh')).toBe(true);
      expect(isLanguageValid('zsh')).toBe(true);
    });

    it('should validate data formats', () => {
      expect(isLanguageValid('yaml')).toBe(true);
      expect(isLanguageValid('json')).toBe(true);
      expect(isLanguageValid('xml')).toBe(true);
    });

    it('should validate mermaid', () => {
      expect(isLanguageValid('mermaid')).toBe(true);
    });

    it('should reject invalid languages', () => {
      expect(isLanguageValid('invalid')).toBe(false);
      expect(isLanguageValid('')).toBe(false);
      expect(isLanguageValid('xyz123')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isLanguageValid('Python')).toBe(true);
      expect(isLanguageValid('PYTHON')).toBe(true);
      expect(isLanguageValid('JavaScript')).toBe(true);
    });

    it('should validate all VALID_LANGUAGES entries', () => {
      for (const lang of VALID_LANGUAGES) {
        expect(isLanguageValid(lang)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // Section Name Validation
  // ==========================================================================

  describe('isSectionNameValid', () => {
    it('should validate Purpose', () => {
      expect(isSectionNameValid('Purpose')).toBe(true);
    });

    it('should validate all standard sections', () => {
      expect(isSectionNameValid('Inputs')).toBe(true);
      expect(isSectionNameValid('Outputs')).toBe(true);
      expect(isSectionNameValid('Rules')).toBe(true);
      expect(isSectionNameValid('Workflow')).toBe(true);
      expect(isSectionNameValid('Mermaid')).toBe(true);
      expect(isSectionNameValid('Python')).toBe(true);
      expect(isSectionNameValid('JavaScript')).toBe(true);
      expect(isSectionNameValid('TypeScript')).toBe(true);
      expect(isSectionNameValid('Prompt')).toBe(true);
      expect(isSectionNameValid('Memory')).toBe(true);
      expect(isSectionNameValid('Examples')).toBe(true);
      expect(isSectionNameValid('Tests')).toBe(true);
      expect(isSectionNameValid('References')).toBe(true);
      expect(isSectionNameValid('Dependencies')).toBe(true);
      expect(isSectionNameValid('Exports')).toBe(true);
      expect(isSectionNameValid('Imports')).toBe(true);
      expect(isSectionNameValid('Plugins')).toBe(true);
      expect(isSectionNameValid('Permissions')).toBe(true);
      expect(isSectionNameValid('Capabilities')).toBe(true);
    });

    it('should reject invalid section names', () => {
      expect(isSectionNameValid('Invalid')).toBe(false);
      expect(isSectionNameValid('CustomSection')).toBe(false);
      expect(isSectionNameValid('')).toBe(false);
      expect(isSectionNameValid('purpose')).toBe(false); // case-sensitive
    });

    it('should have exactly 20 standard sections', () => {
      expect(STANDARD_SECTIONS.size).toBe(20);
    });
  });

  // ==========================================================================
  // VALID_LANGUAGES Set
  // ==========================================================================

  describe('VALID_LANGUAGES', () => {
    it('should contain at least 20 languages', () => {
      expect(VALID_LANGUAGES.size).toBeGreaterThanOrEqual(20);
    });

    it('should contain common languages', () => {
      expect(VALID_LANGUAGES.has('python')).toBe(true);
      expect(VALID_LANGUAGES.has('javascript')).toBe(true);
      expect(VALID_LANGUAGES.has('typescript')).toBe(true);
      expect(VALID_LANGUAGES.has('rust')).toBe(true);
      expect(VALID_LANGUAGES.has('go')).toBe(true);
    });

    it('should contain language aliases', () => {
      expect(VALID_LANGUAGES.has('py')).toBe(true);
      expect(VALID_LANGUAGES.has('js')).toBe(true);
      expect(VALID_LANGUAGES.has('ts')).toBe(true);
      expect(VALID_LANGUAGES.has('rs')).toBe(true);
    });
  });
});
