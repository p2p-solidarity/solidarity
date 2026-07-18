/**
 * VerifiedProfileView — the shared "here's the Verified Page we locally
 * verified" presentation (1.3.3 Task A2.3, US-11). Used by both
 * `VerifiedPageResultSheet` (fresh scan result) and the People detail
 * screen (`app/people/profile/[did].tsx`, a persisted snapshot) so the two
 * never drift — same displayName/bio/links/badges layout either way.
 *
 * Profile-record badges remain offline declarations on this snapshot.
 * When the page arrived through a live handle read, `handleBinding` carries
 * the fresh bidirectional gate verdict and is rendered separately: only an
 * exact `verified` result gets a filled green seal; declared/stale/revoked
 * remain visibly non-green.
 */
import type { ReactNode } from 'react';
import { Linking, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { handleBadgeViewModel } from '@/badges/handleBadgeDisplay';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { VerifiedHandleBinding } from '@/scan/verifiedPageHandler';
import type { ProfileRecord } from '@solidarity/shared';

export interface VerifiedProfileViewProps {
  readonly record: ProfileRecord;
  readonly handleBinding?: VerifiedHandleBinding;
}

export function VerifiedProfileView({ record, handleBinding }: VerifiedProfileViewProps): ReactNode {
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

      {handleBinding ? <HandleBindingBadge binding={handleBinding} /> : null}

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

function HandleBindingBadge({ binding }: { readonly binding: VerifiedHandleBinding }): ReactNode {
  const { t } = useTranslation();
  const model = handleBadgeViewModel(binding.state);
  const style = (() => {
    switch (model.visual) {
      case 'verified':
        return { icon: 'checkmark.seal.fill' as const, color: Colors.terminalGreen };
      case 'declared':
        return { icon: 'checkmark.seal' as const, color: Colors.warning };
      case 'stale':
        return { icon: 'exclamationmark.triangle' as const, color: Colors.text3 };
      case 'revoked':
        return { icon: 'xmark.seal.fill' as const, color: Colors.destructive };
    }
  })();

  return (
    <ThemedSurface
      variant="inset"
      className="self-start rounded-none px-3 py-2"
      style={{ borderWidth: 1, borderColor: Colors.divider }}
    >
      <View className="flex-row items-center" style={{ gap: 7 }}>
        <SfIcon name={style.icon} size={15} color={style.color} />
        <ThemedText variant="label" style={{ color: style.color }}>
          {`${binding.scheme.toUpperCase()} · ${binding.handle} · ${t(model.labelKey)}`}
        </ThemedText>
      </View>
    </ThemedSurface>
  );
}
