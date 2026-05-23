/**
 * Credential detail — mirrors Swift CredentialDetailView.
 * Pretty-prints the decoded VC JWT + lets the user copy the raw token.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useCredentialStore } from '@/credentials/store';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { decodeJwtUnsafe } from '@solidarity/shared';

export default function CredentialDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const items = useCredentialStore((s) => s.items);
  const credential = items.find((c) => c.id === id);

  if (!credential) {
    return (
      <View className="flex-1 bg-pageBg items-center justify-center">
        <ThemedText tone="secondary">Credential not found.</ThemedText>
      </View>
    );
  }

  const decoded = (() => {
    try {
      return decodeJwtUnsafe<Record<string, unknown>>(credential.rawJwt);
    } catch {
      return null;
    }
  })();

  const copyJwt = async () => {
    await Clipboard.setStringAsync(credential.rawJwt);
    pushToast('JWT copied to clipboard', 'success');
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6">
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => router.back()} />
      </View>
      <View className="px-4 mt-4">
        <ThemedText variant="headlineLarge">{credential.title}</ThemedText>
        <ThemedText variant="bodyMedium" tone="secondary">
          {credential.type}
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4 mt-4">
        <ThemedText variant="caption" tone="tertiary">ISSUER</ThemedText>
        <ThemedText variant="bodySmall" selectable>{credential.issuerDid}</ThemedText>
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-2">
        <ThemedText variant="caption" tone="tertiary">HOLDER</ThemedText>
        <ThemedText variant="bodySmall" selectable>{credential.holderDid}</ThemedText>
      </ThemedSurface>

      {decoded ? (
        <ThemedSurface variant="card" padded className="mx-4 mt-2">
          <ThemedText variant="caption" tone="tertiary">PAYLOAD</ThemedText>
          <ThemedText variant="bodySmall" selectable>
            {JSON.stringify(decoded.payload, null, 2)}
          </ThemedText>
        </ThemedSurface>
      ) : null}

      <Pressable className="mx-4 mt-2" onPress={() => void copyJwt()}>
        <ThemedSurface variant="inset" padded>
          <ThemedText variant="caption" tone="tertiary">RAW JWT (tap to copy)</ThemedText>
          <ThemedText variant="bodySmall" numberOfLines={3}>
            {credential.rawJwt}
          </ThemedText>
        </ThemedSurface>
      </Pressable>

      <View className="h-10" />
    </ScrollView>
  );
}
