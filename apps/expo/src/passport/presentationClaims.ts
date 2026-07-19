import type { TrustLevel } from '@/credentials/store';
import type { ProvableClaimEntity } from '@/identity/entities';
import {
  isPublicDisclosureClaim,
  type PublicDisclosureClaim,
} from '@solidarity/shared';

export const PASSPORT_SHOW_CLAIM_TYPES = [
  'age_over_18',
  'nationality',
] as const;

export type PassportShowClaimType = (typeof PASSPORT_SHOW_CLAIM_TYPES)[number];

export type PassportPublicDisclosureClaimEntity = ProvableClaimEntity & {
  readonly claimType: PublicDisclosureClaim;
};

const PASSPORT_SHOW_CLAIM_TYPE_SET = new Set<string>(PASSPORT_SHOW_CLAIM_TYPES);

export function isPassportShowClaimType(
  claimType: string
): claimType is PassportShowClaimType {
  return PASSPORT_SHOW_CLAIM_TYPE_SET.has(claimType);
}

export function filterPassportShowPresentationClaims(
  claims: readonly ProvableClaimEntity[]
): readonly ProvableClaimEntity[] {
  return claims.filter((claim) => isPassportShowClaimType(claim.claimType));
}

/**
 * Presence-only public candidates. This deliberately inspects claim metadata
 * only: never `payload` (which can contain passport-derived details), and
 * never the source credential's raw SD-JWT.
 */
export function filterPassportPublicDisclosureClaims(
  claims: readonly ProvableClaimEntity[]
): readonly PassportPublicDisclosureClaimEntity[] {
  return claims.filter(
    (claim): claim is PassportPublicDisclosureClaimEntity =>
      claim.source === 'Passport' &&
      claim.isPresentable &&
      isPublicDisclosureClaim(claim.claimType)
  );
}

export function selectPassportShowPresentationClaims(
  claims: readonly ProvableClaimEntity[],
  selectedClaimIds: ReadonlySet<string>
): readonly ProvableClaimEntity[] {
  if (selectedClaimIds.size === 0) return [];
  return claims.filter(
    (claim) =>
      selectedClaimIds.has(claim.id) && isPassportShowClaimType(claim.claimType)
  );
}

export function passportShowSelectedClaimTypes(
  claims: readonly ProvableClaimEntity[]
): readonly PassportShowClaimType[] {
  return filterPassportShowPresentationClaims(claims).map(
    (claim) => claim.claimType as PassportShowClaimType
  );
}

export interface BuildPassportProvableClaimsArgs {
  readonly cardId: string;
  readonly proofType: string;
  readonly issuerType: string;
  readonly trustLevel: TrustLevel;
  readonly nationalityCode: string;
  readonly isSimulated: boolean;
  readonly now: Date;
  readonly uuid: () => string;
}

export function buildPassportProvableClaims({
  cardId,
  proofType,
  issuerType,
  trustLevel,
  nationalityCode,
  isSimulated,
  now,
  uuid,
}: BuildPassportProvableClaimsArgs): ProvableClaimEntity[] {
  const nationality = nationalityCode.toUpperCase().replace(/[^A-Z]/gu, '').slice(0, 3);
  const claimPayload = (claim: string): string => {
    const parts: string[] = [
      `"claim":"${claim}"`,
      `"proof":"${proofType}"`,
      `"identity_card_id":"${cardId}"`,
    ];
    if (claim === 'nationality' && nationality.length === 3) {
      parts.push(`"nationality":"${nationality}"`);
    }
    if (isSimulated) parts.push('"is_simulated":true');
    return `{${parts.join(',')}}`;
  };

  const base = (claimType: string, title: string): ProvableClaimEntity => ({
    id: uuid(),
    identityCardId: cardId,
    claimType,
    title,
    issuerType,
    trustLevel,
    source: 'Passport',
    payload: claimPayload(claimType),
    isPresentable: true,
    createdAt: now,
    updatedAt: now,
  });

  return [
    base('age_over_18', 'I am over 18'),
    base(
      'nationality',
      isSimulated
        ? 'Nationality (dev-mode passport)'
        : 'Nationality verified by passport'
    ),
    base('is_human', 'I am a real person'),
    {
      ...base(
        'field_name',
        isSimulated ? 'Name (dev-mode passport)' : 'Name verified by passport'
      ),
      sourceField: 'name',
    },
  ];
}
