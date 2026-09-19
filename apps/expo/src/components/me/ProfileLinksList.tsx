/**
 * Page field rows. Each real link keeps its visibility tier, can be reordered
 * directly from a 44pt drag handle, and earns a status pill only from matching
 * completed verification evidence.
 */
import { useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Linking, View } from 'react-native';

import {
  getBadgeStatusCacheRevision,
  readCachedAtprotoResult,
  readCachedNostrResult,
  shouldReverifyBadge,
  subscribeBadgeStatusCache,
} from '@/badges/badgeStatusCache';
import { PressableScale } from '@/components/common/PressableScale';
import { BrandIcon } from '@/components/icons/BrandIcon';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { appAlert } from '@/feedback/appAlert';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { verifyHttpsOwnership, type HttpsOwnershipEvidence } from '@/profile/httpsOwnership';
import { brandIconForLink } from '@/profile/linkPresentation';
import { visibilityAt, type LinkVisibility } from '@/profile/projection';
import { useProfileStore } from '@/profile/store';
import {
  normalizeAtprotoHandle,
  type ProfileLink,
  type ProfileRecord,
} from '@solidarity/shared';

import { PageEmptyState } from './PageEmptyState';
import { PageSectionLabel } from './PageSectionLabel';
import {
  FIELD_ROW_HEIGHT,
  FIELD_ROW_STRIDE,
  ICON_TILE_GLYPH,
  ROW_GAP,
  fieldRowStyle,
  iconTileStyle,
  isNostrProfileUrlForNpub,
  recordClaimsAtprotoHandle,
  reorderByIndex,
  verificationPillForStates,
  type RowVerificationPill,
} from './pageRowStyles';
import { pageLinkSections, type PageLinkEntry } from './pageLinkSections';
import { buildProfileShareModel } from './meProfileModel';
import {
  DraggableRow,
  RowDragHandle,
  resetRowDrag,
  useRowDragController,
} from './rowDrag';

export interface ProfileLinksListProps {
  readonly links: readonly ProfileLink[];
  readonly linkVisibility: readonly LinkVisibility[];
  readonly onEdit: () => void;
  readonly onAddFirstLink: () => void;
  readonly onImportLinks?: () => void;
}

export function ProfileLinksList({
  links,
  linkVisibility,
  onEdit,
  onAddFirstLink,
  onImportLinks,
}: ProfileLinksListProps): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const record = useProfileStore((state) => state.record);
  const jws = useProfileStore((state) => state.jws);
  const saveProfile = useProfileStore((state) => state.saveProfile);
  const [orderedLinks, setOrderedLinks] = useState(links);
  const [orderedVisibility, setOrderedVisibility] = useState(linkVisibility);
  const [reordering, setReordering] = useState(false);
  const websiteEvidence = useWebsiteLinkEvidence(record, jws);
  useSyncExternalStore(
    subscribeBadgeStatusCache,
    getBadgeStatusCacheRevision,
    getBadgeStatusCacheRevision,
  );

  useEffect(() => {
    setOrderedLinks(links);
    setOrderedVisibility(linkVisibility);
  }, [linkVisibility, links]);

  const sections = reordering
    ? pageLinkSections(orderedLinks, orderedVisibility)
    : pageLinkSections(links, linkVisibility);

  const openLink = (link: ProfileLink): void => {
    void Linking.openURL(link.url).catch(() => {
      appAlert({ title: t('mePage.linkErrorTitle'), message: t('mePage.linkErrorMessage') });
    });
  };

  const persistReorder = useCallback((sourceIndex: number, destinationIndex: number): void => {
    if (reordering || sourceIndex === destinationIndex || record === null) return;
    const pairs = orderedLinks.map((link, index) => ({
      link,
      visibility: visibilityAt(orderedVisibility, index),
    }));
    const reordered = reorderByIndex(pairs, sourceIndex, destinationIndex);
    if (reordered === pairs) return;
    const nextLinks = reordered.map((entry) => entry.link);
    const nextVisibility = reordered.map((entry) => entry.visibility);
    setOrderedLinks(nextLinks);
    setOrderedVisibility(nextVisibility);
    setReordering(true);
    void saveProfile({
      displayName: record.displayName,
      bio: record.bio,
      links: nextLinks,
      linkVisibility: nextVisibility,
    })
      .then((result) => {
        if (result.ok) return;
        setOrderedLinks(links);
        setOrderedVisibility(linkVisibility);
        pushToast(t('mePage.reorderError'), 'error');
      })
      .catch(() => {
        setOrderedLinks(links);
        setOrderedVisibility(linkVisibility);
        pushToast(t('mePage.reorderError'), 'error');
      })
      .finally(() => {
        setReordering(false);
      });
  }, [linkVisibility, links, orderedLinks, orderedVisibility, record, reordering, saveProfile, t]);

  const pillFor = (link: ProfileLink): RowVerificationPill | null =>
    record === null ? null : linkVerificationPill(link, websiteEvidence, record);

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
      <LinkRowsSection
        title={t('mePage.publicPage')}
        entries={sections.publicLinks}
        disabled={reordering}
        pillFor={pillFor}
        onEdit={onEdit}
        onOpenLink={openLink}
        onReorder={persistReorder}
      />
      <LinkRowsSection
        title={t('mePage.cardOnly')}
        entries={sections.cardOnlyLinks}
        disabled={reordering}
        pillFor={pillFor}
        onEdit={onEdit}
        onOpenLink={openLink}
        onReorder={persistReorder}
      />
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

/** One contiguous reorderable run of link rows. Each section owns its drag
 * controller — section indices restart at 0, so sharing one across sections
 * would alias rows between them. */
function LinkRowsSection({
  title,
  entries,
  disabled,
  pillFor,
  onEdit,
  onOpenLink,
  onReorder,
}: {
  readonly title: string;
  readonly entries: readonly PageLinkEntry[];
  readonly disabled: boolean;
  readonly pillFor: (link: ProfileLink) => RowVerificationPill | null;
  readonly onEdit: () => void;
  readonly onOpenLink: (link: ProfileLink) => void;
  readonly onReorder: (sourceIndex: number, destinationIndex: number) => void;
}): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const drag = useRowDragController();
  if (entries.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <PageSectionLabel title={title} />
      <View style={{ gap: ROW_GAP }}>
        {entries.map(({ link, sourceIndex }, sectionIndex) => {
          const status = pillFor(link);
          return (
            <DraggableRow
              key={`${String(sourceIndex)}-${link.label}-${link.url}`}
              controller={drag}
              index={sectionIndex}
              stride={FIELD_ROW_STRIDE}
              style={{
                ...fieldRowStyle(c.mutedSurface),
                gap: 0,
                paddingVertical: 0,
                paddingHorizontal: 0,
              }}>
              <RowDragHandle
                controller={drag}
                label={t('mePage.reorderLink', { label: link.label || link.url })}
                index={sectionIndex}
                itemCount={entries.length}
                stride={FIELD_ROW_STRIDE}
                height={FIELD_ROW_HEIGHT}
                disabled={disabled}
                onMove={(destination) => {
                  const target = entries[destination];
                  if (target) onReorder(sourceIndex, target.sourceIndex);
                  // Same-task reset: the committed order and the identity
                  // transforms must reach the UI on the same frame.
                  resetRowDrag(drag);
                }}
              />
              <PressableScale
                fill
                haptic="tap"
                onPress={onEdit}
                onLongPress={() => { onOpenLink(link); }}
                accessibilityRole="button"
                accessibilityLabel={link.label.length > 0 ? link.label : link.url}
                accessibilityHint={t('mePage.editLinkHint')}
                style={{
                  minHeight: FIELD_ROW_HEIGHT,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingVertical: 8,
                  paddingRight: 12,
                }}>
                <View style={iconTileStyle(c.chipSurface)}>
                  <BrandIcon
                    name={brandIconForLink(link.label, link.url)}
                    size={ICON_TILE_GLYPH}
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
                {status ? <VerificationPill status={status} /> : null}
                <SfIcon name="chevron.right" size={13} color={Colors.text3} />
              </PressableScale>
            </DraggableRow>
          );
        })}
      </View>
    </View>
  );
}

function useWebsiteLinkEvidence(
  record: ProfileRecord | null,
  jws: string | null,
): readonly HttpsOwnershipEvidence[] {
  const [evidence, setEvidence] = useState<readonly HttpsOwnershipEvidence[]>([]);
  const shareModel = useMemo(
    () => record && jws ? buildProfileShareModel(record, jws) : null,
    [jws, record],
  );

  useFocusEffect(useCallback(() => {
    let active = true;
    if (record === null || shareModel === null || record.links.length === 0) {
      setEvidence([]);
      return () => { active = false; };
    }
    const profileUrls = [shareModel.offlineUrl, shareModel.shortUrl].filter(
      (url): url is string => url !== null,
    );
    void verifyHttpsOwnership({
      did: record.did,
      links: record.links.map((link) => link.url),
      profileUrls,
    }).then((next) => {
      if (active) setEvidence(next);
    });
    return () => { active = false; };
  }, [record, shareModel]));

  return evidence;
}

/**
 * The pill a field row may show. `null` — say nothing — is the honest default.
 *
 * A pill is drawn only when a cached check ① is still fresh for THIS revision
 * of the record, ② describes an identity the record STILL claims, and ③ maps
 * to a URL that actually identifies that identity. A superseded, expired, or
 * merely coincidental match renders nothing rather than a plausible-looking
 * verdict (Rule 8): the pill is the page's whole trust claim, so it must never
 * outlive the evidence behind it.
 */
function linkVerificationPill(
  link: ProfileLink,
  websiteEvidence: readonly HttpsOwnershipEvidence[],
  record: ProfileRecord,
  nowMs: number = Date.now(),
): RowVerificationPill | null {
  const states: string[] = [];
  const atprotoEntry = readCachedAtprotoResult();
  const nostrEntry = readCachedNostrResult();
  const atproto = atprotoEntry !== null &&
    !shouldReverifyBadge(atprotoEntry.checkedAt, record.updatedAt, nowMs)
    ? atprotoEntry.result
    : undefined;
  const nostr = nostrEntry !== null &&
    !shouldReverifyBadge(nostrEntry.checkedAt, record.updatedAt, nowMs)
    ? nostrEntry.result
    : undefined;
  try {
    const url = new URL(link.url);
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, '');
    const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const atprotoHandle = atproto?.evidence.handleClaim;
    if (
      hostname === 'bsky.app' &&
      path[0] === 'profile' &&
      path[1] !== undefined &&
      atproto !== undefined &&
      atprotoHandle !== null &&
      atprotoHandle !== undefined &&
      normalizeAtprotoHandle(path[1]) === normalizeAtprotoHandle(atprotoHandle) &&
      recordClaimsAtprotoHandle(record.alsoKnownAs, atprotoHandle)
    ) {
      states.push(atproto.state);
    }
    const npub = nostr?.npub ?? null;
    if (
      nostr !== undefined &&
      npub !== null &&
      record.alsoKnownAs.includes(`nostr:${npub}`) &&
      isNostrProfileUrlForNpub(url, hostname, path, npub)
    ) {
      states.push(nostr.state);
    }
    if (websiteEvidence.some((item) => item.origin === url.origin)) {
      states.push('verified');
    }
  } catch {
    return null;
  }
  return verificationPillForStates(states);
}

function VerificationPill({ status }: { readonly status: RowVerificationPill }): ReactNode {
  const { t } = useTranslation();
  const verified = status === 'verified';
  const color = verified ? Colors.terminalGreen : Colors.warning;
  return (
    <ThemedSurface
      variant="inset"
      className="flex-row items-center gap-1 px-2 py-1"
      style={{ borderWidth: 1, borderColor: color }}>
      <SfIcon name={verified ? 'checkmark.seal.fill' : 'clock'} size={12} color={color} />
      <ThemedText variant="caption" numberOfLines={1} style={{ color }}>
        {t(verified ? 'mePage.verified' : 'mePage.needsRecheck')}
      </ThemedText>
    </ThemedSurface>
  );
}

function AddLinkButton({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}): ReactNode {
  return <ThemedButton label={label} fullWidth onPress={onPress} />;
}
