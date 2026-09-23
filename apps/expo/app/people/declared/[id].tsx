/**
 * Declared link-page detail — 1.3.3 Task A2.4 (US-19). The counterpart to
 * `app/people/profile/[did].tsx` for a `kind: 'declared'` snapshot
 * (`src/people/profileSnapshots.ts`) — a plaintext link page (Linktree or
 * similar) someone pasted via People's 「貼上連結頁」, NOT a cryptographically
 * verified page. It gets its OWN route (keyed by `stableDeclaredId
 * (sourceUrl)`, not a did — a declared entry has none) rather than
 * overloading `/people/profile/[did]`, so the two can never be confused at
 * the routing layer either.
 *
 * Every declared page renders an unmistakable 「宣稱‧未驗證」 badge plus an
 * explicit disclaimer sentence — CLAUDE.md rule 8: this content is exactly
 * what the source URL published, with zero cryptographic verification, and
 * the screen must never suggest otherwise. A missing snapshot (bad/stale
 * deep link) renders an honest not-found state rather than a blank screen.
 */
import { BrandIcon } from '@/components/icons/BrandIcon';
import { linkDisplay, linkSecondaryLabel } from '@/profile/linkPresentation';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { fadeUpIn } from '@/feedback/motion';
import { hostnameOf } from '@/profile/linkPresentation';
import { useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import type { ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { useDeclaredSnapshot } from '@/people/profileSnapshots';

export default function DeclaredPageDetailScreen(): ReactNode {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useDeclaredSnapshot(id);
  const insets = useSafeAreaInsets();
  const openUrl = (url: string): void => {
    void Linking.openURL(url).catch(() => {
      appAlert({
        title: t('mePage.linkErrorTitle'),
        message: t('mePage.linkErrorMessage'),
      });
    });
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center" style={{ paddingHorizontal: 16, height: 44 }}>
        <PressableScale
          haptic="tap"
          onPress={() => { safeBack(); }}
          accessibilityRole="button"
          style={{ width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' }}
        >
          <SfIcon name="chevron.left" size={18} color={Colors.text1} />
        </PressableScale>
      </View>

      {snapshot ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <View style={{ gap: 4 }}>
            <ThemedText variant="titleLarge">
              {snapshot.title && snapshot.title.trim().length > 0 ? snapshot.title : hostnameOf(snapshot.sourceUrl)}
            </ThemedText>
            <PressableScale
              haptic="tap"
              onPress={() => { openUrl(snapshot.sourceUrl); }}
              accessibilityRole="link"
              style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <BrandIcon name={linkDisplay('', snapshot.sourceUrl).brand} size={20} color={Colors.text2} />
              <ThemedText variant="caption" tone="tertiary" selectable>
                {linkDisplay('', snapshot.sourceUrl).text}
              </ThemedText>
            </PressableScale>
          </View>

          <View
            className="flex-row items-center rounded-lg border border-divider"
            style={{ borderStyle: 'dashed', gap: 8, paddingHorizontal: 10, paddingVertical: 8, alignSelf: 'flex-start' }}
          >
            <SfIcon name="questionmark.circle" size={14} color={Colors.text2} />
            <ThemedText variant="label">{t('declaredPage.badge')}</ThemedText>
          </View>

          <ThemedText variant="bodyMedium" tone="secondary">
            {t('declaredPage.disclaimer')}
          </ThemedText>

          {snapshot.links.length > 0 ? (
            <View style={{ gap: 8 }}>
              <ThemedText variant="caption" tone="tertiary">
                {t('verifiedPage.linksHeader')}
              </ThemedText>
              {snapshot.links.map((link, index) => (
                <Animated.View key={`${link.label}-${link.url}`} entering={fadeUpIn(index, reduceMotion)}>
                  <PressableScale
                    haptic="tap"
                    onPress={() => { openUrl(link.url); }}
                    accessibilityRole="link"
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  >
                    <BrandIcon name={linkDisplay(link.label, link.url).brand} size={20} color={Colors.text2} />
                    <View style={{ flex: 1, gap: 1 }}>
                      <ThemedText variant="bodyMedium" numberOfLines={1} ellipsizeMode="middle">
                        {linkDisplay(link.label, link.url).text}
                      </ThemedText>
                      {linkSecondaryLabel(link.label, link.url) ? (
                        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
                          {linkSecondaryLabel(link.label, link.url)}
                        </ThemedText>
                      ) : null}
                    </View>
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center gap-2 px-8">
          <SfIcon name="questionmark.circle" size={32} color={Colors.text3} />
          <ThemedText variant="bodyMedium" tone="secondary" style={{ textAlign: 'center' }}>
            {t('declaredPage.notFound')}
          </ThemedText>
        </View>
      )}
    </View>
  );
}
