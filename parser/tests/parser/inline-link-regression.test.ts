import { describe, it, expect } from 'vitest';
import { parseMAM } from '../../src/index.js';

/**
 * Regression coverage for the infinite-loop bug in `parseInlineContent`
 * (`parser/src/parser/sections.ts`).
 *
 * The link branch searched for `](` with `text.indexOf('](')` — i.e. from index
 * 0 rather than from the cursor. For any `[` that was *not* a real link but
 * appeared after an earlier link, the match resolved *behind* the cursor, so
 * `pos = closeParen + 1` moved the cursor backwards and the `while` loop never
 * terminated. Any module containing such a line made the whole toolchain
 * (`mam validate|build|smoke|run`) hang forever.
 *
 * Every case below must terminate quickly; a 5s per-test timeout turns a
 * regression into a visible failure instead of a hung suite.
 */
describe('inline link parsing does not loop', () => {
  const wrap = (body: string): string =>
    ['---', 'id: t', 'name: T', 'version: "1.0.0"', '---', '', '## Purpose', '', body, ''].join('\n');

  it('parses a trailing unclosed bracket after a real link', () => {
    const result = parseMAM(wrap('See [x](y) and [z'));
    expect(result.errors).toBeDefined();
    expect(result.ast?.sections?.length).toBeGreaterThan(0);
  });

  it('parses two inline-code links on one line', () => {
    const result = parseMAM(wrap('Use [`a.mam`](../a.mam) for x and [`b.mam`](./b.mam) for y.'));
    expect(result.ast?.sections?.length).toBeGreaterThan(0);
  });

  it('parses several brackets with only one link', () => {
    const result = parseMAM(wrap('See [one](target) plus [two plus [three'));
    expect(result.ast?.sections?.length).toBeGreaterThan(0);
  });

  it('parses a bracket before any link exists', () => {
    const result = parseMAM(wrap('An array [0] and a note [1] with no links at all'));
    expect(result.ast?.sections?.length).toBeGreaterThan(0);
  });

  it('parses nested-looking brackets inside a paragraph', () => {
    const result = parseMAM(wrap('Text [a] more [b] end [c] and [link](d) then [e]'));
    expect(result.ast?.sections?.length).toBeGreaterThan(0);
  });

  it('still recognises a genuine link', () => {
    const result = parseMAM(wrap('Read [the docs](https://example.com) now'));
    const sections = result.ast?.sections ?? [];
    expect(sections.length).toBeGreaterThan(0);
    const nodes = sections.flatMap((s) => s.content ?? []) as Array<{
      type: string;
      inlineNodes?: Array<{ type: string; url?: string }>;
    }>;
    const links = nodes.flatMap((n) => n.inlineNodes ?? []).filter((n) => n.type === 'link');
    expect(links.length).toBe(1);
    expect(links[0]!.url).toBe('https://example.com');
  });
});