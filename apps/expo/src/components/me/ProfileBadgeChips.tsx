import type { SFSymbol } from 'expo-symbols';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import {
  readCachedAtprotoResult,
  readCachedNostrResult,
  shouldReverifyBadge,
  writeCachedAtprotoResult,
  writeCachedNostrResult,
} from '@/badges/badgeStatusCache';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import type { CredentialManifestEntry } from '@/credentials/credentialManifest';
import { useCredentialStore, type StoredCredential, type TrustLevel } from '@/credentials/store';
import {
  credentialTrustDisplayFor,
  credentialTrustSimpleI18nKeyForLevel,
  credentialTrustToneForLevel,
  type TrustDisplayTone,
} from '@/credentials/trustDisplay';
import { appAlert } from '@/feedback/appAlert';
import { useTranslation } from '@/i18n';
import { makeKind0Fetcher } from '@/nostr/fetchKind0';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { verifyHttpsOwnership, type HttpsOwnershipEvidence } from '@/profile/httpsOwnership';
import {
  verifyAtprotoBinding,
  verifyNostrBinding,
  type ProfileRecord,
  type VerifyAtprotoBindingResult,
  type VerifyNostrBindingResult,
} from '@solidarity/shared';
import { buildProfileShareModel } from './meProfileModel';

const BADGE_CROSSFADE_MS = 200;

type BadgeVisual = AtprotoBadgeVisual | NostrBadgeVisual;
type TFn = ReturnType<typeof useTranslation>['t'];

export interface ProfileBadgeChipsProps {
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly onManageBindings: () => void;
}

export function ProfileBadgeChips({ record, jws, onManageBindings }: ProfileBadgeChipsProps): ReactNode {
  const { t } = useTranslation();
  const manifest = useCredentialStore((state) => state.manifest);
  const credentialDetails = useCredentialStore((state) => state.details);
  const loadCredentialDetail = useCredentialStore((state) => state.loadDetail);
  const passport = useMemo(
    () => strongestPassportCredential(manifest, credentialDetails),
    [credentialDetails, manifest],
  );
  useEffect(() => {
    for (const credential of manifest) {
      if (credential.type.toLowerCase() === 'passport' && !credentialDetails.has(credential.id)) {
        void loadCredentialDetail(credential.id);
      }
    }
  }, [credentialDetails, loadCredentialDetail, manifest]);
  const shareModel = useMemo(() => buildProfileShareModel(record, jws), [jws, record]);
  const website = useWebsiteOwnership(record, shareModel);
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
  const { nostr, bluesky } = useBindingBadgeViewModels(record, npubClaim, handleClaim);
  const websiteVisual = website.checking
    ? 'loading'
    : website.evidence && website.evidence.length > 0
      ? 'verified'
      : 'hidden';
  const hasBadge =
    nostr.visual !== 'hidden' ||
    bluesky.visual !== 'hidden' ||
    websiteVisual !== 'hidden' ||
    passport !== null;

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
                    message: nostrEvidenceMessage(nostr, t, readCachedNostrResult()?.checkedAt ?? null),
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
                    message: atprotoEvidenceMessage(bluesky, t, readCachedAtprotoResult()?.checkedAt ?? null),
                  });
                }
          }
        />
      ) : null}
      {websiteVisual !== 'hidden' ? (
        <BadgeChip
          visual={websiteVisual}
          label={t(
            websiteVisual === 'loading'
              ? 'badges.website.checking'
              : 'badges.website.verifiedLabel',
          )}
          onPress={
            websiteVisual === 'loading'
              ? undefined
              : () => {
                  appAlert({
                    title: t('badges.website.evidenceTitle'),
                    message: websiteEvidenceMessage(website.evidence ?? [], t),
                  });
                }
          }
        />
      ) : null}
      {passport ? (
        <BadgeChip
          visual={passport.displayLevel === 'L1' ? 'declared' : 'verified'}
          label={`${t('badges.passport.title')} · ${t(
            credentialTrustSimpleI18nKeyForLevel(passport.displayLevel),
          )}`}
          accent={{
            icon: 'wallet.pass',
            color: trustToneColor(credentialTrustToneForLevel(passport.displayLevel)),
          }}
          onPress={() => {
            router.push({ pathname: '/credentials/[id]', params: { id: passport.id } });
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function useBindingBadgeViewModels(
  record: ProfileRecord,
  npubClaim: string | null,
  handleClaim: string | null,
): { readonly nostr: NostrBadgeViewModel; readonly bluesky: AtprotoBadgeViewModel } {
  // Seed from the persisted last-completed check so a revisit paints the
  // previous known state on frame one, and TRUST it while it is fresh
  // (badgeStatusCache doc): a live re-verify runs only when
  // shouldReverifyBadge says so — no cache, TTL expired, or the record was
  // re-signed after the check. The claim-match guards below drop a cached
  // result whose npub/handle no longer matches the record (and force a
  // re-verify via the same guard in the focus effect).
  const [nostrResult, setNostrResult] = useState<VerifyNostrBindingResult | null>(
    () => readCachedNostrResult()?.result ?? null
  );
  const [atprotoResult, setAtprotoResult] = useState<VerifyAtprotoBindingResult | null>(
    () => readCachedAtprotoResult()?.result ?? null
  );
  const [nostrChecking, setNostrChecking] = useState(false);
  const [atprotoChecking, setAtprotoChecking] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (npubClaim !== null) {
        const cached = readCachedNostrResult();
        const cacheStandsIn =
          cached !== null &&
          cached.result.npub === npubClaim &&
          !shouldReverifyBadge(cached.checkedAt, record.updatedAt, Date.now());
        if (cacheStandsIn) {
          setNostrResult(cached.result);
        } else {
          setNostrChecking(true);
          void verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS)).then((next) => {
            if (cancelled) return;
            setNostrResult(next);
            setNostrChecking(false);
            writeCachedNostrResult(next, Date.now());
          });
        }
      }
      if (handleClaim !== null) {
        const cached = readCachedAtprotoResult();
        const cacheStandsIn =
          cached !== null &&
          cached.result.evidence.handleClaim === handleClaim &&
          !shouldReverifyBadge(cached.checkedAt, record.updatedAt, Date.now());
        if (cacheStandsIn) {
          setAtprotoResult(cached.result);
        } else {
          setAtprotoChecking(true);
          void verifyAtprotoBinding(record, atprotoBindingIO).then((next) => {
            if (cancelled) return;
            setAtprotoResult(next);
            setAtprotoChecking(false);
            writeCachedAtprotoResult(next, Date.now());
          });
        }
      }
      return () => {
        cancelled = true;
      };
    }, [handleClaim, npubClaim, record, record.updatedAt]),
  );

  const matchingNostrResult = nostrResult?.npub === npubClaim ? nostrResult : null;
  const matchingAtprotoResult =
    atprotoResult?.evidence.handleClaim === handleClaim ? atprotoResult : null;
  return {
    nostr: npubClaim
      ? nostrBadgeViewModel(matchingNostrResult, nostrChecking || matchingNostrResult === null)
      : nostrBadgeViewModel(null, false),
    bluesky: handleClaim
      ? atprotoBadgeViewModel(
          matchingAtprotoResult,
          atprotoChecking || matchingAtprotoResult === null,
        )
      : atprotoBadgeViewModel(null, false),
  };
}

function useWebsiteOwnership(
  record: ProfileRecord,
  shareModel: ReturnType<typeof buildProfileShareModel>,
): {
  readonly evidence: readonly HttpsOwnershipEvidence[] | null;
  readonly checking: boolean;
} {
  const [evidence, setEvidence] = useState<readonly HttpsOwnershipEvidence[] | null>(null);
  const [checking, setChecking] = useState(record.links.length > 0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const controller = new AbortController();
      if (record.links.length === 0) {
        setEvidence([]);
        setChecking(false);
        return () => {
          cancelled = true;
        };
      }

      setChecking(true);
      setEvidence(null);
      const profileUrls = [shareModel.offlineUrl, shareModel.shortUrl].filter(
        (url): url is string => url !== null,
      );
      void verifyHttpsOwnership({
        did: record.did,
        links: record.links.map((link) => link.url),
        profileUrls,
        signal: controller.signal,
      }).then((next) => {
        if (cancelled) return;
        setEvidence(next);
        setChecking(false);
      });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }, [record.did, record.links, record.updatedAt, shareModel.offlineUrl, shareModel.shortUrl]),
  );

  return { evidence, checking };
}

function BadgeChip({
  visual,
  label,
  accent,
  onPress,
}: {
  readonly visual: Exclude<BadgeVisual, 'hidden'>;
  readonly label: string;
  readonly accent?: { readonly icon: SFSymbol; readonly color: string };
  readonly onPress?: () => void;
}): ReactNode {
  const style = visual === 'loading' ? null : (accent ?? badgeVisualStyle(visual));
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
        {style ? (
          <SfIcon name={style.icon} size={14} color={style.color} />
        ) : (
          <ActivityIndicator size="small" color={Colors.text3} />
        )}
        <ThemedText
          variant="label"
          tone={visual === 'loading' ? 'tertiary' : 'primary'}
          style={style ? { color: style.color } : undefined}>
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

interface PassportBadgeModel extends CredentialManifestEntry {
  readonly displayLevel: TrustLevel;
}

function strongestPassportCredential(
  manifest: readonly CredentialManifestEntry[],
  details: ReadonlyMap<string, StoredCredential>,
): PassportBadgeModel | null {
  const rank: Readonly<Record<TrustLevel, number>> = { L1: 1, L2: 2, L3: 3, 'L3+': 4 };
  return (
    manifest
      .filter((credential) => credential.type.toLowerCase() === 'passport')
      .map((credential) => {
        const detail = details.get(credential.id);
        const displayLevel: TrustLevel = detail
          ? credentialTrustDisplayFor(detail).level
          : 'L1';
        return {
          ...credential,
          displayLevel,
        };
      })
      .sort((a, b) => rank[b.displayLevel] - rank[a.displayLevel])[0] ?? null
  );
}

function trustToneColor(tone: TrustDisplayTone): string {
  switch (tone) {
    case 'green':
      return Colors.terminalGreen;
    case 'blue':
      return Colors.primaryBlue;
    default:
      return Colors.text3;
  }
}

function websiteEvidenceMessage(evidence: readonly HttpsOwnershipEvidence[], t: TFn): string {
  return evidence
    .map((item) =>
      t(
        item.method === 'did-document'
          ? 'badges.website.evidence.didDocument'
          : 'badges.website.evidence.relMe',
        { origin: item.origin },
      ),
    )
    .join('\n');
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

function nostrEvidenceMessage(vm: NostrBadgeViewModel, t: TFn, lastCheckedAt: number | null): string {
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
  if (lastCheckedAt !== null) {
    lines.push(t('badges.evidence.lastCheckedLine', { date: new Date(lastCheckedAt).toLocaleString() }));
  }
  return lines.join('\n');
}

function atprotoEvidenceMessage(
  vm: AtprotoBadgeViewModel,
  t: TFn,
  lastCheckedAt: number | null
): string {
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
  if (lastCheckedAt !== null) {
    lines.push(t('badges.evidence.lastCheckedLine', { date: new Date(lastCheckedAt).toLocaleString() }));
  }
  return lines.join('\n');
}
