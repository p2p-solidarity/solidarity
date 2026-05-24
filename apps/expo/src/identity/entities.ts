/**
 * IdentityEntities — TS port of solidarity/Models/IdentityEntities.swift.
 *
 * Pure interface set (no SwiftData annotations). `ContactEntity` is NOT
 * re-ported here — `apps/expo/src/contacts/repository.ts` already covers it
 * via the legacy `Contact` shape; this module owns the credential + claim
 * side only.
 *
 * Field names match Swift verbatim (lowerCamelCase) so wire/migration
 * code can read either side without translation.
 */

export type TrustLevel = 'L1' | 'L2' | 'L3';

export interface IdentityCardEntity {
  readonly id: string;
  readonly type: string;
  readonly issuerType: string;
  readonly trustLevel: TrustLevel;
  readonly title: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly issuedAt: Date;
  readonly expiresAt?: Date;
  readonly status: string;
  readonly sourceReference?: string;
  readonly rawCredentialJWT?: string;
  readonly metadataTags: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProvableClaimEntity {
  readonly id: string;
  /** Source credential (IdentityCardEntity.id). Aliased `sourceCredentialId` in Swift. */
  readonly identityCardId: string;
  readonly claimType: string;
  readonly title: string;
  readonly issuerType: string;
  readonly trustLevel: TrustLevel;
  readonly source: string;
  readonly payload: string;
  /** BusinessCardField.rawValue when this claim verifies a card field; nil for non-field claims. */
  readonly sourceField?: string;
  readonly isPresentable: boolean;
  readonly lastPresentedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Semantic alias matching Swift's computed property `sourceCredentialId`. */
export function sourceCredentialId(claim: ProvableClaimEntity): string {
  return claim.identityCardId;
}
