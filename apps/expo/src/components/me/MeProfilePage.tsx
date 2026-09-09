import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { STAGGER_MS } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import type { LinkVisibility } from '@/profile/projection';
import type { ProfileRecord } from '@solidarity/shared';
import type { PublicPageShareSource } from './meProfileModel';

import { displayProfileShareUrl } from './meProfileModel';
import { useProfileShareSelection } from './useProfileShareSelection';
import { PageSectionLabel } from './PageSectionLabel';
import { ProfileBadgeChips } from './ProfileBadgeChips';
import { ProfileHero } from './ProfileHero';
import { ProfileLinksList } from './ProfileLinksList';
import { ProfileSectionsList } from './ProfileSectionsList';
import { EditOnWebCard } from './EditOnWebCard';
import { PageAppearanceSheet } from './PageAppearanceSheet';
import { PageLapsedCheckAlert } from './PageLapsedCheckAlert';

const ENTRANCE_DURATION_MS = 240;

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
  const [appearanceOpen, setAppearanceOpen] = useState(false);
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
  const entrance = (delay: number) => FadeInDown.duration(ENTRANCE_DURATION_MS).delay(delay);

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

      <Animated.View entering={entrance(STAGGER_MS)}>
        <ProfileLinksList
          links={record.links}
          linkVisibility={linkVisibility}
          onEdit={onEdit}
          onAddFirstLink={onAddLink}
          onImportLinks={onImportLinks}
        />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 2)}>
        <ProfileSectionsList
          linkCount={record.links.length}
          previewRecord={publicRecord}
          previewHandle={pageHandle}
        />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 3)}>
        <EditOnWebCard
          url={shareSelection.kind === 'ready' ? shareSelection.selected.url : null}
        />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 4)}>
        <View className="px-4 pb-3">
          <PageSectionLabel title={t('mePage.attestations')} />
        </View>
        <ProfileBadgeChips
          record={record}
          publicRecord={publicRecord}
          jws={jws}
          nostrUploaded={nostrShortUrlReady}
          onManageBindings={onOpenBindings}
        />
      </Animated.View>

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
