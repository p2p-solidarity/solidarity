/**
 * Markdown parser — pure TS, no RN imports so it can be unit-tested
 * under bun without the RN runtime. Used by `MarkdownDocumentView.tsx`
 * (which adds the rendering layer).
 *
 * Mirrors Swift `MarkdownDocumentView.parse(_:)` from
 * `solidarity/Views/Common/MarkdownDocumentView.swift`. Supports four
 * block kinds only:
 *   • heading 1–4 (`#`-prefix; deeper levels clamp to 4)
 *   • paragraph  (consecutive non-blank lines, joined by space)
 *   • bullet     (`- ` or `* ` prefix)
 *   • spacer     (blank line; flushes the active paragraph)
 *
 * Inline `**` and `__` markers are stripped (parity with Swift).
 */
export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'bullet'; readonly text: string }
  | { readonly type: 'spacer' };

export function parseMarkdown(raw: string): readonly MarkdownBlock[] {
  const out: MarkdownBlock[] = [];
  let paragraphLines: string[] = [];

  const flush = () => {
    if (paragraphLines.length === 0) return;
    out.push({ type: 'paragraph', text: stripInline(paragraphLines.join(' ')) });
    paragraphLines = [];
  };

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      flush();
      out.push({ type: 'spacer' });
      continue;
    }
    if (line.startsWith('#')) {
      flush();
      let level = 0;
      while (level < line.length && line[level] === '#') level += 1;
      const text = line.slice(level).trim();
      const clamped = Math.min(level, 4) as 1 | 2 | 3 | 4;
      out.push({ type: 'heading', level: clamped, text: stripInline(text) });
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flush();
      out.push({ type: 'bullet', text: stripInline(line.slice(2).trim()) });
      continue;
    }
    paragraphLines.push(line);
  }
  flush();
  return out;
}

function stripInline(text: string): string {
  return text.replace(/\*\*/g, '').replace(/__/g, '');
}
