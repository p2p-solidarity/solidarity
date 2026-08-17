/**
 * OIDC consent — mirrors Swift OIDCRequestView.
 *
 * Parses the inbound openid4vp:// query, shows the requesting verifier +
 * scopes + presentation definition, and lets the user approve / deny. On
 * approve we build the VP token via `presenter.buildVpToken`, then submit
 * via `submitAuthorizationResponse`. Errors are reported by toast and the
 * screen stays open so the user can retry.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useMemo, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { useActiveDid } from '@/identity';
import { parseOidcRequest } from '@/oidc/parseAuthRequest';
import { buildVpToken } from '@/oidc/presenter';
import { submitAuthorizationResponse } from '@/oidc/submitResponse';
import { usePreferences } from '@/settings/preferences';
import { riskLevel, type OIDCScope } from '@solidarity/shared';

const RISK_BADGE: Readonly<Record<'low' | 'medium' | 'high', string>> = {
  low: '🟢 low risk',
  medium: '🟡 medium risk',
  high: '🔴 high risk',
};

function urlFromQuery(q: string): string {
  return `openid4vp://?${q}`;
}

export default function OidcConsentRoute() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings/advanced" />;

  return <OidcConsent />;
}

function OidcConsent() {
  const { q } = useLocalSearchParams<{ q: string }>();
  const activeDid = useActiveDid();
  const [submitting, setSubmitting] = useState(false);
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
          <ThemedButton variant="secondary" label="Back" onPress={() => { safeBack(); }} />
        </View>
      </View>
    );
  }

  const req = parsed.request;
  const onApprove = async () => {
    if (!activeDid) {
      pushToast('Active identity not ready', 'warning');
      return;
    }
    setSubmitting(true);
    const inputDescriptors = req.presentation_definition?.input_descriptors ?? [];
    const selectedClaimIds = inputDescriptors.map((d) => d.id);
    const vpResult = await buildVpToken({
      request: parsed,
      selectedClaimIds,
      holderDid: activeDid,
    });
    if (!vpResult.ok) {
      pushToast(vpResult.error.message, 'error');
      setSubmitting(false);
      return;
    }
    const submitResult = await submitAuthorizationResponse({
      request: parsed,
      vpJwt: vpResult.value.vpJwt,
      presentationSubmission: vpResult.value.presentationSubmission,
    });
    if (!submitResult.ok) {
      pushToast(submitResult.error.message, 'error');
      setSubmitting(false);
      return;
    }
    pushToast('Presentation sent', 'success');
    setSubmitting(false);
    if (submitResult.value.redirectTo) {
      try {
        await Linking.openURL(submitResult.value.redirectTo);
      } catch {
        // verifier-side post-redirect is optional; ignore opener errors
      }
    }
    safeBack();
  };
  const onDeny = () => {
    pushToast('Declined', 'warning');
    safeBack();
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Sign-in request</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          {req.client_id}
        </ThemedText>
      </View>

      {req.scope.length > 0 ? (
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
      ) : null}

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
        <ThemedButton
          label={submitting ? 'Sending…' : 'Approve'}
          fullWidth
          loading={submitting}
          disabled={submitting}
          onPress={() => { void onApprove(); }}
        />
        <View className="mt-2">
          <ThemedButton
            variant="destructive"
            label="Deny"
            fullWidth
            disabled={submitting}
            onPress={onDeny}
          />
        </View>
      </View>
    </ScrollView>
  );
}
