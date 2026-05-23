/**
 * Credentials list — mirrors Swift IdentityDashboardView.
 * Shows all stored VCs with trust badge + issuer.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useCredentialStore, type TrustLevel } from '@/credentials/store';
import { ThemedSurface, ThemedText } from '@/components/themed';

const TRUST_BADGE: Readonly<Record<TrustLevel, string>> = {
  L1: '⚪',
  L2: '🔵',
  L3: '🟢',
};

export default function CredentialsHub() {
  const items = useCredentialStore((s) => s.items);
  const hydrate = useCredentialStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Credentials</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Verifiable credentials issued to you.
        </ThemedText>
      </View>

      {items.length === 0 ? (
        <ThemedSurface variant="outlined" padded className="mx-4">
          <ThemedText variant="titleMedium">No credentials</ThemedText>
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
            Complete the passport flow or accept an issuer's offer to receive a VC.
          </ThemedText>
        </ThemedSurface>
      ) : (
        items.map((c) => (
          <Pressable
            key={c.id}
            onPress={() =>
              router.push({ pathname: '/credentials/[id]', params: { id: c.id } })
            }
            accessibilityRole="button"
            accessibilityLabel={`View credential ${c.title}`}
          >
            <ThemedSurface variant="card" padded className="mx-4 mt-2 flex-row">
              <ThemedText variant="headlineLarge" className="mr-3">
                {TRUST_BADGE[c.trustLevel]}
              </ThemedText>
              <View className="flex-1">
                <ThemedText variant="titleMedium">{c.title}</ThemedText>
                <ThemedText variant="caption" tone="tertiary">
                  {c.issuerDid.slice(0, 40)}…
                </ThemedText>
                <ThemedText variant="caption" tone="tertiary">
                  Issued {c.issuedAt.toLocaleDateString()}
                  {c.expiresAt ? ` · expires ${c.expiresAt.toLocaleDateString()}` : ''}
                </ThemedText>
              </View>
            </ThemedSurface>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
