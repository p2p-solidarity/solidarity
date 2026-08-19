import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { PageSectionLabel } from '@/components/me/PageSectionLabel';
import { ROW_RADIUS } from '@/components/me/pageRowStyles';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
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
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const selectedClaim = claims.find((claim) => claim.id === selectedClaimId) ?? claims[0] ?? null;

  return (
    <View className="gap-3">
      <PageSectionLabel title={t('present.attestations')} />
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
        <View className="gap-3">
          <IdentityProofCard
            count={selectedClaim === null ? 0 : 1}
            quiet={t('present.attestationQuiet')}
          />
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {claims.map((claim) => (
              <ClaimChip
                key={claim.id}
                label={claim.title}
                selected={claim.id === selectedClaim?.id}
                onPress={() => { setSelectedClaimId(claim.id); }}
              />
            ))}
          </View>
          <ThemedButton
            label={t('present.openProof')}
            variant="primary"
            fullWidth
            disabled={selectedClaim === null}
            onPress={() => {
              if (selectedClaim === null) return;
              router.push({
                pathname: '/credentials/[id]',
                params: {
                  id: selectedClaim.identityCardId,
                  claimId: selectedClaim.id,
                  product: '1',
                },
              });
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * `.bcard` — the warm identity plate the claim chips sit under, carrying what
 * this presentation currently amounts to.
 */
function IdentityProofCard({
  count,
  quiet,
}: {
  readonly count: number;
  readonly quiet: string;
}): ReactNode {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <LinearGradient
      colors={[colors.chipSurface, colors.warmCream]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderWidth: 1, borderColor: colors.divider, padding: 16, gap: 6 }}
    >
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <SfIcon name="wallet.pass" size={16} color={Colors.primaryBlue} />
        <ThemedText variant="label" style={{ flex: 1 }}>
          {t('present.selectedCount', { count })}
        </ThemedText>
      </View>
      <ThemedText variant="bodySmall" tone="secondary">
        {quiet}
      </ThemedText>
    </LinearGradient>
  );
}

/**
 * `.claim` — a bordered pill that turns green when it is part of what you are
 * about to show. Visual box stays the mock's 32pt; the touch target is padded
 * out to 44 with `hitSlop`, which the 8pt chip gutter leaves room for.
 */
function ClaimChip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): ReactNode {
  const colors = useThemeColors();
  return (
    <PressableScale
      haptic="tap"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      onPress={onPress}
      style={{
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderWidth: 1.5,
        borderRadius: ROW_RADIUS,
        borderColor: selected ? Colors.terminalGreen : colors.divider,
        backgroundColor: selected ? Colors.terminalGreenBg : colors.cardBg,
      }}
    >
      <ThemedText
        variant="bodySmall"
        style={{ color: selected ? Colors.terminalGreenText : colors.text2 }}
      >
        {label}
      </ThemedText>
    </PressableScale>
  );
}
