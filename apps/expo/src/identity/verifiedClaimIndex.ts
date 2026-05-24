/**
 * VerifiedClaimIndex — TS port of
 * solidarity/Services/Identity/VerifiedClaimIndex.swift.
 *
 * Pure functions that walk identity cards + provable claims for a holder
 * DID and return the set of `BusinessCardField` values backed by a signed
 * source credential. The hook `useVerifiedFields` wires the same logic to
 * reactive store selectors.
 *
 * Mirrors Swift's "claim is expired iff its source card is expired" rule.
 */
import { useMemo } from 'react';

import { businessCardFieldSchema, type BusinessCardField } from '@solidarity/shared';

import type { IdentityCardEntity, ProvableClaimEntity } from './entities';
import { useIdentityData } from './dataStore';

function presentableClaims(
  identityCards: readonly IdentityCardEntity[],
  provableClaims: readonly ProvableClaimEntity[]
): readonly ProvableClaimEntity[] {
  const now = Date.now();
  const expired = new Set(
    identityCards
      .filter((c) => c.expiresAt !== undefined && c.expiresAt.getTime() < now)
      .map((c) => c.id)
  );
  return provableClaims.filter((c) => c.isPresentable && !expired.has(c.identityCardId));
}

function asField(raw: string | undefined): BusinessCardField | null {
  if (raw === undefined) return null;
  const parsed = businessCardFieldSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function claimsForHolder(
  holderDid: string,
  identityCards: readonly IdentityCardEntity[],
  provableClaims: readonly ProvableClaimEntity[]
): readonly ProvableClaimEntity[] {
  const holderCardIds = new Set(
    identityCards.filter((c) => c.holderDid === holderDid).map((c) => c.id)
  );
  return presentableClaims(identityCards, provableClaims).filter((c) =>
    holderCardIds.has(c.identityCardId)
  );
}

export function verifiedFieldsForHolder(
  holderDid: string,
  identityCards: readonly IdentityCardEntity[],
  provableClaims: readonly ProvableClaimEntity[]
): ReadonlySet<BusinessCardField> {
  const fields = new Set<BusinessCardField>();
  for (const claim of claimsForHolder(holderDid, identityCards, provableClaims)) {
    const field = asField(claim.sourceField);
    if (field) fields.add(field);
  }
  return fields;
}

export function isFieldVerifiedForHolder(
  field: BusinessCardField,
  holderDid: string,
  identityCards: readonly IdentityCardEntity[],
  provableClaims: readonly ProvableClaimEntity[]
): boolean {
  return verifiedFieldsForHolder(holderDid, identityCards, provableClaims).has(field);
}

export function verifiedFieldsFromCredentials(
  credentialIds: readonly string[],
  identityCards: readonly IdentityCardEntity[],
  provableClaims: readonly ProvableClaimEntity[]
): ReadonlySet<BusinessCardField> {
  const idSet = new Set(credentialIds);
  const fields = new Set<BusinessCardField>();
  for (const claim of presentableClaims(identityCards, provableClaims)) {
    if (!idSet.has(claim.identityCardId)) continue;
    const field = asField(claim.sourceField);
    if (field) fields.add(field);
  }
  return fields;
}

/** React hook — reactive set of verified BusinessCardFields for the holder. */
export function useVerifiedFields(
  holderDid: string | null | undefined
): ReadonlySet<BusinessCardField> {
  const identityCards = useIdentityData((s) => s.identityCards);
  const provableClaims = useIdentityData((s) => s.provableClaims);
  return useMemo<ReadonlySet<BusinessCardField>>(() => {
    if (!holderDid) return new Set();
    return verifiedFieldsForHolder(holderDid, identityCards, provableClaims);
  }, [holderDid, identityCards, provableClaims]);
}
