/**
 * VerifiedProfileView — the shared "here's the Verified Page we locally
 * verified" presentation (1.3.3 Task A2.3, US-11). Used by both
 * `VerifiedPageResultSheet` (fresh scan result) and the People detail
 * screen (`app/people/profile/[did].tsx`, a persisted snapshot) so the two
 * never drift — same displayName/bio/links/badges layout either way.
 *
 * Every badge renders as `declared` — a dotted-outline chip labelled
 * 「離線,未即時查驗」 (offline, not live-checked). No badge verifiers exist
 * yet (A4+ adds them); rendering anything stronger here would be exactly
 * the fake-verified-state CLAUDE.md rule 8 forbids. The JWS signature
 * itself, by contrast, genuinely IS verified locally (S-level, works in
 * airplane mode per 01-spec §6/§8) — that's the one green "簽章有效"
 * indicator this view shows.
 */
import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { ProfileRecord } from '@solidarity/shared';

export interface VerifiedProfileViewProps {
  readonly record: ProfileRecord;
}

export function VerifiedProfileView({ record }: VerifiedProfileViewProps): ReactNode {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <ThemedText variant="titleLarge">{record.displayName}</ThemedText>
        <ThemedText variant="caption" tone="tertiary" selectable style={{ fontFamily: 'Menlo' }}>
          {record.did}
        </ThemedText>
      </View>

      <View className="flex-row items-center" style={{ gap: 6 }}>
        <SfIcon name="checkmark.seal.fill" size={16} color={Colors.terminalGreen} />
        <ThemedText variant="label" style={{ color: Colors.terminalGreen }}>
          {t('verifiedPage.signatureValid')}
        </ThemedText>
      </View>

      {record.bio.length > 0 ? (
        <ThemedText variant="bodyMedium" tone="secondary">
          {record.bio}
        </ThemedText>
      ) : null}

      {record.links.length > 0 ? (
        <View style={{ gap: 8 }}>
          <ThemedText variant="caption" tone="tertiary">
            {t('verifiedPage.linksHeader')}
          </ThemedText>
          {record.links.map((link) => (
            <PressableScale
              key={`${link.label}-${link.url}`}
              haptic="tap"
              onPress={() => {
                void Linking.openURL(link.url).catch(() => undefined);
              }}
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

      <View style={{ gap: 8 }}>
        <ThemedText variant="caption" tone="tertiary">
          {t('verifiedPage.badgesHeader')}
        </ThemedText>
        {record.badges.length === 0 ? (
          <ThemedText variant="bodySmall" tone="tertiary">
            {t('verifiedCard.noBadgesYet')}
          </ThemedText>
        ) : (
          <View style={{ gap: 6 }}>
            {record.badges.map((badge) => (
              <View
                key={`${badge.type}-${badge.subject}`}
                className="flex-row items-center justify-between rounded-lg border border-divider"
                style={{ borderStyle: 'dashed', paddingHorizontal: 10, paddingVertical: 8 }}
              >
                <ThemedText variant="bodySmall" style={{ flexShrink: 1 }}>
                  {`${badge.type} · ${badge.subject}`}
                </ThemedText>
                <ThemedText variant="caption" tone="tertiary">
                  {t('verifiedPage.badgeDeclared')}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
