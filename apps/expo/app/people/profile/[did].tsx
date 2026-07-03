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
 * chrome" only where it doesn't leak sensitive fields.
 *
 * Task A5.4 (US-20) extended this screen to also be the `solidarity://
 * pear/<did>` deep-link landing target: a `did` with no saved snapshot yet
 * renders `PearConnectSection`'s honest "connect privately" flow instead of
 * a dead-end not-found state — see that component's doc for why it's safe
 * to offer a Pear dial for ANY structurally valid did:key reaching this
 * screen (deep link or otherwise), not just ones that arrived via the deep
 * link specifically. A `did` that isn't even a well-formed did:key
 * (`isValidPearDid`, `@/deeplink/parser`) still falls back to the honest
 * not-found state — the deep-link parser already rejects those before
 * routing here, so this is only a fallback for a stale/mistyped snapshot
 * route.
 */
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { CardExchangeSection } from '@/components/people/CardExchangeSection';
import { PearConnectSection } from '@/components/people/PearConnectSection';
import { VerifiedProfileView } from '@/components/scan/VerifiedProfileView';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { isValidPearDid } from '@/deeplink/parser';
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
      ) : did && isValidPearDid(did) ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
          <PearConnectSection did={did} />
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
