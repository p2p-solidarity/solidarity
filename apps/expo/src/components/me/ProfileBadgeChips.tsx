import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';

import {
  atprotoBadgeViewModel,
  type AtprotoBadgeViewModel,
  type AtprotoBadgeVisual,
} from '@/badges/atprotoBadgeDisplay';
import {
  nostrBadgeViewModel,
  truncateNpub,
  type NostrBadgeViewModel,
  type NostrBadgeVisual,
} from '@/badges/nostrBadgeDisplay';
import { atprotoBindingIO } from '@/atproto/bindingIo';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { makeKind0Fetcher } from '@/nostr/fetchKind0';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import {
  verifyAtprotoBinding,
  verifyNostrBinding,
  type ProfileRecord,
  type VerifyAtprotoBindingResult,
  type VerifyNostrBindingResult,
} from '@solidarity/shared';

const BADGE_CROSSFADE_MS = 200;

type BadgeVisual = AtprotoBadgeVisual | NostrBadgeVisual;
type TFn = ReturnType<typeof useTranslation>['t'];

export interface ProfileBadgeChipsProps {
  readonly record: ProfileRecord;
  readonly onManageBindings: () => void;
}

export function ProfileBadgeChips({ record, onManageBindings }: ProfileBadgeChipsProps): ReactNode {
  const { t } = useTranslation();
  const npubClaim = useMemo(
    () =>
      record.alsoKnownAs.find((value) => value.startsWith('nostr:npub'))?.slice('nostr:'.length) ??
      null,
    [record.alsoKnownAs]
  );
  const handleClaim = useMemo(
    () =>
      record.alsoKnownAs.find((value) => value.startsWith('at://'))?.slice('at://'.length) ?? null,
    [record.alsoKnownAs]
  );

  const [nostrResult, setNostrResult] = useState<VerifyNostrBindingResult | null>(null);
  const [atprotoResult, setAtprotoResult] = useState<VerifyAtprotoBindingResult | null>(null);
  const [nostrChecking, setNostrChecking] = useState(npubClaim !== null);
  const [atprotoChecking, setAtprotoChecking] = useState(handleClaim !== null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      if (npubClaim !== null) {
        setNostrChecking(true);
        void verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS)).then((next) => {
          if (cancelled) return;
          setNostrResult(next);
          setNostrChecking(false);
        });
      }

      if (handleClaim !== null) {
        setAtprotoChecking(true);
        void verifyAtprotoBinding(record, atprotoBindingIO).then((next) => {
          if (cancelled) return;
          setAtprotoResult(next);
          setAtprotoChecking(false);
        });
      }

      return () => {
        cancelled = true;
      };
    }, [handleClaim, npubClaim, record.updatedAt])
  );

  const matchingNostrResult = nostrResult?.npub === npubClaim ? nostrResult : null;
  const matchingAtprotoResult =
    atprotoResult?.evidence.handleClaim === handleClaim ? atprotoResult : null;
  const nostr = npubClaim
    ? nostrBadgeViewModel(matchingNostrResult, nostrChecking || matchingNostrResult === null)
    : nostrBadgeViewModel(null, false);
  const bluesky = handleClaim
    ? atprotoBadgeViewModel(
        matchingAtprotoResult,
        atprotoChecking || matchingAtprotoResult === null
      )
    : atprotoBadgeViewModel(null, false);
  const hasBadge = nostr.visual !== 'hidden' || bluesky.visual !== 'hidden';

  if (!hasBadge) {
    return (
      <View className="px-4">
        <PressableScale
          haptic="tap"
          onPress={onManageBindings}
          accessibilityRole="button"
          accessibilityLabel={t('mePage.bindFirstBadge')}
          containerStyle={{ alignSelf: 'flex-start' }}>
          <ThemedSurface
            variant="inset"
            className="flex-row items-center gap-2 rounded-none px-3 py-2">
            <SfIcon name="plus" size={12} color={Colors.text3} />
            <ThemedText variant="label" tone="tertiary">
              {t('mePage.bindFirstBadge')}
            </ThemedText>
          </ThemedSurface>
        </PressableScale>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
      {nostr.visual !== 'hidden' ? (
        <BadgeChip
          visual={nostr.visual}
          label={badgeLabel('nostr', nostr.visual, t)}
          onPress={
            nostr.visual === 'loading'
              ? undefined
              : () => {
                  appAlert({
                    title: t('badges.nostr.evidenceTitle'),
                    message: nostrEvidenceMessage(nostr, t),
                  });
                }
          }
        />
      ) : null}
      {bluesky.visual !== 'hidden' ? (
        <BadgeChip
          visual={bluesky.visual}
          label={badgeLabel('bluesky', bluesky.visual, t)}
          onPress={
            bluesky.visual === 'loading'
              ? undefined
              : () => {
                  appAlert({
                    title: t('badges.atproto.evidenceTitle'),
                    message: atprotoEvidenceMessage(bluesky, t),
                  });
                }
          }
        />
      ) : null}
    </ScrollView>
  );
}

function BadgeChip({
  visual,
  label,
  onPress,
}: {
  readonly visual: Exclude<BadgeVisual, 'hidden'>;
  readonly label: string;
  readonly onPress?: () => void;
}): ReactNode {
  const content = (
    <ThemedSurface
      variant="inset"
      className="rounded-none px-3 py-2"
      style={{ borderWidth: 1, borderColor: Colors.divider }}>
      <Animated.View
        key={visual}
        entering={FadeIn.duration(BADGE_CROSSFADE_MS).easing(Easing.out(Easing.quad))}
        exiting={FadeOut.duration(BADGE_CROSSFADE_MS).easing(Easing.out(Easing.quad))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {visual === 'loading' ? (
          <ActivityIndicator size="small" color={Colors.text3} />
        ) : (
          <SfIcon
            name={badgeVisualStyle(visual).icon}
            size={14}
            color={badgeVisualStyle(visual).color}
          />
        )}
        <ThemedText
          variant="label"
          tone={visual === 'loading' ? 'tertiary' : 'primary'}
          style={visual === 'loading' ? undefined : { color: badgeVisualStyle(visual).color }}>
          {label}
        </ThemedText>
      </Animated.View>
    </ThemedSurface>
  );

  if (!onPress) return content;
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {content}
    </PressableScale>
  );
}

function badgeVisualStyle(visual: Exclude<BadgeVisual, 'hidden' | 'loading'>): {
  readonly icon: 'checkmark.seal.fill' | 'checkmark.seal' | 'exclamationmark.triangle';
  readonly color: string;
} {
  switch (visual) {
    case 'verified':
      return { icon: 'checkmark.seal.fill', color: Colors.terminalGreen };
    case 'stale':
      return { icon: 'exclamationmark.triangle', color: Colors.text3 };
    case 'declared':
      return { icon: 'checkmark.seal', color: Colors.warning };
  }
}

function badgeLabel(
  platform: 'nostr' | 'bluesky',
  visual: Exclude<BadgeVisual, 'hidden'>,
  t: TFn
): string {
  if (visual === 'loading')
    return t(`badges.${platform === 'nostr' ? 'nostr' : 'atproto'}.checking`);
  const suffix =
    visual === 'verified' ? 'verifiedLabel' : visual === 'stale' ? 'staleLabel' : 'declaredLabel';
  return t(`badges.${platform === 'nostr' ? 'nostr' : 'atproto'}.${suffix}`);
}

function nostrEvidenceMessage(vm: NostrBadgeViewModel, t: TFn): string {
  const lines = [
    t(
      vm.visual === 'verified'
        ? 'badges.nostr.evidence.verified'
        : vm.visual === 'stale'
          ? 'badges.nostr.evidence.stale'
          : 'badges.nostr.evidence.declared'
    ),
  ];

  if (vm.npub) lines.push(t('badges.nostr.evidence.npubLine', { npub: truncateNpub(vm.npub) }));
  lines.push(
    vm.direction1
      ? t('badges.nostr.evidence.direction1Held')
      : t('badges.nostr.evidence.direction1Missing')
  );
  lines.push(
    vm.direction2 === true
      ? t('badges.nostr.evidence.direction2Held')
      : vm.direction2 === false
        ? t('badges.nostr.evidence.direction2Missing')
        : t('badges.nostr.evidence.direction2Unknown')
  );
  if (vm.kind0CreatedAt !== null) {
    lines.push(
      t('badges.nostr.evidence.lastUpdatedLine', {
        date: new Date(vm.kind0CreatedAt * 1000).toLocaleString(),
      })
    );
  }
  return lines.join('\n');
}

function atprotoEvidenceMessage(vm: AtprotoBadgeViewModel, t: TFn): string {
  const lines = [
    t(
      vm.visual === 'verified'
        ? 'badges.atproto.evidence.verified'
        : vm.visual === 'stale'
          ? 'badges.atproto.evidence.stale'
          : 'badges.atproto.evidence.declared'
    ),
  ];
  if (vm.handle) lines.push(t('badges.atproto.evidence.handleLine', { handle: vm.handle }));
  if (vm.repoDid) lines.push(t('badges.atproto.evidence.repoLine', { did: vm.repoDid }));
  lines.push(
    vm.direction1
      ? t('badges.atproto.evidence.direction1Held')
      : t('badges.atproto.evidence.direction1Missing')
  );
  lines.push(
    vm.direction2 === true
      ? t('badges.atproto.evidence.direction2Held')
      : vm.direction2 === false
        ? t('badges.atproto.evidence.direction2Missing')
        : t('badges.atproto.evidence.direction2Unknown')
  );
  return lines.join('\n');
}
