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
import type { LinkVisibility } from '@/profile/projection';
import type { ProfileLink } from '@solidarity/shared';

import { pageLinkSections, type PageLinkEntry } from './pageLinkSections';

export interface ProfileLinksListProps {
  readonly links: readonly ProfileLink[];
  readonly linkVisibility: readonly LinkVisibility[];
  readonly onEdit: () => void;
  readonly onAddFirstLink: () => void;
}

export function ProfileLinksList({
  links,
  linkVisibility,
  onEdit,
  onAddFirstLink,
}: ProfileLinksListProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const sections = pageLinkSections(links, linkVisibility);

  const openLink = (link: ProfileLink) => {
    void Linking.openURL(link.url).catch(() => {
      appAlert({ title: t('mePage.linkErrorTitle'), message: t('mePage.linkErrorMessage') });
    });
  };

  const renderLinkRows = (entries: readonly PageLinkEntry[]) => {
    if (entries.length === 0) return null;

    return (
      <View className="gap-2">
        {entries.map(({ link, sourceIndex }) => (
          <ThemedSurface
            key={`${String(sourceIndex)}-${link.label}-${link.url}`}
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
    );
  };

  const renderSection = (title: string, entries: readonly PageLinkEntry[]) => {
    if (entries.length === 0) return null;

    return (
      <View className="gap-3">
        <ThemedText accessibilityRole="header" variant="label" tone="tertiary">
          {title}
        </ThemedText>
        {renderLinkRows(entries)}
      </View>
    );
  };

  const addLinkAction = (
    <PressableScale
      haptic="tap"
      onPress={onAddFirstLink}
      accessibilityRole="button"
      accessibilityLabel={t('meHome.addLink')}>
      <ThemedSurface
        variant="inset"
        className="flex-row items-center gap-2 rounded-none px-3"
        style={{ minHeight: 44 }}>
        <SfIcon name="plus" size={14} color={Colors.primaryBlue} />
        <ThemedText variant="label" tone="accent">
          {t('meHome.addLink')}
        </ThemedText>
      </ThemedSurface>
    </PressableScale>
  );

  if (links.length === 0) {
    return (
      <View className="gap-5 px-4">
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
            <SfIcon name="link" size={16} color={Colors.primaryBlue} />
          </View>
          <ThemedText variant="bodyMedium" tone="tertiary" style={{ flex: 1 }}>
            {t('mePage.noLinks')}
          </ThemedText>
        </ThemedSurface>
        {addLinkAction}
      </View>
    );
  }

  return (
    <View className="gap-5 px-4">
      {renderSection(t('mePage.publicPage'), sections.publicLinks)}
      {renderSection(t('mePage.cardOnly'), sections.cardOnlyLinks)}
      {renderSection(t('mePage.hidden'), sections.hiddenLinks)}
      {addLinkAction}
    </View>
  );
}
