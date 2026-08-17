import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { credentialTrustSimpleI18nKeyForLevel } from '@/credentials/trustDisplay';
import {
  eligiblePassportPublicDisclosureClaims,
  PUBLIC_DISCLOSURE_TRUST_LEVEL,
  publishPassportClaimPublicly,
} from '@/disclosure/publicDisclosure';
import { confirmDialog } from '@/feedback/confirmDialog';
import { useTranslation } from '@/i18n';
import { useIdentityCoordinator } from '@/identity/coordinator';
import { useIdentityData } from '@/identity/dataStore';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { hasNostrKey } from '@/nostr/userKey';
import { useProfileStore } from '@/profile/store';

type SetupState = 'loading' | 'ready' | 'error';
type PublishState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'publishing' }
  | { readonly kind: 'published'; readonly partial: boolean }
  | { readonly kind: 'error'; readonly mayBePublic: boolean };

type ReadinessState =
  | 'loading'
  | 'loadError'
  | 'identityUnavailable'
  | 'noClaim'
  | 'profileRequired'
  | 'nostrRequired'
  | 'ready';

interface ReadinessInput {
  readonly setupState: SetupState;
  readonly identityHydrated: boolean;
  readonly coordinatorHydrated: boolean;
  readonly identityAvailable: boolean;
  readonly hasClaim: boolean;
  readonly profileReady: boolean;
  readonly nostrReady: boolean;
}

function disclosureReadiness(input: ReadinessInput): ReadinessState {
  if (input.setupState === 'error') return 'loadError';
  if (
    input.setupState === 'loading' ||
    !input.identityHydrated ||
    !input.coordinatorHydrated
  ) {
    return 'loading';
  }
  if (!input.identityAvailable) return 'identityUnavailable';
  if (!input.hasClaim) return 'noClaim';
  if (!input.profileReady) return 'profileRequired';
  if (!input.nostrReady) return 'nostrRequired';
  return 'ready';
}

function claimLabelKey(claim: 'age_over_18' | 'age_over_21'):
  | 'publicDisclosure.claim.ageOver18'
  | 'publicDisclosure.claim.ageOver21' {
  return claim === 'age_over_18'
    ? 'publicDisclosure.claim.ageOver18'
    : 'publicDisclosure.claim.ageOver21';
}

function ReadinessMessage({ state }: { readonly state: ReadinessState }) {
  const { t } = useTranslation();
  if (state === 'ready') return null;
  const key = `publicDisclosure.state.${state}` as const;
  return (
    <ThemedText
      variant="caption"
      tone={state === 'loadError' || state === 'identityUnavailable' ? 'error' : 'tertiary'}>
      {t(key)}
    </ThemedText>
  );
}

function PublishStateMessage({ state }: { readonly state: PublishState }) {
  const { t } = useTranslation();
  switch (state.kind) {
    case 'idle':
      return null;
    case 'publishing':
      return (
        <ThemedText variant="caption" tone="tertiary">
          {t('publicDisclosure.state.publishing')}
        </ThemedText>
      );
    case 'published':
      return (
        <ThemedText variant="caption" tone="secondary">
          {t(
            state.partial
              ? 'publicDisclosure.state.partial'
              : 'publicDisclosure.state.published'
          )}
        </ThemedText>
      );
    case 'error':
      return (
        <ThemedText variant="caption" tone="error">
          {t(
            state.mayBePublic
              ? 'publicDisclosure.state.mayBePublicError'
              : 'publicDisclosure.state.publishError'
          )}
        </ThemedText>
      );
  }
}

/** Opt-in only; rendering this surface never signs or publishes anything. */
export function PublicDisclosureAction() {
  const { t } = useTranslation();
  const identityCards = useIdentityData((state) => state.identityCards);
  const provableClaims = useIdentityData((state) => state.provableClaims);
  const identityHydrated = useIdentityData((state) => state.hydrated);
  const coordinatorHydrated = useIdentityCoordinator((state) => state.hydrated);
  const coordinatorError = useIdentityCoordinator((state) => state.lastError);
  const currentCardDid = useIdentityCoordinator(
    (state) => state.profile.activeDID?.did ?? null
  );
  const profile = useProfileStore((state) => state.record);
  const profileStatus = useProfileStore((state) => state.status);
  const [setupState, setSetupState] = useState<SetupState>('loading');
  const [nostrReady, setNostrReady] = useState(false);
  const [publishState, setPublishState] = useState<PublishState>({ kind: 'idle' });

  useEffect(() => {
    let mounted = true;
    const prepare = async () => {
      try {
        if (!useIdentityData.getState().hydrated) {
          await useIdentityData.getState().hydrate();
        }
        await useIdentityCoordinator.getState().seedFromKeychain();
        const hasKey = await hasNostrKey();
        if (mounted) {
          setNostrReady(hasKey);
          setSetupState('ready');
        }
      } catch {
        if (mounted) setSetupState('error');
      }
    };
    void prepare();
    return () => {
      mounted = false;
    };
  }, []);

  const eligibleClaims = useMemo(
    () =>
      currentCardDid
        ? eligiblePassportPublicDisclosureClaims(
            identityCards,
            provableClaims,
            currentCardDid
          )
        : [],
    [currentCardDid, identityCards, provableClaims]
  );
  const claim = eligibleClaims[0] ?? null;
  const readiness = disclosureReadiness({
    setupState,
    identityHydrated,
    coordinatorHydrated,
    identityAvailable: coordinatorError === null && currentCardDid !== null,
    hasClaim: claim !== null,
    profileReady: profileStatus === 'ready' && profile !== null,
    nostrReady,
  });
  const canPublish = readiness === 'ready';
  const publishing = publishState.kind === 'publishing';
  const trustLabel = t(
    credentialTrustSimpleI18nKeyForLevel(PUBLIC_DISCLOSURE_TRUST_LEVEL)
  );

  const onPublish = async () => {
    if (!canPublish || claim === null || publishing) return;
    const approved = await confirmDialog({
      title: t('publicDisclosure.confirm.title'),
      message: t('publicDisclosure.confirm.message', {
        claim: t(claimLabelKey(claim.claimType)),
        relays: DEFAULT_RELAYS.join(', '),
      }),
      confirmLabel: t('publicDisclosure.confirm.publish'),
      cancelLabel: t('publicDisclosure.confirm.cancel'),
    });
    if (!approved) return;

    setPublishState({ kind: 'publishing' });
    const result = await publishPassportClaimPublicly({
      claimId: claim.id,
      relays: DEFAULT_RELAYS,
    });
    if (result.ok) {
      setPublishState({ kind: 'published', partial: result.value.partial });
      return;
    }
    setPublishState({
      kind: 'error',
      mayBePublic:
        'disclosureMayBePublic' in result.error &&
        result.error.disclosureMayBePublic,
    });
  };

  return (
    <ThemedSurface variant="outlined" padded className="gap-3 rounded-none">
      <View className="gap-1">
        <ThemedText variant="titleMedium">
          {t('publicDisclosure.title')}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary">
          {t('publicDisclosure.trust', { trust: trustLabel })}
        </ThemedText>
      </View>

      <ThemedText variant="bodySmall" tone="secondary">
        {t('publicDisclosure.honesty')}
      </ThemedText>

      {claim ? (
        <ThemedText variant="label">
          {t('publicDisclosure.availableClaim', {
            claim: t(claimLabelKey(claim.claimType)),
          })}
        </ThemedText>
      ) : null}

      <ReadinessMessage state={readiness} />
      <PublishStateMessage state={publishState} />

      <ThemedButton
        label={t('publicDisclosure.action')}
        fullWidth
        disabled={!canPublish}
        loading={publishing}
        onPress={() => {
          void onPublish();
        }}
      />
    </ThemedSurface>
  );
}
