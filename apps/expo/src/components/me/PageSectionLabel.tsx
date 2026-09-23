/**
 * PageSectionLabel — the mock's `.proof-sec`: a 13pt medium label in secondary
 * ink with a touch of tracking, sitting above each Page tab group
 * (公開頁 / 名片才有 / 區塊 / 證明).
 */
import type { ReactNode } from 'react';

import { ThemedText } from '@/components/themed';

/** `.proof-sec` letter-spacing — `.04em` at 13pt. */
const TRACKING = 0.5;

export function PageSectionLabel({ title }: { readonly title: string }): ReactNode {
  return (
    <ThemedText
      accessibilityRole="header"
      variant="label"
      tone="secondary"
      style={{ letterSpacing: TRACKING }}>
      {title}
    </ThemedText>
  );
}
