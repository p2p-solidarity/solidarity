/**
 * ProfileLinksList — the Page tab's field list, ported from the mock's
 * `#fieldList` / `#cardFields` (`creds-design/verified-linkinbio-mock-v3.html`
 * §`#s-page`): a `.proof-sec` section label above 64pt `.field` rows, each a
 * 40pt round icon tile, the label, and the URL in mono.
 *
 * Row tap opens the editor, matching the mock ("任一欄位 → 編輯"); long-press
 * still opens the link itself, so nothing the previous layout could do was
 * lost. The mock's per-row `.st` verification pill is deliberately absent: a
 * signed `ProfileLink` has no per-link check result to render (Rule 8).
 */
import { Linking, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { BrandIcon } from '@/components/icons/BrandIcon';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { brandIconForLink } from '@/profile/linkPresentation';
import type { LinkVisibility } from '@/profile/projection';
import type { ProfileLink } from '@solidarity/shared';

import { PageEmptyState } from './PageEmptyState';
import { PageSectionLabel } from './PageSectionLabel';
import { ROW_GAP, fieldRowStyle, iconTileStyle } from './pageRowStyles';
import { pageLinkSections, type PageLinkEntry } from './pageLinkSections';

export interface ProfileLinksListProps {
  readonly links: readonly ProfileLink[];
  readonly linkVisibility: readonly LinkVisibility[];
  readonly onEdit: () => void;
  readonly onAddFirstLink: () => void;
  /** Opens the "bring links from somewhere else" importer — the mock's second
   *  empty-state action. Omitted callers simply don't render it. */
  readonly onImportLinks?: () => void;
}

export function ProfileLinksList({
  links,
  linkVisibility,
  onEdit,
  onAddFirstLink,
  onImportLinks,
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
      <View style={{ gap: ROW_GAP }}>
        {entries.map(({ link, sourceIndex }) => (
          <PressableScale
            key={`${String(sourceIndex)}-${link.label}-${link.url}`}
            haptic="tap"
            onPress={onEdit}
            onLongPress={() => {
              openLink(link);
            }}
            accessibilityRole="button"
            accessibilityLabel={link.label.length > 0 ? link.label : link.url}
            accessibilityHint={t('mePage.editLinkHint')}
            style={fieldRowStyle(c.mutedSurface)}>
            <View style={iconTileStyle(c.chipSurface)}>
              <BrandIcon
                name={brandIconForLink(link.label, link.url)}
                size={22}
                color={Colors.primaryBlue}
              />
            </View>
            <View className="flex-1" style={{ gap: 1 }}>
              {link.label.length > 0 ? (
                <ThemedText variant="bodyMedium" numberOfLines={1}>
                  {link.label}
                </ThemedText>
              ) : null}
              <ThemedText
                variant="caption"
                tone="tertiary"
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ fontFamily: 'Menlo' }}>
                {link.url}
              </ThemedText>
            </View>
            <SfIcon name="chevron.right" size={13} color={Colors.text3} />
          </PressableScale>
        ))}
      </View>
    );
  };

  const renderSection = (title: string, entries: readonly PageLinkEntry[]) => {
    if (entries.length === 0) return null;

    return (
      <View style={{ gap: 8 }}>
        <PageSectionLabel title={title} />
        {renderLinkRows(entries)}
      </View>
    );
  };

  // The mock words this entry point twice — `＋ 新增第一個連結` on the empty
  // page, `＋ 新增` once there is a list — but it stays ONE action.
  const addLinkAction = (
    <AddLinkButton
      label={links.length === 0 ? t('mePage.addFirstLink') : t('meHome.addLink')}
      onPress={onAddFirstLink}
    />
  );

  if (links.length === 0) {
    return (
      <View className="gap-3 px-4">
        <PageEmptyState
          title={t('mePage.noLinks')}
          message={t('mePage.noLinksHint')}
          action={addLinkAction}
          {...(onImportLinks
            ? { secondaryAction: { label: t('mePage.importLinks'), onPress: onImportLinks } }
            : {})}
        />
      </View>
    );
  }

  return (
    <View className="gap-5 px-4">
      {renderSection(t('mePage.publicPage'), sections.publicLinks)}
      {renderSection(t('mePage.cardOnly'), sections.cardOnlyLinks)}
      {sections.hiddenLinks.length > 0 ? (
        <PressableScale
          haptic="tap"
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel={t('mePage.reviewHidden')}
          style={{ ...fieldRowStyle(c.mutedSurface), minHeight: 52 }}>
          <SfIcon name="eye.slash" size={16} color={Colors.text3} />
          <View className="flex-1" style={{ gap: 1 }}>
            <ThemedText variant="bodyMedium">{t('mePage.reviewHidden')}</ThemedText>
            <ThemedText variant="caption" tone="tertiary">
              {t('mePage.hiddenCount', { count: sections.hiddenLinks.length })}
            </ThemedText>
          </View>
          <SfIcon name="chevron.right" size={13} color={Colors.text3} />
        </PressableScale>
      ) : null}
      {addLinkAction}
    </View>
  );
}

function AddLinkButton({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return <ThemedButton label={label} fullWidth onPress={onPress} />;
}
