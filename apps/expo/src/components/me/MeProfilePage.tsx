import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { useThemeColors } from '@/constants/useThemeColors';
import { fadeUpIn } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import type { LinkVisibility } from '@/profile/projection';
import type { ProfileRecord } from '@solidarity/shared';
import type { PublicPageShareSource } from './meProfileModel';

import { displayProfileShareUrl } from './meProfileModel';
import { useProfileShareSelection } from './useProfileShareSelection';
import { blockRowStyle } from './pageRowStyles';
import { PageSectionLabel } from './PageSectionLabel';
import { ProfileBadgeChips } from './ProfileBadgeChips';
import { ProfileHero } from './ProfileHero';
import { ProfileLinksList } from './ProfileLinksList';
import { ProfileSectionsList } from './ProfileSectionsList';
import { PageAddSheet } from './PageAddSheet';
import { PageAppearanceSheet } from './PageAppearanceSheet';
import { PageLapsedCheckAlert } from './PageLapsedCheckAlert';

export interface MeProfilePageProps {
  /** The FULL record — the owner's own view: every link, including private
   *  ones. Used for the hero, badges, and the on-screen link list. */
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly linkVisibility: readonly LinkVisibility[];
  /** The public projection stored by ATProto/Nostr binding backends. */
  readonly publicRecord: ProfileRecord;
  /** Separately signed public projection used for the public `/name` link. */
  readonly publicPage: PublicPageShareSource | null;
  /** The SHARED projection (public + link-only links, T7) — what the QR /
   *  URL-fragment share surface encodes so a private link never leaves in a
   *  scanned code. Falls back to the full record for a pre-T7 profile. */
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly nostrShortUrlReady: boolean;
  readonly bottomInset: number;
  readonly onEdit: () => void;
  readonly onEditAvatar: () => void;
  readonly onAddLink: () => void;
  readonly onImportLinks: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenBindings: () => void;
}

export function MeProfilePage({
  record,
  jws,
  linkVisibility,
  publicRecord,
  publicPage,
  shareRecord,
  shareJws,
  nostrShortUrlReady,
  bottomInset,
  onEdit,
  onEditAvatar,
  onAddLink,
  onImportLinks,
  onOpenSettings,
  onOpenBindings,
}: MeProfilePageProps): ReactNode {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // The tab's one add entry point: links, sections and attestations all start
  // from the same "＋ 新增" sheet instead of three per-group buttons.
  const [addOpen, setAddOpen] = useState(false);
  // The preview's `.pub-handle` line shows the page's REAL address, or
  // nothing at all while one is still unpublished.
  const shareSelection = useProfileShareSelection(
    shareRecord,
    shareJws,
    nostrShortUrlReady,
    0,
    publicPage,
  );
  const pageHandle = shareSelection.kind === 'ready'
    ? displayProfileShareUrl(shareSelection.selected)
    : null;
  // Sections cascade in top to bottom (`fadeUpIn`: EASE_OUT, 40 ms steps);
  // reduced motion keeps the fade and drops the rise.
  const entrance = (index: number) => fadeUpIn(index, reduceMotion);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingTop: 20, paddingBottom: bottomInset + 100, gap: 24 }}>
      <Animated.View entering={entrance(0)}>
        <ProfileHero
          record={record}
          shareRecord={shareRecord}
          shareJws={shareJws}
          publicPage={publicPage}
          nostrShortUrlReady={nostrShortUrlReady}
          onEditAvatar={onEditAvatar}
          onOpenAppearance={() => {
            setAppearanceOpen(true);
          }}
          onOpenSettings={onOpenSettings}
        />
      </Animated.View>

      <PageLapsedCheckAlert record={record} nostrUploaded={nostrShortUrlReady} />

      <Animated.View entering={entrance(1)}>
        <ProfileLinksList
          links={record.links}
          linkVisibility={linkVisibility}
          onEdit={onEdit}
          onAdd={() => {
            setAddOpen(true);
          }}
          onImportLinks={onImportLinks}
        />
      </Animated.View>

      <Animated.View entering={entrance(2)}>
        <ProfileSectionsList
          linkCount={record.links.length}
          previewRecord={publicRecord}
          previewHandle={pageHandle}
        />
      </Animated.View>

      <Animated.View entering={entrance(3)}>
        <View className="px-4 pb-3">
          <PageSectionLabel title={t('mePage.attestations')} />
        </View>
        <ProfileBadgeChips
          record={record}
          publicRecord={publicRecord}
          jws={jws}
          nostrUploaded={nostrShortUrlReady}
          onCreateProof={onOpenBindings}
        />
      </Animated.View>

      <Animated.View entering={entrance(4)} className="px-4">
        <PressableScale
          onPress={() => { router.push('/settings/passkeys'); }}
          accessibilityRole="button"
          accessibilityLabel={t('webEditing.title')}
          style={blockRowStyle(colors.mutedSurface)}>
          <SfIcon name="desktopcomputer" size={18} color={colors.text2} />
          <ThemedText variant="bodyMedium" style={{ flex: 1 }}>
            {t('webEditing.title')}
          </ThemedText>
          <SfIcon name="chevron.right" size={13} color={colors.text3} />
        </PressableScale>
      </Animated.View>

      <PageAddSheet
        visible={addOpen}
        onClose={() => {
          setAddOpen(false);
        }}
        onAddLink={onAddLink}
        onImportLinks={onImportLinks}
        onAddProof={onOpenBindings}
      />

      <PageAppearanceSheet
        visible={appearanceOpen}
        record={publicRecord}
        handle={pageHandle}
        onClose={() => {
          setAppearanceOpen(false);
        }}
      />
    </ScrollView>
  );
}
