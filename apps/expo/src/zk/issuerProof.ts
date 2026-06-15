/**
 * Issuer proof helper — wraps Semaphore group-membership proof generation
 * into a single async call `buildZKEnvelope` can attach to a `QRSharingPayload`.
 *
 * Mirrors the Swift snippet at
 * solidarity/Services/Card/QRCodeGenerationService.swift:304-318:
 *
 *   1. Load (or create) the local Semaphore identity.
 *   2. Find a group whose canonicalised member set CONTAINS the local
 *      identity's commitment AND has ≥2 distinct members.
 *   3. Call `generateGroupProof({ commitments, scope, signal: shareId })`.
 *   4. Return the raw proof JSON string + the local commitment.
 *
 * Returns null when the user is not a member of any group with enough
 * peers — `buildZKEnvelope` continues without an issuerProof. Errors from
 * the native bridge are also swallowed (best-effort proof; QR generation
 * never blocks on Semaphore being available).
 */
import { generateGroupProof, canonicalCommitments } from './groupManager';
import { loadOrCreateIdentity, currentIdentity } from './identity';

import { useGroupStore } from '@/groups/store';

export interface IssuerProofResult {
  /** Local Semaphore identity commitment (decimal-string field element). */
  readonly commitment: string;
  /** The raw Semaphore proof JSON (Swift `issuerProof: String?`). */
  readonly proof: string;
}

export interface IssuerProofArgs {
  /** Application-defined signal — typically the QR shareId UUID. */
  readonly message: string;
  /** Application-defined scope — typically `ShareScopeResolver.scope(...)`. */
  readonly scope: string;
}

/**
 * Find a group whose canonicalised member set includes `localCommitment`
 * and has at least two distinct members (Semaphore's circuit requires
 * group root over ≥2 distinct leaves).
 *
 * Mirrors Swift `SemaphoreGroupManager.proofCommitments(containing:)`
 * (line 87-119): trim + dedupe + sort across `group.members`, return the
 * canonical list if `localCommitment` is in it AND size > 1.
 */
function findGroupCommitments(localCommitment: string): readonly string[] | null {
  const trimmed = localCommitment.trim();
  if (trimmed.length === 0) return null;

  const state = useGroupStore.getState();
  for (const group of state.groups.values()) {
    const bucket = state.members.get(group.id) ?? [];
    const memberCommitments = bucket
      .map((m) => m.commitment?.trim() ?? '')
      .filter((c) => c.length > 0);
    const canonical = canonicalCommitments(memberCommitments);
    if (canonical.includes(trimmed) && canonical.length > 1) {
      return canonical;
    }
  }
  return null;
}

/**
 * Best-effort issuer proof generation. Returns null when:
 *   - the Semaphore identity isn't initialised (no native module / bad state),
 *   - the user isn't in any group with ≥2 distinct members,
 *   - the native generator throws (proofs can fail for circuit-input reasons
 *     even on happy paths — we don't surface the error to the QR flow).
 */
export async function generateIssuerProof(
  args: IssuerProofArgs
): Promise<IssuerProofResult | null> {
  // Prefer the already-loaded identity to avoid an extra Keychain hop;
  // fall through to loadOrCreateIdentity when nothing is cached yet.
  let identity = await currentIdentity().catch(() => null);
  if (!identity?.commitment) {
    identity = await loadOrCreateIdentity().catch(() => null);
  }
  if (!identity?.commitment || !identity.proofsSupported) {
    return null;
  }

  const commitments = findGroupCommitments(identity.commitment);
  if (!commitments) return null;

  try {
    const proof = await generateGroupProof({
      commitments,
      scope: args.scope,
      signal: args.message,
    });
    return { commitment: identity.commitment, proof: proof.proofJson };
  } catch {
    return null;
  }
}

/**
 * Build the `scope` string Swift's `ShareScopeResolver.scope(selectedFields:)`
 * would have produced. Re-exported so callers don't have to dig through the
 * sharing module. Format: `fields:<sorted-comma-list>` with `name` always
 * present.
 *
 * Mirrors solidarity/Services/Sharing/ShareScopeResolver.swift exactly.
 */
export function buildShareScope(
  selectedFields: readonly string[]
): string {
  const normalised = new Set<string>(selectedFields);
  normalised.add('name');
  const sorted = [...normalised].sort();
  return `fields:${sorted.join(',')}`;
}
