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
import { useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import type { ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { useDeclaredSnapshot } from '@/people/profileSnapshots';

export default function DeclaredPageDetailScreen(): ReactNode {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const snapshot = useDeclaredSnapshot(id);
  const insets = useSafeAreaInsets();

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
              onPress={() => { void Linking.openURL(snapshot.sourceUrl).catch(() => undefined); }}
              accessibilityRole="link"
            >
              <ThemedText variant="caption" tone="tertiary" selectable>
                {snapshot.sourceUrl}
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
              {snapshot.links.map((link) => (
                <PressableScale
                  key={`${link.label}-${link.url}`}
                  haptic="tap"
                  onPress={() => { void Linking.openURL(link.url).catch(() => undefined); }}
                  accessibilityRole="link"
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <SfIcon name="link" size={13} color={Colors.text2} />
                  <ThemedText variant="bodySmall" tone="secondary" style={{ flexShrink: 1 }}>
                    {link.label.length > 0 ? `${link.label} · ${link.url}` : link.url}
                  </ThemedText>
                </PressableScale>
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
