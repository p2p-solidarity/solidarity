/**
 * ContactRow — list item for People tab. Mirrors Swift TrustGraphContactRow.
 *
 * Visual contract:
 *   [animal avatar] [name + title]              [verification badge]
 *                   [last interaction · source]
 *
 * Accessible: full row Pressable; long-press for "More" sheet via the
 * onLongPress prop. Animation lives in the tap feedback (Reanimated 4
 * pressed-scale via `animatedStyle` — added in next pass, kept simple
 * here so the row stays under 200 LOC).
 */
import type { ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed';
import type { Contact } from '@solidarity/shared';

const ANIMAL_ICON: Readonly<Record<string, string>> = {
  dog: '🐕',
  horse: '🐎',
  pig: '🐖',
  sheep: '🐑',
  dove: '🕊️',
};

const VERIFICATION_BADGE: Readonly<Record<Contact['verificationStatus'], string>> = {
  Verified: '🟢',
  Unverified: '⚪',
  Failed: '🔴',
  Pending: '🟡',
};

export interface ContactRowProps {
  readonly contact: Contact;
  readonly onPress: (contact: Contact) => void;
  readonly onLongPress?: (contact: Contact) => void;
}

function relativeTime(d: Date | undefined): string {
  if (!d) return 'never';
  const deltaSec = (Date.now() - d.getTime()) / 1000;
  if (deltaSec < 60) return 'just now';
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86400)}d ago`;
}

export function ContactRow({
  contact,
  onPress,
  onLongPress,
}: ContactRowProps): ReactNode {
  const { businessCard: card } = contact;
  const animal = card.animal ? ANIMAL_ICON[card.animal] : '👤';

  return (
    <Pressable
      className="bg-cardBg flex-row items-center rounded-2xl border border-divider p-4 mx-4 my-1"
      onPress={() => onPress(contact)}
      onLongPress={onLongPress ? () => onLongPress(contact) : undefined}
      accessibilityRole="button"
      accessibilityLabel={`Contact ${card.name}`}
    >
      <View className="bg-searchBg h-12 w-12 items-center justify-center rounded-full mr-3">
        {card.profileImage ? (
          <Image
            source={{ uri: `data:image/png;base64,${card.profileImage}` }}
            className="h-12 w-12 rounded-full"
          />
        ) : (
          <ThemedText variant="titleLarge">{animal}</ThemedText>
        )}
      </View>
      <View className="flex-1">
        <ThemedText variant="titleMedium" numberOfLines={1}>
          {card.name}
        </ThemedText>
        {card.title ? (
          <ThemedText variant="bodySmall" tone="secondary" numberOfLines={1}>
            {card.title}
            {card.company ? ` · ${card.company}` : ''}
          </ThemedText>
        ) : null}
        <ThemedText variant="caption" tone="tertiary">
          {relativeTime(contact.lastInteraction ?? contact.receivedAt)} · {contact.source}
        </ThemedText>
      </View>
      <ThemedText variant="titleLarge">
        {VERIFICATION_BADGE[contact.verificationStatus]}
      </ThemedText>
    </Pressable>
  );
}
