/**
 * Token Tests
 */

import { describe, it, expect } from 'vitest';
import { TokenType, VALID_LANGUAGES, STANDARD_SECTIONS, createToken, isLanguageValid, isSectionNameValid } from '../../src/lexer/tokens.js';

describe('Token Definitions', () => {
  it('should have all required token types', () => {
    expect(TokenType.EOF).toBe('EOF');
    expect(TokenType.ERROR).toBe('ERROR');
    expect(TokenType.FRONTMATTER_SEPARATOR).toBe('FRONTMATTER_SEPARATOR');
    expect(TokenType.HEADING_1).toBe('HEADING_1');
    expect(TokenType.CODE_FENCE_BACKTICK).toBe('CODE_FENCE_BACKTICK');
    expect(TokenType.TEXT).toBe('TEXT');
  });

  it('should create token with correct properties', () => {
    const token = createToken(TokenType.TEXT, 'hello', 1, 0, 0);
    expect(token.type).toBe(TokenType.TEXT);
    expect(token.value).toBe('hello');
    expect(token.line).toBe(1);
    expect(token.column).toBe(0);
    expect(token.offset).toBe(0);
    expect(token.length).toBe(5);
  });

  it('should validate languages', () => {
    expect(isLanguageValid('python')).toBe(true);
    expect(isLanguageValid('javascript')).toBe(true);
    expect(isLanguageValid('invalid')).toBe(false);
  });

  it('should validate section names', () => {
    expect(isSectionNameValid('Purpose')).toBe(true);
    expect(isSectionNameValid('Invalid')).toBe(false);
  });

  it('should have valid languages set', () => {
    expect(VALID_LANGUAGES.size).toBeGreaterThan(0);
    expect(VALID_LANGUAGES.has('python')).toBe(true);
  });

  it('should have standard sections set', () => {
    expect(STANDARD_SECTIONS.size).toBe(20);
    expect(STANDARD_SECTIONS.has('Purpose')).toBe(true);
    expect(STANDARD_SECTIONS.has('Inputs')).toBe(true);
  });
});