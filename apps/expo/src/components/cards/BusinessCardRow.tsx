/**
 * BusinessCardRow — list item for the My Cards screen.
 *
 * Compact row variant of `WalletCardView` (Swift
 * solidarity/Views/CardViews/BusinessCardActionsView.swift). Shows the
 * card's animal/initial avatar, name, title/company line, and a chevron
 * affordance so tap → /cards/edit reads as a navigation row.
 */
import type { ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { BusinessCard } from '@solidarity/shared';

const ANIMAL_GLYPH: Readonly<Record<string, string>> = {
  dog: '🐕',
  horse: '🐎',
  pig: '🐖',
  sheep: '🐑',
  dove: '🕊️',
};

export interface BusinessCardRowProps {
  readonly card: BusinessCard;
  readonly onPress: (card: BusinessCard) => void;
  readonly onLongPress?: (card: BusinessCard) => void;
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

function Avatar({ card }: { readonly card: BusinessCard }): ReactNode {
  if (card.profileImage) {
    return (
      <Image
        source={{ uri: `data:image/jpeg;base64,${card.profileImage}` }}
        style={{ width: 48, height: 48, borderRadius: 24 }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      className="bg-warmCream items-center justify-center"
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
