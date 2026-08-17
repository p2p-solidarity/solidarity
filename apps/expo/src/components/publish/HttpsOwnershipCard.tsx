import type { ReactNode } from 'react';
import { View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { useThemeColors } from '@/constants/useThemeColors';
import { useTranslation } from '@/i18n';
import type { HttpsOwnershipEvidence } from '@/profile/httpsOwnership';

export function HttpsOwnershipCard({
  evidence,
}: {
  readonly evidence: readonly HttpsOwnershipEvidence[] | null;
}): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const checking = evidence === null;
  const verified = evidence !== null && evidence.length > 0;
  const statusKey = checking
    ? 'nostrConnect.httpsChecking'
    : verified
      ? 'nostrConnect.httpsVerified'
      : 'nostrConnect.httpsSetup';

  return (
    <ThemedSurface variant="outlined" className="rounded-none p-3">
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.searchBg,
          }}>
          <SfIcon
            name={verified ? 'checkmark.seal.fill' : 'globe'}
            size={16}
            color={verified ? c.terminalGreen : c.text3}
          />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <ThemedText variant="label">{t('nostrConnect.httpsTitle')}</ThemedText>
          <ThemedText variant="caption" tone="secondary">
            {t(statusKey, { count: evidence?.length ?? 0 })}
          </ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            {t('nostrConnect.httpsMethods')}
          </ThemedText>
        </View>
      </View>
    </ThemedSurface>
  );
}
