/**
 * BusinessCardRow — list item for the My Cards screen.
 *
 * Compact row variant of `WalletCardView` (Swift
 * solidarity/Views/CardViews/BusinessCardActionsView.swift). Renders from
 * the card manifest (id, name, title, company, animal) so list paint is
 * instant on cold launch. Full `BusinessCard` (incl. profileImage) is
 * decrypted lazily on row tap → /cards/edit.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { CardManifestEntry } from '@/cards/cardManifest';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

const ANIMAL_GLYPH: Readonly<Record<string, string>> = {
  dog: '🐕',
  horse: '🐎',
  pig: '🐖',
  sheep: '🐑',
  dove: '🕊️',
};

export interface BusinessCardRowProps {
  readonly card: CardManifestEntry;
  readonly onPress: (card: CardManifestEntry) => void;
  readonly onLongPress?: (card: CardManifestEntry) => void;
}

export function BusinessCardRow({
  card,
  onPress,
  onLongPress,
}: BusinessCardRowProps): ReactNode {
  return (
    <Pressable
      className="bg-cardBg mx-4 my-1 flex-row items-center rounded-2xl border border-divider p-4 active:opacity-80"
      onPress={() => { onPress(card); }}
      onLongPress={onLongPress ? () => { onLongPress(card); } : undefined}
      accessibilityRole="button"
      accessibilityLabel={`Card ${card.name}`}
    >
      <Avatar card={card} />

      <View className="flex-1 mx-3">
        <ThemedText variant="titleMedium" numberOfLines={1}>
          {card.name}
        </ThemedText>
        {(card.title || card.company) ? (
          <ThemedText variant="bodySmall" tone="secondary" numberOfLines={1}>
            {[card.title, card.company].filter(Boolean).join(' · ')}
          </ThemedText>
        ) : null}
      </View>

      <SfIcon name="chevron.right" size={14} color={Colors.text3} />
    </Pressable>
  );
}

function Avatar({ card }: { readonly card: CardManifestEntry }): ReactNode {
  return (
    <View
      className="bg-warmCream items-center justify-center border border-divider"
      style={{ width: 48, height: 48, borderRadius: 24 }}
    >
      <ThemedText variant="titleLarge">
        {card.animal ? ANIMAL_GLYPH[card.animal] ?? initialOf(card.name) : initialOf(card.name)}
      </ThemedText>
    </View>
  );
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return trimmed.charAt(0).toUpperCase();
}
