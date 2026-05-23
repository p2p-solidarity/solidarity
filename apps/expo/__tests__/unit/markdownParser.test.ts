/**
 * MarkdownDocumentView parser tests.
 *
 * Mirrors Swift MarkdownDocumentView.parse() rules verbatim:
 *   • # / ## / ### / #### → heading 1..4 (level clamped at 4)
 *   • - or * prefix → bullet
 *   • blank line → spacer, flushes the active paragraph
 *   • everything else → paragraph (consecutive lines join with space)
 *   • inline ** and __ stripped (no bold rendering)
 */
import { describe, expect, test } from 'bun:test';

import { parseMarkdown } from '@/components/common/markdownParser';

describe('parseMarkdown', () => {
  test('parses headings 1..4 and clamps deeper levels', () => {
    const blocks = parseMarkdown(
      '# H1\n## H2\n### H3\n#### H4\n##### Deep'
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'H1' },
      { type: 'heading', level: 2, text: 'H2' },
      { type: 'heading', level: 3, text: 'H3' },
      { type: 'heading', level: 4, text: 'H4' },
      { type: 'heading', level: 4, text: 'Deep' },
    ]);
  });

  test('coalesces consecutive non-blank lines into one paragraph joined by space', () => {
    const blocks = parseMarkdown('Hello\nWorld\nFoo');
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Hello World Foo' }]);
  });

  test('blank line flushes paragraph and emits spacer', () => {
    const blocks = parseMarkdown('First para\n\nSecond para');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'First para' },
      { type: 'spacer' },
      { type: 'paragraph', text: 'Second para' },
    ]);
  });

  test('recognises both - and * bullets', () => {
    const blocks = parseMarkdown('- a\n* b');
    expect(blocks).toEqual([
      { type: 'bullet', text: 'a' },
      { type: 'bullet', text: 'b' },
    ]);
  });

  test('strips inline ** and __ from text', () => {
    const blocks = parseMarkdown('# **Bold heading**\n__strong__ word');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Bold heading' },
      { type: 'paragraph', text: 'strong word' },
    ]);
  });

  test('flushes paragraph before heading or bullet', () => {
    const blocks = parseMarkdown('Para line\n# Heading\nAnother');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Para line' },
      { type: 'heading', level: 1, text: 'Heading' },
      { type: 'paragraph', text: 'Another' },
    ]);
  });
});
