/**
 * Credential offer — mirrors Swift CredentialImportFlowSheet.
 * Receives an OID4VCI credential_offer URL → parse → show issuer → user
 * accepts → token + credential request happens (TODO: wire to OIDC
 * token service).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';

interface ParsedOffer {
  readonly issuer: string;
  readonly preAuthCode?: string;
  readonly credentialConfigurationIds: readonly string[];
}

function parseOffer(query: string): ParsedOffer | null {
  try {
    const params = new URLSearchParams(query);
    const raw = params.get('credential_offer');
    if (!raw) return null;
    const obj = JSON.parse(raw) as {
      readonly credential_issuer?: string;
      readonly credential_configuration_ids?: readonly string[];
      readonly grants?: Readonly<Record<string, { ['pre-authorized_code']?: string }>>;
    };
    return {
      issuer: obj.credential_issuer ?? 'unknown',
      preAuthCode:
        obj.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code'],
      credentialConfigurationIds: obj.credential_configuration_ids ?? [],
    };
  } catch {
    return null;
  }
}

export default function CredentialOffer() {
  const { q } = useLocalSearchParams<{ q: string }>();
  const offer = useMemo(() => (q ? parseOffer(q) : null), [q]);

  if (!offer) {
    return (
      <View className="flex-1 bg-pageBg items-center justify-center p-6">
        <ThemedText tone="secondary">Invalid credential offer.</ThemedText>
        <View className="mt-3">
          <ThemedButton variant="secondary" label="Back" onPress={() => { router.back(); }} />
        </View>
      </View>
    );
  }

  const onAccept = () => {
    pushToast('Token exchange + credential request wires next iteration', 'info');
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Credential offer</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          {offer.issuer}
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">YOU WILL RECEIVE</ThemedText>
        {offer.credentialConfigurationIds.map((id) => (
          <ThemedText key={id} variant="bodyLarge" className="mt-1">
            {id}
          </ThemedText>
        ))}
      </ThemedSurface>

      <ThemedSurface variant="inset" padded className="mx-4 mt-3">
        <ThemedText variant="caption" tone="tertiary">FLOW</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          {offer.preAuthCode ? 'Pre-authorized code (no extra login)' : 'Authorization code (will redirect)'}
        </ThemedText>
      </ThemedSurface>

      <View className="px-4 mt-6 mb-10">
        <ThemedButton label="Accept credential" fullWidth onPress={onAccept} />
        <View className="mt-2">
          <ThemedButton variant="secondary" label="Cancel" fullWidth onPress={() => { router.back(); }} />
        </View>
      </View>
    </ScrollView>
  );
}
