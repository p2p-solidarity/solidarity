/**
 * Public-Page proof controls. Binding checks still refresh their shared cache
 * here, but their visual status now belongs to the matching field row. This
 * section renders only real presentable claims from IdentityDataStore.
 */
import type { SFSymbol } from 'expo-symbols';
import { router, useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, View } from 'react-native';

import { atprotoBindingIO } from '@/atproto/bindingIo';
import {
  captureBadgeStatusCacheEpoch,
  readCachedAtprotoResult,
  readCachedNostrResult,
  shouldReverifyBadge,
  writeCachedAtprotoResult,
  writeCachedNostrResult,
} from '@/badges/badgeStatusCache';
import { verifyAtprotoBindingDual } from '@/badges/verifyAtprotoDual';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useThemeColors } from '@/constants/useThemeColors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useDisplayClaims, useIdentityData, type ProvableClaimEntity } from '@/identity';
import { makeKind0Fetcher } from '@/nostr/fetchKind0';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { useProfileStore } from '@/profile/store';
import {
  PUBLIC_DISCLOSURE_BADGE_TYPE,
  verifyNostrBinding,
  type ProfileRecord,
} from '@solidarity/shared';

import { PageEmptyState } from './PageEmptyState';
import { fieldRowStyle, iconTileStyle } from './pageRowStyles';

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
  nostrUploaded,
  onManageBindings,
}: ProfileBadgeChipsProps): ReactNode {
  const { t } = useTranslation();
  const c = useThemeColors();
  const claims = useDisplayClaims();
  const hydrated = useIdentityData((state) => state.hydrated);
  const hydrate = useIdentityData((state) => state.hydrate);
  const linkVisibility = useProfileStore((state) => state.linkVisibility);
  const saveProfile = useProfileStore((state) => state.saveProfile);
  const [loadError, setLoadError] = useState(false);
  const [savingClaimId, setSavingClaimId] = useState<string | null>(null);

  useRefreshBindingCaches(record, publicRecord, nostrUploaded);

  useEffect(() => {
    if (hydrated) return;
    let active = true;
    setLoadError(false);
    void hydrate().catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, [hydrate, hydrated]);

  const displayableClaims = useMemo(
    () => claims.filter((claim) => claim.claimType !== 'profile_card'),
    [claims],
  );
  // What THIS device holds versus what a visitor actually resolves. Saving
  // re-signs the local record; the published projection only changes when the
  // owner publishes. Reading both keeps the row from claiming a visibility the
  // outside world has not seen yet.
  const localSubjects = useMemo(
    () => disclosureSubjects(record),
    [record],
  );
  const visitorSubjects = useMemo(
    () => disclosureSubjects(publicRecord),
    [publicRecord],
  );

  const hideClaimFromPage = (claim: ProvableClaimEntity): void => {
    if (savingClaimId !== null) return;
    const badges = record.badges.filter(
      (badge) => !(
        badge.type === PUBLIC_DISCLOSURE_BADGE_TYPE &&
        badge.subject === claim.claimType
      ),
    );
    if (badges.length === record.badges.length) {
      // There is no real public disclosure to toggle on locally. Open the
      // backing credential instead of inventing a public badge reference.
      // `product: '1'` keeps the credential screen in product context even for
      // a developer-mode user: this is a product surface, so the protocol
      // vocabulary (VC / ZK / nonce / challenge) must stay behind Developer
      // Mode's own entry points, never leak in from the Page tab.
      router.push({
        pathname: '/credentials/[id]',
        params: { id: claim.identityCardId, claimId: claim.id, product: '1' },
      });
      return;
    }
    setSavingClaimId(claim.id);
    void saveProfile({
      displayName: record.displayName,
      bio: record.bio,
      links: record.links,
      linkVisibility,
    }, { badges })
      .then((result) => {
        if (result.ok) {
          haptic('success');
          return;
        }
        pushToast(t('mePage.proofVisibilityError'), 'error');
      })
      .catch(() => {
        pushToast(t('mePage.proofVisibilityError'), 'error');
      })
      .finally(() => {
        setSavingClaimId(null);
      });
  };

  if (!hydrated) {
    return (
      <View className="px-4">
        <ThemedSurface variant="inset" padded className="items-center gap-2">
          {loadError ? (
            <>
              <ThemedText variant="bodyMedium" tone="error">
                {t('mePage.proofLoadError')}
              </ThemedText>
              <ThemedButton
                label={t('mePage.retry')}
                variant="secondary"
                onPress={() => {
                  setLoadError(false);
                  void hydrate().catch(() => { setLoadError(true); });
                }}
              />
            </>
          ) : (
            <>
              <ActivityIndicator color={Colors.primaryBlue} />
              <ThemedText variant="caption" tone="secondary">
                {t('mePage.loadingProofs')}
              </ThemedText>
            </>
          )}
        </ThemedSurface>
      </View>
    );
  }

  if (displayableClaims.length === 0) {
    return (
      <View className="gap-3 px-4">
        <PageEmptyState
          art="attestation"
          title={t('mePage.noAttestations')}
          message={t('mePage.noAttestationsHint')}
          action={
            <ThemedButton
              label={t('mePage.createProof')}
              fullWidth
              onPress={onManageBindings}
            />
          }
        />
      </View>
    );
  }

  return (
    <View className="gap-3 px-4">
      {displayableClaims.map((claim) => {
        const presentation = claimPresentation(claim, t);
        const shownLocally = localSubjects.has(claim.claimType);
        const shownToVisitors = visitorSubjects.has(claim.claimType);
        const visibility: ProofVisibility = shownLocally === shownToVisitors
          ? (shownLocally ? 'public' : 'hidden')
          : 'pending';
        const saving = savingClaimId === claim.id;
        return (
          <PressableScale
            key={claim.id}
            haptic="tap"
            disabled={savingClaimId !== null}
            onPress={() => { hideClaimFromPage(claim); }}
            accessibilityRole="button"
            accessibilityLabel={t('mePage.proofVisibilityLabel', {
              claim: presentation.label,
              status: t(visibilityLabelKey(visibility)),
            })}
            style={fieldRowStyle(c.mutedSurface)}>
            <View style={iconTileStyle(c.chipSurface)}>
              <SfIcon name={presentation.icon} size={21} color={Colors.primaryBlue} />
            </View>
            <View className="flex-1" style={{ gap: 1 }}>
              <ThemedText variant="bodyMedium" numberOfLines={1}>
                {presentation.label}
              </ThemedText>
              <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
                {t(visibilitySubtitleKey(visibility, shownLocally))}
              </ThemedText>
            </View>
            {saving ? (
              <ActivityIndicator color={Colors.primaryBlue} />
            ) : (
              <ProofVisibilityPill visibility={visibility} />
            )}
          </PressableScale>
        );
      })}
      <AddAttestationAction onPress={onManageBindings} />
    </View>
  );
}

function useRefreshBindingCaches(
  record: ProfileRecord,
  publicRecord: ProfileRecord,
  nostrUploaded: boolean,
): void {
  const npubClaim = useMemo(
    () => nostrUploaded
      ? record.alsoKnownAs.find((value) => value.startsWith('nostr:npub'))
          ?.slice('nostr:'.length) ?? null
      : null,
    [nostrUploaded, record.alsoKnownAs],
  );
  const handleClaim = useMemo(
    () => record.alsoKnownAs.find((value) => value.startsWith('at://'))
      ?.slice('at://'.length) ?? null,
    [record.alsoKnownAs],
  );

  useFocusEffect(useCallback(() => {
    if (npubClaim !== null) {
      const cached = readCachedNostrResult();
      const current = cached !== null &&
        cached.result.npub === npubClaim &&
        !shouldReverifyBadge(cached.checkedAt, record.updatedAt, Date.now());
      if (!current) {
        const verificationEpoch = captureBadgeStatusCacheEpoch();
        void verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS)).then((result) => {
          writeCachedNostrResult(result, Date.now(), verificationEpoch);
        });
      }
    }
    if (handleClaim !== null) {
      const cached = readCachedAtprotoResult();
      const current = cached !== null &&
        cached.result.evidence.handleClaim === handleClaim &&
        !shouldReverifyBadge(cached.checkedAt, publicRecord.updatedAt, Date.now());
      if (!current) {
        const verificationEpoch = captureBadgeStatusCacheEpoch();
        void verifyAtprotoBindingDual(record, publicRecord, atprotoBindingIO).then((result) => {
          writeCachedAtprotoResult(result, Date.now(), verificationEpoch);
        });
      }
    }
  }, [handleClaim, npubClaim, publicRecord, record]));
}

type Translation = ReturnType<typeof useTranslation>['t'];

function claimPresentation(
  claim: ProvableClaimEntity,
  t: Translation,
): { readonly label: string; readonly icon: SFSymbol } {
  switch (claim.claimType) {
    case 'is_human':
      return { label: t('mePage.claimHuman'), icon: 'face.smiling' };
    case 'age_over_18':
      return { label: t('mePage.claimAdult'), icon: 'calendar' };
    case 'field_name':
      return {
        label: claim.sourceField === 'name' ? t('mePage.claimName') : claim.title,
        icon: 'person',
      };
    case 'nationality':
      return { label: t('mePage.claimNationality'), icon: 'globe' };
    default:
      return { label: claim.title, icon: 'building.2' };
  }
}

/** `public` and `hidden` are what a visitor resolves; `pending` means this
 *  device changed it and the published page has not caught up yet. */
type ProofVisibility = 'public' | 'hidden' | 'pending';

function disclosureSubjects(record: ProfileRecord): ReadonlySet<string> {
  return new Set(
    record.badges
      .filter((badge) => badge.type === PUBLIC_DISCLOSURE_BADGE_TYPE)
      .map((badge) => badge.subject),
  );
}

function visibilityLabelKey(visibility: ProofVisibility): string {
  if (visibility === 'pending') return 'mePage.pendingPublish';
  return visibility === 'public' ? 'mePage.public' : 'mePage.hidden';
}

function visibilitySubtitleKey(
  visibility: ProofVisibility,
  shownLocally: boolean,
): string {
  if (visibility !== 'pending') {
    return visibility === 'public' ? 'mePage.shownOnPage' : 'mePage.notShownOnPage';
  }
  // Say what the visitor sees RIGHT NOW, not what the owner intended.
  return shownLocally ? 'mePage.proofPendingShown' : 'mePage.proofPendingHidden';
}

function ProofVisibilityPill({
  visibility,
}: {
  readonly visibility: ProofVisibility;
}): ReactNode {
  const { t } = useTranslation();
  const color = visibility === 'public'
    ? Colors.primaryBlue
    : visibility === 'pending'
      ? Colors.warning
      : Colors.text3;
  return (
    <ThemedSurface
      variant="inset"
      className="px-2 py-1"
      style={{ borderWidth: 1, borderColor: color }}>
      <ThemedText variant="caption" style={{ color }}>
        {t(visibilityLabelKey(visibility))}
      </ThemedText>
    </ThemedSurface>
  );
}

function AddAttestationAction({ onPress }: { readonly onPress: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('mePage.addAttestation')}
      containerStyle={{ alignSelf: 'flex-start' }}>
      <ThemedSurface
        variant="inset"
        className="min-h-11 flex-row items-center gap-2 rounded-none px-3 py-2">
        <SfIcon name="plus" size={12} color={Colors.text3} />
        <ThemedText variant="label" tone="tertiary">
          {t('mePage.addAttestation')}
        </ThemedText>
      </ThemedSurface>
    </PressableScale>
  );
}
