/**
 * OIDC consent — mirrors Swift OIDCRequestView.
 * Parses the inbound openid4vp:// query, shows the requesting verifier +
 * scopes + presentation definition, lets the user approve / deny.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { parseOidcRequest } from '@/oidc/parseAuthRequest';
import { riskLevel, type OIDCScope } from '@solidarity/shared';

const RISK_BADGE: Readonly<Record<'low' | 'medium' | 'high', string>> = {
  low: '🟢 low risk',
  medium: '🟡 medium risk',
  high: '🔴 high risk',
};

function urlFromQuery(q: string): string {
  return `openid4vp://?${q}`;
}

export default function OidcConsent() {
  const { q } = useLocalSearchParams<{ q: string }>();
  const parsed = useMemo(() => {
    if (!q) return null;
    try {
      return parseOidcRequest(urlFromQuery(q));
    } catch {
      return null;
    }
  }, [q]);

  if (!parsed) {
    return (
      <View className="flex-1 bg-pageBg items-center justify-center p-6">
        <ThemedText tone="secondary">Invalid OIDC request.</ThemedText>
        <View className="mt-3">
          <ThemedButton variant="secondary" label="Back" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  const req = parsed.request;
  const onApprove = () => {
    pushToast('Consent flow (VP build + JARM post) lands next iteration', 'info');
    router.back();
  };
  const onDeny = () => {
    pushToast('Declined', 'warning');
    router.back();
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Sign-in request</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          {req.client_id}
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">REQUESTED SCOPES</ThemedText>
        {req.scope.map((s: OIDCScope) => (
          <View key={s} className="mt-2 flex-row justify-between">
            <ThemedText variant="bodyLarge">{s}</ThemedText>
            <ThemedText variant="bodySmall" tone="secondary">
              {RISK_BADGE[riskLevel(s)]}
            </ThemedText>
          </View>
        ))}
      </ThemedSurface>

      {req.presentation_definition ? (
        <ThemedSurface variant="card" padded className="mx-4 mt-3">
          <ThemedText variant="caption" tone="tertiary">CREDENTIALS REQUESTED</ThemedText>
          {req.presentation_definition.input_descriptors.map((d) => (
            <ThemedText key={d.id} variant="bodyMedium" className="mt-1">
              {d.name ?? d.id}
              {d.purpose ? ` — ${d.purpose}` : ''}
            </ThemedText>
          ))}
        </ThemedSurface>
      ) : null}

      <View className="px-4 mt-6 mb-10">
        <ThemedButton label="Approve" fullWidth onPress={onApprove} />
        <View className="mt-2">
          <ThemedButton variant="destructive" label="Deny" fullWidth onPress={onDeny} />
        </View>
      </View>
    </ScrollView>
  );
}
