import { Linking, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { appAlert } from '@/feedback/appAlert';
import { SCALE } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import { linkIconNameFor } from '@/profile/linkPresentation';
import type { ProfileLink } from '@solidarity/shared';

export interface ProfileLinksListProps {
  readonly links: readonly ProfileLink[];
  readonly onEdit: () => void;
}

export function ProfileLinksList({ links, onEdit }: ProfileLinksListProps) {
  const { t } = useTranslation();
  const c = useThemeColors();

  const openLink = (link: ProfileLink) => {
    void Linking.openURL(link.url).catch(() => {
      appAlert({ title: t('mePage.linkErrorTitle'), message: t('mePage.linkErrorMessage') });
    });
  };

  return (
    <View className="gap-3 px-4">
      <ThemedText variant="label" tone="tertiary">
        {t('mePage.links')}
      </ThemedText>

      {links.length === 0 ? (
        <PressableScale
          haptic="tap"
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t('mePage.addFirstLink')}>
          <ThemedSurface
            variant="outlined"
            className="flex-row items-center gap-3 rounded-none px-4 py-4">
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.searchBg,
              }}>
              <SfIcon name="link.badge.plus" size={16} color={Colors.primaryBlue} />
            </View>
            <ThemedText variant="bodyMedium" tone="tertiary" style={{ flex: 1 }}>
              {t('mePage.addFirstLink')}
            </ThemedText>
            <SfIcon name="pencil" size={14} color={Colors.text3} />
          </ThemedSurface>
        </PressableScale>
      ) : (
        <View className="gap-2">
          {links.map((link, index) => (
            <ThemedSurface
              key={`${String(index)}-${link.label}-${link.url}`}
              variant="card"
              className="flex-row items-center rounded-none">
              <PressableScale
                fill
                haptic="tap"
                onPress={() => {
                  openLink(link);
                }}
                onLongPress={onEdit}
                accessibilityRole="link"
                accessibilityLabel={link.label.length > 0 ? link.label : link.url}
                style={{
                  minHeight: 64,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: c.searchBg,
                  }}>
                  <SfIcon
                    name={linkIconNameFor(link.label, link.url)}
                    size={16}
                    color={Colors.primaryBlue}
                  />
                </View>
                <View className="flex-1 gap-0.5">
                  {link.label.length > 0 ? (
                    <ThemedText variant="bodyMedium" numberOfLines={1}>
                      {link.label}
                    </ThemedText>
                  ) : null}
                  <ThemedText
                    variant="caption"
                    tone="tertiary"
                    numberOfLines={1}
                    ellipsizeMode="middle">
                    {link.url}
                  </ThemedText>
                </View>
                <SfIcon name="arrow.up.right" size={12} color={Colors.text3} />
              </PressableScale>
              <PressableScale
                haptic="tap"
                scaleTo={SCALE.icon}
                onPress={onEdit}
                accessibilityRole="button"
                accessibilityLabel={t('profileCard.edit')}
                style={{ width: 44, height: 64, alignItems: 'center', justifyContent: 'center' }}>
                <SfIcon name="pencil" size={14} color={Colors.text2} />
              </PressableScale>
            </ThemedSurface>
          ))}
        </View>
      )}
    </View>
  );
}
