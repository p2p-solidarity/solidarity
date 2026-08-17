/**
 * IDListRow — generic row primitives for the PersonalIdentityView Lists.
 *
 * Visual: searchBg "List section" container with 1pt divider stroke
 * (matching the Swift `.background(Color.Theme.searchBg).overlay(Rectangle()
 * .stroke(...))` pattern used throughout GroupIdentityView /
 * GroupDetailView+Subviews).
 *
 * Three primitives:
 *   • IDSectionContainer — outer searchBg block with divider stroke + slot
 *   • IDLabeledRow      — left label / right value, both 15pt; supports
 *                         monospaced + selectable.
 *   • IDBlockText       — wrapped multi-line block (e.g. JWK JSON), 12pt
 *                         monospaced, selectable, secondary tone.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

const MONO_FONT = 'Menlo';

export function IDSectionContainer({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ThemedSurface
      variant="inset"
      className="rounded-none p-4"
      style={{ borderWidth: 1, borderColor: Colors.divider, gap: 8 }}>
      {children}
    </ThemedSurface>
  );
}

export interface IDLabeledRowProps {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly selectable?: boolean;
  readonly tone?: 'primary' | 'secondary';
}

export function IDLabeledRow({
  label,
  value,
  mono = false,
  selectable = false,
  tone = 'primary',
}: IDLabeledRowProps): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingVertical: 2,
      }}>
      <ThemedText variant="bodyMedium" tone={tone}>
        {label}
      </ThemedText>
      <ThemedText
        variant="bodySmall"
        tone={tone}
        selectable={selectable}
        numberOfLines={1}
        ellipsizeMode="middle"
        style={mono ? { fontFamily: MONO_FONT } : undefined}
        className="flex-1 text-right">
        {value}
      </ThemedText>
    </View>
  );
}

export interface IDBlockTextProps {
  readonly value: string;
  readonly maxLines?: number;
}

export function IDBlockText({ value, maxLines }: IDBlockTextProps): ReactNode {
  return (
    <ThemedText
      variant="caption"
      tone="secondary"
      selectable
      numberOfLines={maxLines}
      style={{ fontFamily: MONO_FONT }}>
      {value}
    </ThemedText>
  );
}
