import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed';
import { STAGGER_MS } from '@/feedback/motion';
import { useTranslation } from '@/i18n';
import { usePageDesignStore } from '@/page/pageDesignStore';
import type { LinkVisibility } from '@/profile/projection';
import type { ProfileRecord } from '@solidarity/shared';
import type { PublicPageShareSource } from './meProfileModel';

import { ProfileBadgeChips } from './ProfileBadgeChips';
import { ProfileHero } from './ProfileHero';
import { ProfileLinksList } from './ProfileLinksList';
import { ProfileSectionsList } from './ProfileSectionsList';
import { PageAppearanceSheet } from './PageAppearanceSheet';
import { PageLapsedCheckAlert } from './PageLapsedCheckAlert';
import { PageLivePreview } from './PageLivePreview';

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
  onOpenSettings,
  onOpenBindings,
}: MeProfilePageProps): ReactNode {
  const { t } = useTranslation();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const pageDesignStatus = usePageDesignStore((state) => state.status);
  const pageDesign = usePageDesignStore((state) => state.design);
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
          onOpenAppearance={() => { setAppearanceOpen(true); }}
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
        />
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 2)}>
        <ProfileSectionsList linkCount={record.links.length} />
        {pageDesignStatus === 'ready' ? (
          <View className="mt-5 gap-3 px-4">
            <ThemedText accessibilityRole="header" variant="label" tone="tertiary">
              {t('pageDesign.preview')}
            </ThemedText>
            <PageLivePreview
              record={publicRecord}
              blocks={pageDesign.blocks}
              appearance={pageDesign.appearance}
            />
          </View>
        ) : null}
      </Animated.View>

      <Animated.View entering={entrance(STAGGER_MS * 3)}>
        <ThemedText
          accessibilityRole="header"
          variant="label"
          tone="tertiary"
          className="px-4 pb-3">
          {t('mePage.attestations')}
        </ThemedText>
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
        onClose={() => { setAppearanceOpen(false); }}
      />
    </ScrollView>
  );
}
