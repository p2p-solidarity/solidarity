import type { ActiveNip05HandleResolutionValue } from '../handles';
import type { ProfileRecord } from '../profile';

import type { NostrKind0Fetcher } from './nostr';
import type { BadgeState } from './types';

export interface Nip05BindingEvidence {
  readonly directoryPubkey: string;
  readonly profileClaimsNpub: boolean;
  readonly kind0ClaimsIdentifier: boolean | null;
  readonly kind0ClaimsDid: boolean | null;
  readonly kind0CreatedAt: number | null;
  readonly reason: string;
}

export interface VerifyNip05BindingResult {
  readonly state: BadgeState;
  readonly evidence: Nip05BindingEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function safeFetchKind0(fetchKind0: NostrKind0Fetcher, pubkey: string) {
  try {
    return await fetchKind0(pubkey);
  } catch {
    return null;
  }
}

/**
 * Verify the complete Solidarity short-name binding:
 * directory name → Nostr pubkey, signed profile → same npub, and the key's
 * kind-0 → both the NIP-05 identifier and the signed profile DID.
 */
export async function verifyNip05Binding(
  profile: ProfileRecord,
  resolution: ActiveNip05HandleResolutionValue,
  fetchKind0: NostrKind0Fetcher
): Promise<VerifyNip05BindingResult> {
  const profileClaimsNpub = profile.alsoKnownAs.includes(`nostr:${resolution.npub}`);
  if (!profileClaimsNpub) {
    return {
      state: 'declared',
      evidence: {
        directoryPubkey: resolution.pubkey,
        profileClaimsNpub: false,
        kind0ClaimsIdentifier: null,
        kind0ClaimsDid: null,
        kind0CreatedAt: null,
        reason: 'directory resolves, but the signed profile does not claim the resolved npub',
      },
    };
  }

  const kind0 = await safeFetchKind0(fetchKind0, resolution.pubkey);
  if (kind0 === null) {
    return {
      state: 'stale',
      evidence: {
        directoryPubkey: resolution.pubkey,
        profileClaimsNpub: true,
        kind0ClaimsIdentifier: null,
        kind0ClaimsDid: null,
        kind0CreatedAt: null,
        reason: 'directory and signed profile agree, but kind-0 is unreachable right now',
      },
    };
  }

  const content = isRecord(kind0.contentJson) ? kind0.contentJson : {};
  const kind0ClaimsIdentifier = content['nip05'] === resolution.identifier;
  const alsoKnownAs = content['alsoKnownAs'];
  const kind0ClaimsDid =
    Array.isArray(alsoKnownAs) && alsoKnownAs.some((candidate) => candidate === profile.did);
  const verified = kind0ClaimsIdentifier && kind0ClaimsDid;

  return {
    state: verified ? 'verified' : 'declared',
    evidence: {
      directoryPubkey: resolution.pubkey,
      profileClaimsNpub: true,
      kind0ClaimsIdentifier,
      kind0ClaimsDid,
      kind0CreatedAt: kind0.created_at,
      reason: verified
        ? 'all directions confirmed: directory, signed profile, and kind-0 agree'
        : 'directory and signed profile agree, but kind-0 does not claim the same identifier and DID',
    },
  };
}
