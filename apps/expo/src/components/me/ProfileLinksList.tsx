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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import {
  getBadgeStatusCacheRevision,
  readCachedAtprotoResult,
  readCachedNostrResult,
  subscribeBadgeStatusCache,
} from '@/badges/badgeStatusCache';
import { PressableScale } from '@/components/common/PressableScale';
import { BrandIcon } from '@/components/icons/BrandIcon';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { appAlert } from '@/feedback/appAlert';
import { SPRING } from '@/feedback/motion';
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
  ROW_GAP,
  dragDestinationIndex,
  fieldRowStyle,
  iconTileStyle,
  reorderByIndex,
  verificationPillForStates,
  type RowVerificationPill,
} from './pageRowStyles';
import { pageLinkSections, type PageLinkEntry } from './pageLinkSections';
import { buildProfileShareModel } from './meProfileModel';

const FIELD_ROW_STRIDE = 64 + ROW_GAP;

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

  const renderLinkRows = (entries: readonly PageLinkEntry[]): ReactNode => {
    if (entries.length === 0) return null;
    return (
      <View style={{ gap: ROW_GAP }}>
        {entries.map(({ link, sourceIndex }, sectionIndex) => {
          const status = linkVerificationPill(link, websiteEvidence);
          return (
            <View
              key={`${String(sourceIndex)}-${link.label}-${link.url}`}
              style={{ ...fieldRowStyle(c.mutedSurface), gap: 0, padding: 0 }}>
              <ReorderHandle
                label={t('mePage.reorderLink', { label: link.label || link.url })}
                index={sectionIndex}
                itemCount={entries.length}
                disabled={reordering}
                onMove={(destination) => {
                  const target = entries[destination];
                  if (target) persistReorder(sourceIndex, target.sourceIndex);
                }}
              />
              <PressableScale
                fill
                haptic="tap"
                onPress={onEdit}
                onLongPress={() => { openLink(link); }}
                accessibilityRole="button"
                accessibilityLabel={link.label.length > 0 ? link.label : link.url}
                accessibilityHint={t('mePage.editLinkHint')}
                style={{
                  minHeight: 64,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  paddingRight: 16,
                }}>
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
                {status ? <VerificationPill status={status} /> : null}
                <SfIcon name="chevron.right" size={13} color={Colors.text3} />
              </PressableScale>
            </View>
          );
        })}
      </View>
    );
  };

  const renderSection = (title: string, entries: readonly PageLinkEntry[]): ReactNode => {
    if (entries.length === 0) return null;
    return (
      <View style={{ gap: 8 }}>
        <PageSectionLabel title={title} />
        {renderLinkRows(entries)}
      </View>
    );
  };

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

function linkVerificationPill(
  link: ProfileLink,
  websiteEvidence: readonly HttpsOwnershipEvidence[],
): RowVerificationPill | null {
  const states: string[] = [];
  const atproto = readCachedAtprotoResult()?.result;
  const nostr = readCachedNostrResult()?.result;
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
      normalizeAtprotoHandle(path[1]) === normalizeAtprotoHandle(atprotoHandle)
    ) {
      states.push(atproto.state);
    }
    if (
      nostr?.npub &&
      path.some((segment) => segment === nostr.npub)
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

function ReorderHandle({
  label,
  index,
  itemCount,
  disabled,
  onMove,
}: {
  readonly label: string;
  readonly index: number;
  readonly itemCount: number;
  readonly disabled: boolean;
  readonly onMove: (destination: number) => void;
}): ReactNode {
  const translationY = useSharedValue(0);
  const lift = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    zIndex: lift.value > 1 ? 2 : 0,
    transform: [
      { translateY: translationY.value },
      { scale: lift.value },
    ],
  }));
  const pan = useMemo(
    () => Gesture.Pan()
      .enabled(!disabled)
      .activateAfterLongPress(120)
      .onStart(() => {
        lift.value = withSpring(1.05, SPRING.zoom);
      })
      .onUpdate((event) => {
        translationY.value = event.translationY;
      })
      .onEnd((event) => {
        const destination = dragDestinationIndex(
          index,
          event.translationY,
          itemCount,
          FIELD_ROW_STRIDE,
        );
        if (destination !== index) scheduleOnRN(onMove, destination);
      })
      .onFinalize(() => {
        translationY.value = withSpring(0, SPRING.gentle);
        lift.value = withSpring(1, SPRING.press);
      }),
    [disabled, index, itemCount, lift, onMove, translationY],
  );

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityActions={[
          { name: 'decrement', label },
          { name: 'increment', label },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement' && index > 0) onMove(index - 1);
          if (event.nativeEvent.actionName === 'increment' && index < itemCount - 1) onMove(index + 1);
        }}
        style={[
          {
            width: 44,
            height: 64,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.4 : 1,
          },
          animatedStyle,
        ]}>
        <GripIcon color={Colors.text3} />
      </Animated.View>
    </GestureDetector>
  );
}

function GripIcon({ color }: { readonly color: string }): ReactNode {
  return (
    <Svg width={18} height={24} viewBox="0 0 18 24" fill="none">
      {[6, 12, 18].flatMap((cy) => [6, 12].map((cx) => (
        <Circle key={`${String(cx)}-${String(cy)}`} cx={cx} cy={cy} r={1.4} fill={color} />
      )))}
    </Svg>
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
