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
  type NostrBadgeViewModel,
  type NostrBadgeVisual,
} from '@/badges/nostrBadgeDisplay';
import { atprotoBindingIO } from '@/atproto/bindingIo';
import { verifyAtprotoBindingDual } from '@/badges/verifyAtprotoDual';
import {
  invalidateCachedAtprotoResult,
  invalidateCachedNostrResult,
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
import { appAlert, showError, type AppAlertButton } from '@/feedback/appAlert';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  isBiometricCancellation,
  isNostrPublishOutcomePartiallyAccepted,
} from '@/nostr/connectWizard';
import { makeKind0Fetcher } from '@/nostr/fetchKind0';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { verifyHttpsOwnership, type HttpsOwnershipEvidence } from '@/profile/httpsOwnership';
import { useProfileStore } from '@/profile/store';
import {
  verifyNostrBinding,
  type ProfileRecord,
  type VerifyAtprotoBindingResult,
  type VerifyNostrBindingResult,
} from '@solidarity/shared';
import { buildProfileShareModel } from './meProfileModel';
import { badgeRecoveryActions } from './badgeRecoveryActions';

const BADGE_CROSSFADE_MS = 200;

type BadgeVisual = AtprotoBadgeVisual | NostrBadgeVisual;
type TFn = ReturnType<typeof useTranslation>['t'];

export interface ProfileBadgeChipsProps {
  readonly record: ProfileRecord;
  readonly publicRecord: ProfileRecord;
  readonly jws: string;
  readonly nostrUploaded: boolean;
  readonly onManageBindings: () => void;
}

export function ProfileBadgeChips({
  record,
  publicRecord,
  jws,
  nostrUploaded,
  onManageBindings,
}: ProfileBadgeChipsProps): ReactNode {
  const { t } = useTranslation();
  const manifest = useCredentialStore((state) => state.manifest);
  const credentialDetails = useCredentialStore((state) => state.details);
  const loadCredentialDetail = useCredentialStore((state) => state.loadDetail);
  const publishToNostr = useProfileStore((state) => state.publishToNostr);
  const passport = useMemo(
    () => strongestPassportCredential(manifest, credentialDetails),
    [credentialDetails, manifest]
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
      nostrUploaded
        ? record.alsoKnownAs.find((value) => value.startsWith('nostr:npub'))?.slice('nostr:'.length) ??
          null
        : null,
    [nostrUploaded, record.alsoKnownAs]
  );
  const handleClaim = useMemo(
    () =>
      record.alsoKnownAs.find((value) => value.startsWith('at://'))?.slice('at://'.length) ?? null,
    [record.alsoKnownAs]
  );
  const {
    nostr,
    bluesky,
    nostrCheckedAt,
    atprotoCheckedAt,
    retryNostrVerification,
    retryAtprotoVerification,
  } = useBindingBadgeViewModels(record, publicRecord, npubClaim, handleClaim);
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

  const republishNostr = async (): Promise<void> => {
    const published = await publishToNostr(DEFAULT_RELAYS);
    if (!published.ok) {
      if (isBiometricCancellation(published.error)) return;
      haptic('error');
      showError({
        context: 'Me › Badge recovery › Republish',
        summary: t('meHome.badge.republishFailed'),
        error: new Error(published.error),
      });
      return;
    }
    if (!isNostrPublishOutcomePartiallyAccepted(published.value)) {
      haptic('error');
      showError({
        context: 'Me › Badge recovery › Republish',
        summary: t('meHome.badge.republishFailed'),
        error: new Error('No complete page-and-verification copy was accepted.'),
      });
      return;
    }
    haptic('success');
    pushToast(t('meHome.badge.republished'), 'success');
    retryNostrVerification();
  };

  const openNostrEvidence = (): void => {
    if (nostr.visual === 'hidden' || nostr.visual === 'loading') return;
    const actions = badgeRecoveryActions({
      platform: 'nostr',
      visual: nostr.visual,
      direction1: nostr.direction1,
      direction2: nostr.direction2,
    });
    const buttons: AppAlertButton[] = [];
    if (actions.includes('retry')) {
      buttons.push({
        label: t('meHome.badge.retryVerification'),
        onPress: retryNostrVerification,
      });
    }
    if (actions.includes('republish')) {
      buttons.push({
        label: t('meHome.badge.republish'),
        onPress: () => {
          void republishNostr();
        },
      });
    }
    buttons.push({
      label: t(actions.length > 0 ? 'alert.cancel' : 'alert.ok'),
      style: 'cancel',
    });
    appAlert({
      title: t('meHome.badge.nostr.title'),
      message: nostrEvidenceMessage(nostr, t, nostrCheckedAt),
      buttons,
    });
  };

  const openBlueskyEvidence = (): void => {
    if (bluesky.visual === 'hidden' || bluesky.visual === 'loading') return;
    const actions = badgeRecoveryActions({
      platform: 'bluesky',
      visual: bluesky.visual,
      direction1: bluesky.direction1,
      direction2: bluesky.direction2,
    });
    const buttons: AppAlertButton[] = [];
    if (actions.includes('retry')) {
      buttons.push({
        label: t('meHome.badge.retryVerification'),
        onPress: retryAtprotoVerification,
      });
    }
    if (actions.includes('reconnectBluesky')) {
      buttons.push({
        label: t('meHome.badge.reconnectBluesky'),
        onPress: () => {
          router.push('/verify/bluesky');
        },
      });
    }
    buttons.push({
      label: t(actions.length > 0 ? 'alert.cancel' : 'alert.ok'),
      style: 'cancel',
    });
    appAlert({
      title: t('meHome.badge.bluesky.title'),
      message: atprotoEvidenceMessage(bluesky, t, atprotoCheckedAt),
      buttons,
    });
  };

  if (!hasBadge) {
    return <AddAttestationAction onPress={onManageBindings} />;
  }

  return (
    <View className="gap-3">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {nostr.visual !== 'hidden' ? (
          <BadgeChip
            visual={nostr.visual}
            label={badgeLabel('nostr', nostr.visual, t)}
            onPress={nostr.visual === 'loading' ? undefined : openNostrEvidence}
          />
        ) : null}
        {bluesky.visual !== 'hidden' ? (
          <BadgeChip
            visual={bluesky.visual}
            label={badgeLabel('bluesky', bluesky.visual, t)}
            onPress={bluesky.visual === 'loading' ? undefined : openBlueskyEvidence}
          />
        ) : null}
        {websiteVisual !== 'hidden' ? (
          <BadgeChip
            visual={websiteVisual}
            label={t(
              websiteVisual === 'loading' ? 'badges.website.checking' : 'badges.website.verifiedLabel'
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
              credentialTrustSimpleI18nKeyForLevel(passport.displayLevel)
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
      <AddAttestationAction onPress={onManageBindings} />
    </View>
  );
}

function AddAttestationAction({ onPress }: { readonly onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="px-4">
      <PressableScale
        haptic="tap"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('mePage.addAttestation')}
        containerStyle={{ alignSelf: 'flex-start' }}>
        <ThemedSurface
          variant="inset"
          className="flex-row items-center gap-2 rounded-none px-3 py-2">
          <SfIcon name="plus" size={12} color={Colors.text3} />
          <ThemedText variant="label" tone="tertiary">
            {t('mePage.addAttestation')}
          </ThemedText>
        </ThemedSurface>
      </PressableScale>
    </View>
  );
}

function useBindingBadgeViewModels(
  record: ProfileRecord,
  publicRecord: ProfileRecord,
  npubClaim: string | null,
  handleClaim: string | null
): {
  readonly nostr: NostrBadgeViewModel;
  readonly bluesky: AtprotoBadgeViewModel;
  readonly nostrCheckedAt: number | null;
  readonly atprotoCheckedAt: number | null;
  readonly retryNostrVerification: () => void;
  readonly retryAtprotoVerification: () => void;
} {
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
  const [nostrCheckedAt, setNostrCheckedAt] = useState<number | null>(
    () => readCachedNostrResult()?.checkedAt ?? null
  );
  const [atprotoCheckedAt, setAtprotoCheckedAt] = useState<number | null>(
    () => readCachedAtprotoResult()?.checkedAt ?? null
  );
  const [nostrChecking, setNostrChecking] = useState(false);
  const [atprotoChecking, setAtprotoChecking] = useState(false);
  const [nostrRetryNonce, setNostrRetryNonce] = useState(0);
  const [atprotoRetryNonce, setAtprotoRetryNonce] = useState(0);

  const retryNostrVerification = useCallback(() => {
    invalidateCachedNostrResult();
    setNostrRetryNonce((value) => value + 1);
  }, []);
  const retryAtprotoVerification = useCallback(() => {
    invalidateCachedAtprotoResult();
    setAtprotoRetryNonce((value) => value + 1);
  }, []);

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
          setNostrCheckedAt(cached.checkedAt);
        } else {
          setNostrChecking(true);
          void verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS)).then((next) => {
            const checkedAt = Date.now();
            // Persist the completed check FIRST, unconditionally — a
            // verification that lands after the component blurred must still
            // seed the shared cache (R22). Only the setState UI updates are
            // suppressed on blur, so the next visit reads a warm result
            // instead of re-opening three relay sockets.
            writeCachedNostrResult(next, checkedAt);
            if (cancelled) return;
            setNostrResult(next);
            setNostrCheckedAt(checkedAt);
            setNostrChecking(false);
          });
        }
      }
      if (handleClaim !== null) {
        const cached = readCachedAtprotoResult();
        const cacheStandsIn =
          cached !== null &&
          cached.result.evidence.handleClaim === handleClaim &&
          !shouldReverifyBadge(cached.checkedAt, publicRecord.updatedAt, Date.now());
        if (cacheStandsIn) {
          setAtprotoResult(cached.result);
          setAtprotoCheckedAt(cached.checkedAt);
        } else {
          setAtprotoChecking(true);
          void verifyAtprotoBindingDual(record, publicRecord, atprotoBindingIO).then((next) => {
            const checkedAt = Date.now();
            // Same as the nostr path: cache the completed result even after
            // blur (R22); suppress only the UI updates.
            writeCachedAtprotoResult(next, checkedAt);
            if (cancelled) return;
            setAtprotoResult(next);
            setAtprotoCheckedAt(checkedAt);
            setAtprotoChecking(false);
          });
        }
      }
      return () => {
        cancelled = true;
      };
    }, [
      atprotoRetryNonce,
      handleClaim,
      nostrRetryNonce,
      npubClaim,
      publicRecord,
      record,
      record.updatedAt,
    ])
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
          atprotoChecking || matchingAtprotoResult === null
        )
      : atprotoBadgeViewModel(null, false),
    nostrCheckedAt,
    atprotoCheckedAt,
    retryNostrVerification,
    retryAtprotoVerification,
  };
}

function useWebsiteOwnership(
  record: ProfileRecord,
  shareModel: ReturnType<typeof buildProfileShareModel>
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
        (url): url is string => url !== null
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
    }, [record.did, record.links, record.updatedAt, shareModel.offlineUrl, shareModel.shortUrl])
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
  details: ReadonlyMap<string, StoredCredential>
): PassportBadgeModel | null {
  const rank: Readonly<Record<TrustLevel, number>> = { L1: 1, L2: 2, L3: 3, 'L3+': 4 };
  return (
    manifest
      .filter((credential) => credential.type.toLowerCase() === 'passport')
      .map((credential) => {
        const detail = details.get(credential.id);
        const displayLevel: TrustLevel = detail ? credentialTrustDisplayFor(detail).level : 'L1';
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
        { origin: item.origin }
      )
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

function nostrEvidenceMessage(
  vm: NostrBadgeViewModel,
  t: TFn,
  lastCheckedAt: number | null
): string {
  const lines = [
    t(
      vm.visual === 'verified'
        ? 'meHome.badge.nostr.status.verified'
        : vm.visual === 'stale'
          ? 'meHome.badge.nostr.status.stale'
          : 'meHome.badge.nostr.status.declared'
    ),
  ];

  lines.push(
    vm.direction1
      ? t('meHome.badge.nostr.pageClaim.confirmed')
      : t('meHome.badge.nostr.pageClaim.missing')
  );
  lines.push(
    vm.direction2 === true
      ? t('meHome.badge.nostr.accountClaim.confirmed')
      : vm.direction2 === false
        ? t('meHome.badge.nostr.accountClaim.missing')
        : t('meHome.badge.nostr.accountClaim.unknown')
  );
  if (vm.kind0CreatedAt !== null) {
    lines.push(
      t('meHome.badge.nostr.lastUpdated', {
        date: new Date(vm.kind0CreatedAt * 1000).toLocaleString(),
      })
    );
  }
  if (lastCheckedAt !== null) {
    lines.push(
      t('meHome.badge.lastChecked', {
        date: new Date(lastCheckedAt).toLocaleString(),
      })
    );
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
        ? 'meHome.badge.bluesky.status.verified'
        : vm.visual === 'stale'
          ? 'meHome.badge.bluesky.status.stale'
          : 'meHome.badge.bluesky.status.declared'
    ),
  ];
  if (vm.handle) lines.push(t('meHome.badge.bluesky.handle', { handle: vm.handle }));
  lines.push(
    vm.direction1
      ? t('meHome.badge.bluesky.pageClaim.confirmed')
      : t('meHome.badge.bluesky.pageClaim.missing')
  );
  lines.push(
    vm.direction2 === true
      ? t('meHome.badge.bluesky.accountCopy.confirmed')
      : vm.direction2 === false
        ? t('meHome.badge.bluesky.accountCopy.missing')
        : t('meHome.badge.bluesky.accountCopy.unknown')
  );
  if (lastCheckedAt !== null) {
    lines.push(
      t('meHome.badge.lastChecked', {
        date: new Date(lastCheckedAt).toLocaleString(),
      })
    );
  }
  return lines.join('\n');
}
