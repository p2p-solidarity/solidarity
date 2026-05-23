/**
 * Person detail — mirrors Swift PersonDetailView. Renders the full
 * business-card + signed exchange metadata + verification badge.
 *
 * Per aniseekr-expo rule 10: list passes `name` via route params so frame 1
 * paints the hero before MMKV fetch resolves. The rest fills in once the
 * store hydrates (cache hit = instant).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { MauvePetalMotif } from '@/components/decor/MauvePetalMotif';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useContact } from '@/contacts/repository';

export default function PersonDetail() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const contact = useContact(id);
  const displayName = contact?.businessCard.name ?? name ?? 'Contact';

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6 pb-3">
        <ThemedButton
          variant="secondary"
          label="‹ Back"
          size="sm"
          onPress={() => { router.back(); }}
        />
      </View>
      <View className="px-4 pb-2" style={{ position: 'relative' }}>
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: -16, left: -16, right: -16, bottom: 0 }}
        >
          <MauvePetalMotif cardWidth={361} cardHeight={120} />
        </View>
        <ThemedText variant="headlineLarge">{displayName}</ThemedText>
        {contact?.businessCard.title ? (
          <ThemedText variant="bodyMedium" tone="secondary">
            {contact.businessCard.title}
            {contact.businessCard.company ? ` · ${contact.businessCard.company}` : ''}
          </ThemedText>
        ) : null}
      </View>

      {contact?.businessCard.email ? (
        <ThemedSurface variant="card" padded className="mx-4 mt-3">
          <ThemedText variant="caption" tone="tertiary">EMAIL</ThemedText>
          <ThemedText variant="bodyLarge">{contact.businessCard.email}</ThemedText>
        </ThemedSurface>
      ) : null}

      {contact?.businessCard.phone ? (
        <ThemedSurface variant="card" padded className="mx-4 mt-3">
          <ThemedText variant="caption" tone="tertiary">PHONE</ThemedText>
          <ThemedText variant="bodyLarge">{contact.businessCard.phone}</ThemedText>
        </ThemedSurface>
      ) : null}

      <ThemedSurface variant="card" padded className="mx-4 mt-3 mb-6">
        <ThemedText variant="caption" tone="tertiary">VERIFICATION</ThemedText>
        <ThemedText variant="bodyLarge">
          {contact?.verificationStatus ?? 'Pending'}
        </ThemedText>
        {contact?.exchangeTimestamp ? (
          <ThemedText variant="caption" tone="tertiary" className="mt-1">
            Exchanged on {contact.exchangeTimestamp.toLocaleString()}
          </ThemedText>
        ) : null}
      </ThemedSurface>
    </ScrollView>
  );
}
