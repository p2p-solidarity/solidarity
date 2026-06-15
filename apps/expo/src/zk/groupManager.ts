/**
 * SemaphoreGroup — port of solidarity/Services/ZK/SemaphoreGroupManager.swift
 * (group root + member-index helpers).
 *
 * The Expo client keeps the group state itself inside
 * `apps/expo/src/groups/store.ts`; this file just owns the cryptographic
 * derivations that need the Rust binding (Merkle root + leaf index +
 * proof generation).
 *
 * Field-element semantics: every commitment crossing this surface is a
 * DECIMAL-STRING field element (BN254 scalar field). The native bridge
 * re-implements Swift's exact `decimalStringToLittleEndian32` so the
 * resulting roots match the legacy SwiftUI app.
 */
import type { SemaphoreProof } from '@solidarity/nitro-semaphore';

import { loadSemaphoreNative } from './nativeBridge';

/**
 * Trim + dedupe + sort. Mirrors Swift
 * `SemaphoreIdentityManager.canonicalCommitments(_:)` (and the same
 * helper in `SemaphoreShim.swift` on the native side) so two devices
 * with the same member set always derive the same root.
 */
export function canonicalCommitments(
  commitments: readonly string[]
): readonly string[] {
  const normalised = new Set<string>();
  for (const c of commitments) {
    const trimmed = c.trim();
    if (trimmed.length > 0) normalised.add(trimmed);
  }
  return [...normalised].sort();
}

/**
 * Compute the Semaphore-circuit Merkle root for the given member
 * commitments. Returns null when the native module isn't linked yet
 * (Expo Go preview) so callers can render a graceful "—" instead of
 * crashing.
 */
export async function recomputeRoot(
  commitments: readonly string[]
): Promise<string | null> {
  const native = await loadSemaphoreNative();
  if (!native) return null;
  const members = canonicalCommitments(commitments);
  if (members.length === 0) return null;
  return native.groupRootFromCommitments([...members]);
}

/**
 * Lookup the leaf index of `commitment` inside the canonicalised member
 * set. Returns null when the commitment isn't a member.
 */
export function leafIndex(
  commitment: string | null,
  commitments: readonly string[]
): number | null {
  if (!commitment) return null;
  const members = canonicalCommitments(commitments);
  const idx = members.indexOf(commitment.trim());
  return idx >= 0 ? idx : null;
}

/**
 * Generate a Semaphore proof that the *currently-loaded* identity is a
 * member of the group whose commitments are passed in. The native side
 * canonicalises the list + ensures the local commitment is in the set
 * (mirrors Swift's `SemaphoreIdentityManager.generateProof`).
 */
export async function generateGroupProof(args: {
  readonly commitments: readonly string[];
  readonly scope: string;
  readonly signal: string;
}): Promise<SemaphoreProof> {
  const native = await loadSemaphoreNative();
  if (!native) throw new Error('Semaphore native module unavailable');
  return native.generateProof([...args.commitments], args.scope, args.signal);
}

/**
 * Verify a previously-generated proof. Returns false on any verification
 * failure (so the UI can present a single error path).
 */
export async function verifyGroupProof(
  proof: SemaphoreProof,
  merkleTreeDepth = 16
): Promise<boolean> {
  const native = await loadSemaphoreNative();
  if (!native) return false;
  try {
    return await native.verifyProof(proof, merkleTreeDepth);
  } catch {
    return false;
  }
}
