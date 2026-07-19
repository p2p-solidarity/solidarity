import { describe, expect, it } from 'bun:test';

import {
  buildPassportProvableClaims,
  filterPassportPublicDisclosureClaims,
  selectPassportShowPresentationClaims,
} from '../../src/passport/presentationClaims';
import type { ProvableClaimEntity } from '../../src/identity/entities';

const NOW = new Date('2026-06-12T08:00:00Z');

function claim(
  id: string,
  claimType: string,
  title = claimType
): ProvableClaimEntity {
  return {
    id,
    identityCardId: 'passport-card-1',
    claimType,
    title,
    issuerType: 'government',
    trustLevel: 'L3',
    source: 'Passport',
    payload: '{}',
    isPresentable: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('passport presentation claims', () => {
  it('creates a selectable nationality claim for OpenAC show presentations', () => {
    const claims = buildPassportProvableClaims({
      cardId: 'passport-card-1',
      proofType: 'passport_v3',
      issuerType: 'government',
      trustLevel: 'L3',
      nationalityCode: 'TWN',
      isSimulated: false,
      now: NOW,
      uuid: (() => {
        let i = 0;
        return () => `claim-${String((i += 1))}`;
      })(),
    });

    expect(claims.map((c) => c.claimType)).toEqual([
      'age_over_18',
      'nationality',
      'is_human',
      'field_name',
    ]);
    const nationality = claims.find((c) => c.claimType === 'nationality');
    expect(nationality?.title).toBe('Nationality verified by passport');
    expect(nationality?.payload).toContain('"claim":"nationality"');
  });

  it('passes only proof-backed show claims into the passport show flow', () => {
    const claims = [
      claim('age', 'age_over_18'),
      claim('human', 'is_human'),
      claim('name', 'field_name'),
      claim('nat', 'nationality'),
    ];
    const selected = new Set(['age', 'human', 'name', 'nat']);

    expect(
      selectPassportShowPresentationClaims(claims, selected).map((c) => c.claimType)
    ).toEqual(['age_over_18', 'nationality']);
  });

  it('offers only presentable passport-sourced age claims for public disclosure', () => {
    const claims = [
      claim('age18', 'age_over_18'),
      claim('age21', 'age_over_21'),
      claim('nationality', 'nationality'),
      { ...claim('other-source', 'age_over_18'), source: 'Imported VC' },
      { ...claim('not-presentable', 'age_over_18'), isPresentable: false },
    ];

    expect(
      filterPassportPublicDisclosureClaims(claims).map((candidate) =>
        candidate.claimType
      )
    ).toEqual(['age_over_18', 'age_over_21']);
  });
});
