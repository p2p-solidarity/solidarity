import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useTranslation } from '@/i18n';
import type { ProvableClaimEntity } from '@/identity';
import type { PresentAttestationsState } from '@/present/presentModel';

export function PresentAttestationsMode({
  claims,
  state,
  onRetry,
}: {
  readonly claims: readonly ProvableClaimEntity[];
  readonly state: PresentAttestationsState;
  readonly onRetry: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <ThemedText accessibilityRole="header" variant="label" tone="tertiary">
        {t('present.attestations')}
      </ThemedText>
      {state === 'loading' ? (
        <ThemedSurface variant="outlined" padded className="items-center gap-3 rounded-none">
          <ActivityIndicator />
          <ThemedText variant="bodySmall" tone="tertiary">
            {t('present.loadingAttestations')}
          </ThemedText>
        </ThemedSurface>
      ) : null}
      {state === 'error' ? (
        <ThemedSurface variant="outlined" padded className="gap-3 rounded-none">
          <ThemedText variant="bodyMedium" tone="error">
            {t('present.attestationsLoadError')}
          </ThemedText>
          <ThemedButton label={t('present.retry')} variant="secondary" onPress={onRetry} />
        </ThemedSurface>
      ) : null}
      {state === 'empty' ? (
        <ThemedSurface variant="outlined" padded className="gap-4 rounded-none">
          <ThemedText variant="bodyMedium" tone="tertiary">
            {t('present.noAttestations')}
          </ThemedText>
          <ThemedButton
            label={t('present.addAttestation')}
            variant="secondary"
            fullWidth
            onPress={() => { router.push('/passport'); }}
          />
        </ThemedSurface>
      ) : null}
      {state === 'ready' ? (
        <View className="gap-2">
          {claims.map((claim) => (
            <PressableScale
              key={claim.id}
              haptic="tap"
              accessibilityRole="button"
              accessibilityLabel={claim.title}
              onPress={() => {
                router.push({
                  pathname: '/credentials/[id]',
                  params: { id: claim.identityCardId, claimId: claim.id },
                });
              }}>
              <ThemedSurface
                variant="inset"
                className="flex-row items-center gap-3 rounded-none px-4 py-3"
                style={{ minHeight: 56 }}>
                <SfIcon name={attestationIcon(claim.claimType)} size={16} />
                <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
                  {claim.title}
                </ThemedText>
                <SfIcon name="chevron.right" size={12} />
              </ThemedSurface>
            </PressableScale>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function attestationIcon(claimType: string): SFSymbol {
  switch (claimType) {
    case 'is_human': return 'faceid';
    case 'age_over_18': return 'face.smiling';
    case 'field_name': return 'person.fill';
    default: return 'checkmark.shield.fill';
  }
}
