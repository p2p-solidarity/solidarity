/**
 * Verified Page person detail — 1.3.3 Task A2.3 (US-11). Landing screen
 * after 「存入 People」 in `VerifiedPageResultSheet`, and the target for
 * re-opening a previously-saved snapshot. Deliberately separate from
 * `app/people/[id].tsx` (the Contact/BusinessCard detail screen) — a
 * Profile Record snapshot has no `Contact` counterpart (see
 * `src/people/profileSnapshots.ts`'s module doc for why the two stores
 * stay parallel rather than merged).
 *
 * Reads the snapshot store directly by `did` route param — no PII carried
 * in the route itself, matching CLAUDE.md rule 10's "route params carry
 * chrome" only where it doesn't leak sensitive fields. A missing snapshot
 * (bad/stale deep link) renders an honest not-found state rather than a
 * blank screen.
 */
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { CardExchangeSection } from '@/components/people/CardExchangeSection';
import { VerifiedProfileView } from '@/components/scan/VerifiedProfileView';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { useProfileSnapshot } from '@/people/profileSnapshots';

export default function VerifiedProfileDetailScreen(): ReactNode {
  const { t } = useTranslation();
  const { did } = useLocalSearchParams<{ did: string }>();
  const snapshot = useProfileSnapshot(did);
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center" style={{ paddingHorizontal: 16, height: 44 }}>
        <PressableScale
          haptic="tap"
          onPress={() => { router.back(); }}
          accessibilityRole="button"
          style={{ width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' }}
        >
          <SfIcon name="chevron.left" size={18} color={Colors.text1} />
        </PressableScale>
      </View>

      {snapshot ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
          <VerifiedProfileView record={snapshot.record} />
          <CardExchangeSection did={snapshot.did} verifiedDisplayName={snapshot.record.displayName} />
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <SfIcon name="questionmark.circle" size={32} color={Colors.text3} />
          <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
            {t('verifiedPage.notFound')}
          </ThemedText>
        </View>
      )}
    </View>
  );
}
