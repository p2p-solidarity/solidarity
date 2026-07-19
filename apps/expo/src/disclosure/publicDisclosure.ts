/**
 * Opt-in App orchestration for presence-only passport public disclosures.
 *
 * The eligibility seam intentionally consumes only card/claim metadata. It
 * never reads `ProvableClaimEntity.payload`, `IdentityCardEntity.
 * rawCredentialJWT`, MRZ fields, or passport PII.
 */
import type {
  IdentityCardEntity,
  ProvableClaimEntity,
} from '@/identity/entities';
import type { RootKeyError } from '@/identity/rootKey';
import type {
  PublishPublicDisclosureOptions,
  PublishReport,
} from '@/nostr/publish';
import {
  filterPassportPublicDisclosureClaims,
  type PassportPublicDisclosureClaimEntity,
} from '@/passport/presentationClaims';
import type {
  NostrPublishOutcome,
  SavedProfile,
} from '@/profile/store';
import {
  PUBLIC_DISCLOSURE_BADGE_TYPE,
  PUBLIC_DISCLOSURE_MAX_LIFETIME_SECONDS,
  buildPublicDisclosure,
  buildPublicDisclosureBadgeReference,
  buildPublicDisclosureDTag,
  err,
  ok,
  signPublicDisclosure,
  type ProfileBadge,
  type ProfileRecord,
  type PublicDisclosureBadgeReferenceV1,
  type PublicDisclosureRecordV1,
  type Result,
  type Signer,
} from '@solidarity/shared';

const ELIGIBLE_PASSPORT_STATUSES: ReadonlySet<string> = new Set([
  'verified',
  'fallback',
]);

/** Presence-only records use the existing neutral/basic trust treatment. */
export const PUBLIC_DISCLOSURE_TRUST_LEVEL = 'L1' as const;

export function eligiblePassportPublicDisclosureClaims(
  identityCards: readonly IdentityCardEntity[],
  provableClaims: readonly ProvableClaimEntity[],
  currentCardDid: string,
  nowMs: number = Date.now()
): readonly PassportPublicDisclosureClaimEntity[] {
  if (currentCardDid.length === 0) return [];
  const eligibleCardIds = new Set(
    identityCards
      .filter(
        (card) =>
          card.type.toLowerCase() === 'passport' &&
          card.holderDid === currentCardDid &&
          card.sourceReference === 'MRZ+NFC' &&
          ELIGIBLE_PASSPORT_STATUSES.has(card.status) &&
          (card.expiresAt === undefined || card.expiresAt.getTime() >= nowMs)
      )
      .map((card) => card.id)
  );
  return filterPassportPublicDisclosureClaims(provableClaims).filter((claim) =>
    eligibleCardIds.has(claim.identityCardId)
  );
}

export interface PublishPassportClaimPubliclyInput {
  readonly claimId: string;
  /** Explicit caller-confirmed relay set; never defaulted inside the service. */
  readonly relays: readonly string[];
}

export type PublicDisclosurePublishError =
  | { readonly kind: 'invalidInput'; readonly detail: string }
  | { readonly kind: 'rootUnavailable'; readonly detail: string }
  | { readonly kind: 'cardKeyUnavailable'; readonly detail: string }
  | { readonly kind: 'claimUnavailable'; readonly detail: string }
  | { readonly kind: 'profileUnavailable'; readonly detail: string }
  | { readonly kind: 'signingFailed'; readonly detail: string }
  | {
      readonly kind: 'disclosurePublishFailed';
      readonly detail: string;
      readonly disclosureMayBePublic: boolean;
    }
  | {
      readonly kind: 'profileUpdateFailed';
      readonly detail: string;
      readonly disclosureMayBePublic: true;
    }
  | {
      readonly kind: 'profilePublishFailed';
      readonly detail: string;
      readonly disclosureMayBePublic: true;
    }
  | {
      readonly kind: 'unexpectedFailure';
      readonly detail: string;
      readonly disclosureMayBePublic: boolean;
    };

export interface PublicDisclosurePublishOutcome {
  readonly record: PublicDisclosureRecordV1;
  readonly jws: string;
  readonly badge: PublicDisclosureBadgeReferenceV1;
  readonly disclosure: PublishReport;
  readonly profile: NostrPublishOutcome;
  /** At least one copy exists, but one or more reports missed full quorum. */
  readonly partial: boolean;
}

interface IdentitySnapshot {
  readonly identityCards: readonly IdentityCardEntity[];
  readonly provableClaims: readonly ProvableClaimEntity[];
}

interface ProfileSnapshot {
  readonly record: ProfileRecord | null;
}

type MaybePromise<T> = T | Promise<T>;

export interface PublicDisclosurePublishDependencies {
  readonly nowMs: () => number;
  readonly createSlot: () => MaybePromise<string>;
  readonly resetBiometricGrace: () => MaybePromise<void>;
  readonly getRootDid: () => Promise<Result<string, RootKeyError>>;
  readonly getRootSigner: () => Promise<Result<Signer, RootKeyError>>;
  readonly getCurrentCardDid: () => Promise<string>;
  readonly getIdentitySnapshot: () => MaybePromise<IdentitySnapshot>;
  readonly getProfileSnapshot: () => MaybePromise<ProfileSnapshot>;
  readonly publishDisclosure: (
    options: PublishPublicDisclosureOptions
  ) => Promise<Result<PublishReport, string>>;
  readonly saveProfileBadges: (
    badges: readonly ProfileBadge[]
  ) => Promise<Result<SavedProfile, string>>;
  readonly publishProfileProjection: (
    relays: readonly string[]
  ) => Promise<Result<NostrPublishOutcome, string>>;
}

const DEFAULT_DEPENDENCIES: PublicDisclosurePublishDependencies = {
  nowMs: () => Date.now(),
  createSlot: async () => {
    const { randomUUID } = await import('expo-crypto');
    return randomUUID();
  },
  resetBiometricGrace: async () => {
    const { resetBiometricGrace } = await import('@/keychain/biometric');
    resetBiometricGrace();
  },
  getRootDid: async () => {
    const { getRootDid } = await import('@/identity/rootKey');
    return getRootDid();
  },
  getRootSigner: async () => {
    const { getRootSigner } = await import('@/identity/rootKey');
    return getRootSigner();
  },
  getCurrentCardDid: async () => {
    const { didKeyForCurrentIdentity } = await import('@/keychain/signingKey');
    return didKeyForCurrentIdentity();
  },
  getIdentitySnapshot: async () => {
    const { useIdentityData } = await import('@/identity/dataStore');
    const { identityCards, provableClaims } = useIdentityData.getState();
    return { identityCards, provableClaims };
  },
  getProfileSnapshot: async () => {
    const { useProfileStore } = await import('@/profile/store');
    return { record: useProfileStore.getState().record };
  },
  publishDisclosure: async (options) => {
    const { publishPublicDisclosure } = await import('@/nostr/publish');
    return publishPublicDisclosure(options);
  },
  saveProfileBadges: async (badges) => {
    const { useProfileStore } = await import('@/profile/store');
    const profile = useProfileStore.getState();
    if (!profile.record) return err('no profile has been saved yet');
    return profile.saveProfile(
      {
        displayName: profile.record.displayName,
        bio: profile.record.bio,
        links: profile.record.links,
        linkVisibility: profile.linkVisibility,
      },
      { badges }
    );
  },
  publishProfileProjection: async (relays) => {
    const { useProfileStore } = await import('@/profile/store');
    return useProfileStore.getState().publishToNostr(relays);
  },
};

function rootErrorDetail(error: RootKeyError): string {
  switch (error.kind) {
    case 'notProvisioned':
      return 'root identity is not provisioned';
    case 'biometricDenied':
      return 'biometric authentication was denied';
    case 'invalidMnemonic':
      return 'root identity material is invalid';
    case 'storageFailed':
      return 'root identity storage is unavailable';
  }
}

function upsertDisclosureBadge(
  badges: readonly ProfileBadge[],
  next: PublicDisclosureBadgeReferenceV1
): readonly ProfileBadge[] {
  return [
    ...badges.filter(
      (badge) =>
        !(
          badge.type === PUBLIC_DISCLOSURE_BADGE_TYPE &&
          badge.subject === next.subject
        )
    ),
    next,
  ];
}

interface PreparedPublicDisclosure {
  readonly rootDid: string;
  readonly claim: PassportPublicDisclosureClaimEntity;
  readonly slot: string;
  readonly record: PublicDisclosureRecordV1;
}

async function preparePublicDisclosure(
  input: PublishPassportClaimPubliclyInput,
  dependencies: PublicDisclosurePublishDependencies
): Promise<Result<PreparedPublicDisclosure, PublicDisclosurePublishError>> {
  if (input.claimId.length === 0 || input.relays.length === 0) {
    return err({
      kind: 'invalidInput',
      detail: 'a claim and at least one confirmed relay are required',
    });
  }

  const nowMs = dependencies.nowMs();
  const root = await dependencies.getRootDid();
  if (!root.ok) {
    return err({ kind: 'rootUnavailable', detail: rootErrorDetail(root.error) });
  }

  let currentCardDid: string;
  try {
    currentCardDid = await dependencies.getCurrentCardDid();
  } catch {
    return err({
      kind: 'cardKeyUnavailable',
      detail: 'the current device card-signing key is unavailable',
    });
  }

  const identity = await dependencies.getIdentitySnapshot();
  const claim = eligiblePassportPublicDisclosureClaims(
    identity.identityCards,
    identity.provableClaims,
    currentCardDid,
    nowMs
  ).find((candidate) => candidate.id === input.claimId);
  if (!claim) {
    return err({
      kind: 'claimUnavailable',
      detail: 'the claim is not backed by a current-device passport verification',
    });
  }

  const profile = (await dependencies.getProfileSnapshot()).record;
  if (profile?.did !== root.value) {
    return err({
      kind: 'profileUnavailable',
      detail: 'a saved profile for the active root identity is required',
    });
  }

  const slot = await dependencies.createSlot();
  const dTag = buildPublicDisclosureDTag(slot);
  if (!dTag.ok) {
    return err({ kind: 'invalidInput', detail: dTag.error.detail });
  }
  const issuedAt = Math.floor(nowMs / 1000);
  return ok({
    rootDid: root.value,
    claim,
    slot,
    record: buildPublicDisclosure({
      subject: root.value,
      slot,
      claim: claim.claimType,
      issuedAt,
      expiresAt: issuedAt + PUBLIC_DISCLOSURE_MAX_LIFETIME_SECONDS,
    }),
  });
}

async function publishDisclosureAndProfile(
  input: PublishPassportClaimPubliclyInput,
  prepared: PreparedPublicDisclosure,
  jws: string,
  dependencies: PublicDisclosurePublishDependencies
): Promise<Result<PublicDisclosurePublishOutcome, PublicDisclosurePublishError>> {
  const disclosure = await dependencies.publishDisclosure({
    jws,
    slot: prepared.slot,
    relays: input.relays,
  });
  if (!disclosure.ok) {
    return err({
      kind: 'disclosurePublishFailed',
      detail: disclosure.error,
      disclosureMayBePublic: true,
    });
  }
  if (disclosure.value.acceptedCount === 0) {
    return err({
      kind: 'disclosurePublishFailed',
      detail: 'no relay accepted the disclosure record',
      disclosureMayBePublic: true,
    });
  }

  const badge = buildPublicDisclosureBadgeReference(
    prepared.claim.claimType,
    disclosure.value.event.pubkey,
    prepared.slot
  );
  if (!badge.ok) {
    return err({
      kind: 'disclosurePublishFailed',
      detail: badge.error.detail,
      disclosureMayBePublic: true,
    });
  }

  const latestProfile = (await dependencies.getProfileSnapshot()).record;
  if (latestProfile?.did !== prepared.rootDid) {
    return err({
      kind: 'profileUpdateFailed',
      detail: 'the active profile changed after the disclosure was published',
      disclosureMayBePublic: true,
    });
  }
  const saved = await dependencies.saveProfileBadges(
    upsertDisclosureBadge(latestProfile.badges, badge.value)
  );
  if (!saved.ok) {
    return err({
      kind: 'profileUpdateFailed',
      detail: saved.error,
      disclosureMayBePublic: true,
    });
  }

  const profile = await dependencies.publishProfileProjection(input.relays);
  if (!profile.ok) {
    return err({
      kind: 'profilePublishFailed',
      detail: profile.error,
      disclosureMayBePublic: true,
    });
  }
  if (
    profile.value.profile.acceptedCount === 0 ||
    profile.value.kind0.acceptedCount === 0
  ) {
    return err({
      kind: 'profilePublishFailed',
      detail: 'no relay accepted the public profile or its Nostr binding',
      disclosureMayBePublic: true,
    });
  }

  return ok({
    record: prepared.record,
    jws,
    badge: badge.value,
    disclosure: disclosure.value,
    profile: profile.value,
    partial:
      !disclosure.value.success ||
      !profile.value.profile.success ||
      !profile.value.kind0.success,
  });
}

/**
 * Root-sign and publish a device-held abstract passport claim, then attach
 * its opaque Nostr pointer to the profile and publish the T7 public
 * projection. Every failure is a tagged Result; no passport bytes are read,
 * logged, returned, or placed on a relay.
 */
export async function publishPassportClaimPublicly(
  input: PublishPassportClaimPubliclyInput,
  dependencies: PublicDisclosurePublishDependencies = DEFAULT_DEPENDENCIES
): Promise<Result<PublicDisclosurePublishOutcome, PublicDisclosurePublishError>> {
  let disclosureMayBePublic = false;
  let biometricSessionStarted = false;
  try {
    const prepared = await preparePublicDisclosure(input, dependencies);
    if (!prepared.ok) return prepared;

    // The global gate normally has a five-minute grace. Clear it before and
    // after this transaction so the first root signature live-prompts and
    // this publication cannot reuse or leave behind another action's grace.
    await dependencies.resetBiometricGrace();
    biometricSessionStarted = true;

    const signer = await dependencies.getRootSigner();
    if (!signer.ok) {
      return err({ kind: 'rootUnavailable', detail: rootErrorDetail(signer.error) });
    }
    let jws: string;
    try {
      jws = await signPublicDisclosure(
        prepared.value.record,
        prepared.value.rootDid,
        signer.value
      );
    } catch {
      return err({
        kind: 'signingFailed',
        detail: 'root signing was denied or failed',
      });
    }

    // Once relay transmission begins, a copy may persist even if the relay
    // later rejects it or the remaining profile steps fail.
    disclosureMayBePublic = true;
    return await publishDisclosureAndProfile(input, prepared.value, jws, dependencies);
  } catch {
    return err({
      kind: 'unexpectedFailure',
      detail: 'public disclosure failed safely',
      disclosureMayBePublic,
    });
  } finally {
    if (biometricSessionStarted) await dependencies.resetBiometricGrace();
  }
}
