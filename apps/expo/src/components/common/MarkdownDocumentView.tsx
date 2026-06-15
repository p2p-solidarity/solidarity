/**
 * MarkdownDocumentView — 1:1 port of Swift MarkdownDocumentView.
 *
 * Lightweight markdown renderer for privacy / terms / about pages.
 * Supports four block types only (matching Swift):
 *   • heading 1–4 (lines starting with `#`)
 *   • paragraph (consecutive non-blank lines)
 *   • bullet  (lines starting with `- ` or `* `)
 *   • spacer  (blank lines)
 *
 * Inline formatting markers `**` and `__` are stripped (the Swift
 * version doesn't actually bold them — same minimal behaviour here).
 *
 * Used by privacy/terms screens reached via Settings.
 */
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Colors } from '@/constants/Colors';

import { parseMarkdown, type MarkdownBlock } from './markdownParser';
export { parseMarkdown, type MarkdownBlock } from './markdownParser';

export interface MarkdownDocumentViewProps {
  readonly source: string | (() => Promise<string>);
  readonly title?: string;
}

export function MarkdownDocumentView({ source }: MarkdownDocumentViewProps) {
  const [blocks, setBlocks] = useState<readonly MarkdownBlock[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof source === 'string') {
      setBlocks(parseMarkdown(source));
      setError(null);
      return;
    }
    let cancelled = false;
    source()
      .then((raw) => {
        if (cancelled) return;
        setBlocks(parseMarkdown(raw));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Document not available.');
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <ScrollView
      style={{ backgroundColor: Colors.pageBg }}
      contentContainerStyle={{ paddingVertical: 24 }}
    >
      {error ? (
        <View
          style={{
            marginHorizontal: 16,
            padding: 16,
            backgroundColor: Colors.mutedSurface,
            borderRadius: 12,
          }}
        >
          <Text style={{ fontSize: 13, color: Colors.destructive }}>{error}</Text>
        </View>
      ) : (
        blocks.map((b, i) => <Block key={String(i)} block={b} />)
      )}
    </ScrollView>
  );
}

function Block({ block }: { readonly block: MarkdownBlock }) {
  if (block.type === 'spacer') return <View style={{ height: 4 }} />;
  if (block.type === 'heading') {
    return (
      <Text
        style={{
          fontSize: headingSize(block.level),
          fontWeight: block.level === 1 ? '700' : '600',
          color: Colors.text1,
          paddingHorizontal: 16,
          paddingTop: block.level === 1 ? 8 : 4,
        }}
      >
        {block.text}
      </Text>
    );
  }
  if (block.type === 'bullet') {
    return (
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 24,
          alignItems: 'flex-start',
        }}
      >
        <Text style={{ fontSize: 14, color: Colors.text3 }}>•</Text>
        <Text style={{ flex: 1, fontSize: 14, color: Colors.text2, lineHeight: 22 }}>
          {block.text}
        </Text>
      </View>
    );
  }
  return (
    <Text
      style={{
        fontSize: 14,
        color: Colors.text2,
        lineHeight: 22,
        paddingHorizontal: 16,
      }}
    >
      {block.text}
    </Text>
  );
}

function headingSize(level: 1 | 2 | 3 | 4): number {
  switch (level) {
    case 1:
      return 22;
    case 2:
      return 18;
    case 3:
      return 16;
    case 4:
      return 15;
  }
}

