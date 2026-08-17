import { describe, expect, it } from 'bun:test';

import {
  credentialTrustDisplayFor,
  credentialTrustSimpleI18nKeyForLevel,
  passportTrustLevelFromProof,
} from '../../src/credentials/trustDisplay';

describe('credential trust display mapping', () => {
  it('maps passport_v3 blue proof to L3 display semantics', () => {
    expect(passportTrustLevelFromProof('blue')).toBe('L3');
    expect(
      credentialTrustDisplayFor({
        type: 'passport',
        trustLevel: 'L3',
        metadataTags: ['passport-openac-v3', 'passport-openac-v3-no-aa'],
      })
    ).toMatchObject({
      level: 'L3',
      tone: 'blue',
      label: 'Level 3 - Passport ZK (No AA)',
    });
  });

  it('maps passport_v3 green proof to L3+ display semantics', () => {
    expect(passportTrustLevelFromProof('green')).toBe('L3+');
    expect(
      credentialTrustDisplayFor({
        type: 'passport',
        trustLevel: 'L3+',
        metadataTags: ['passport-openac-v3', 'passport-noir'],
      })
    ).toMatchObject({
      level: 'L3+',
      tone: 'green',
      label: 'Level 3+ - Passport ZK + AA',
    });
  });

  it('maps white and fallback passport proofs to L1 display semantics', () => {
    expect(passportTrustLevelFromProof('white')).toBe('L1');
    expect(
      credentialTrustDisplayFor({
        type: 'passport',
        trustLevel: 'L1',
        metadataTags: ['sd-jwt-fallback', 'fallback'],
      })
    ).toMatchObject({
      level: 'L1',
      tone: 'white',
      label: 'Level 1 - Fallback / Non-ZK',
    });
  });

  it('displays legacy L2 passport fallback records as L1', () => {
    expect(
      credentialTrustDisplayFor({
        type: 'passport',
        trustLevel: 'L2',
        metadataTags: ['sd-jwt-fallback', 'fallback'],
      })
    ).toMatchObject({
      level: 'L1',
      tone: 'white',
      label: 'Level 1 - Fallback / Non-ZK',
    });

    expect(
      credentialTrustDisplayFor({
        type: 'passport',
        trustLevel: 'L2',
        status: 'fallback',
      })
    ).toMatchObject({
      level: 'L1',
      tone: 'white',
      label: 'Level 1 - Fallback / Non-ZK',
    });

    expect(
      credentialTrustDisplayFor({
        source: 'Passport',
        trustLevel: 'L2',
        payload: '{"proof":"sd-jwt-fallback","identity_card_id":"old"}',
      })
    ).toMatchObject({
      level: 'L1',
      tone: 'white',
      label: 'Level 1 - Fallback / Non-ZK',
    });
  });

  it('displays legacy L2 passport_v3 no-AA records as L3 without rewriting non-passport L2', () => {
    expect(
      credentialTrustDisplayFor({
        type: 'passport',
        trustLevel: 'L2',
        metadataTags: ['passport-openac-v3', 'passport-openac-v3-no-aa'],
      })
    ).toMatchObject({
      level: 'L3',
      tone: 'blue',
      label: 'Level 3 - Passport ZK (No AA)',
    });

    expect(
      credentialTrustDisplayFor({
        type: 'student',
        trustLevel: 'L2',
        metadataTags: [],
      })
    ).toMatchObject({
      level: 'L2',
      tone: 'blue',
      label: 'Level 2 - Verified',
    });
  });

  it('maps every tier to a simple surface label key, keeping fallback distinct', () => {
    expect(credentialTrustSimpleI18nKeyForLevel('L3+')).toBe('credentialTrust.simpleL3Plus');
    expect(credentialTrustSimpleI18nKeyForLevel('L3')).toBe('credentialTrust.simpleL3');
    expect(credentialTrustSimpleI18nKeyForLevel('L2')).toBe('credentialTrust.simpleL2');
    expect(credentialTrustSimpleI18nKeyForLevel('L1')).toBe('credentialTrust.simpleL1');
    // The technical tier labels stay reachable for the detail screen.
    expect(
      credentialTrustDisplayFor({ type: 'passport', trustLevel: 'L3+', metadataTags: [] }).label
    ).toBe('Level 3+ - Passport ZK + AA');
  });
});
