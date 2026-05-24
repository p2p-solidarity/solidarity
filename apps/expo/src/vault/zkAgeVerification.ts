/**
 * ZKAgeVerification — TS port of
 * solidarity/Services/Vault/ZKAgeVerificationService.swift's proof builder.
 *
 * Generates a Semaphore proof attesting the holder is over the given
 * threshold. Birthdate never leaves the device: the proof's circuit
 * input encoding mirrors Swift exactly so verifiers see byte-identical
 * messages whether the prover ran on iOS or Android.
 *
 * Inputs:
 *   - `minAge`     : 18 or 21
 *   - `nonce`      : verifier-supplied freshness token (binds the proof to
 *                    a single request)
 *   - `audience`   : verifier identifier; salted into the Semaphore scope
 *                    so the per-(secret, scope) nullifier stays unique to
 *                    this audience and replays land in NullifierStore.
 *
 * Outputs:
 *   - `proof`         : JSON-stringified Semaphore proof envelope
 *   - `publicInputs`  : [scope, signal, merkleTreeRoot, nullifier]
 */
import {
  err,
  ok,
  type CardError,
  type Result,
} from '@solidarity/shared';

import { useIdentityData } from '@/identity/dataStore';
import { currentIdentity, loadOrCreateIdentity } from '@/zk/identity';
import { canonicalCommitments } from '@/zk/groupManager';
import { loadSemaphoreNative } from '@/zk/nativeBridge';
import { getPassportAnchorCommitment } from '@/zk/passportAnchorStore';

export type ZkError = CardError;

export const ZK_AGE_SCOPE_DOMAIN = 'ageVerification.v1';

export function ageScope(minAge: number, audience: string): string {
  return `${ZK_AGE_SCOPE_DOMAIN}.${String(minAge)}.${audience}`;
}

export function ageSignal(minAge: number, nonce: string): string {
  return `age_over_${String(minAge)}:${nonce}`;
}

function hasAgeOverClaim(minAge: number): boolean {
  const state = useIdentityData.getState();
  const claimType = `age_over_${String(minAge)}`;
  return state.provableClaims.some((c) => c.isPresentable && c.claimType === claimType);
}

export async function buildAgeProof(opts: {
  readonly minAge: 18 | 21;
  readonly nonce: string;
  readonly audience: string;
}): Promise<Result<{ readonly proof: string; readonly publicInputs: readonly string[] }>> {
  if (!opts.nonce) {
    return err<ZkError>({ type: 'validationError', message: 'Age proof requires a nonce' });
  }
  if (!opts.audience) {
    return err<ZkError>({ type: 'validationError', message: 'Age proof requires an audience' });
  }

  await useIdentityData.getState().hydrate();
  if (!hasAgeOverClaim(opts.minAge)) {
    return err<ZkError>({
      type: 'notFound',
      message: `No verified age_over_${String(opts.minAge)} claim found — complete passport verification first`,
    });
  }

  try {
    const native = await loadSemaphoreNative();
    if (!native) {
      return err<ZkError>({
        type: 'configurationError',
        message: 'Semaphore native module unavailable',
      });
    }

    let snapshot = await currentIdentity();
    if (!snapshot.commitment) {
      snapshot = await loadOrCreateIdentity();
    }
    const commitment = snapshot.commitment;
    if (!commitment) {
      return err<ZkError>({
        type: 'keyManagementError',
        message: 'Semaphore identity not initialised',
      });
    }

    const anchor = getPassportAnchorCommitment();
    const members = canonicalCommitments([commitment, anchor]);
    const scope = ageScope(opts.minAge, opts.audience);
    const signal = ageSignal(opts.minAge, opts.nonce);
    const proof = await native.generateProof([...members], scope, signal);

    return ok({
      proof: JSON.stringify(proof),
      publicInputs: [scope, signal, proof.merkleRoot, proof.nullifier],
    });
  } catch (error) {
    return err<ZkError>({
      type: 'proofGenerationError',
      message: `Failed to build age proof: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
