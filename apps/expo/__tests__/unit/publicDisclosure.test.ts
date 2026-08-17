import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  hexToBytes,
  verifyPublicDisclosure,
  type ProfileBadge,
  type ProfileRecord,
  type Signer,
} from '@solidarity/shared';

import type {
  IdentityCardEntity,
  ProvableClaimEntity,
} from '../../src/identity/entities';
import {
  eligiblePassportPublicDisclosureClaims,
  publishPassportClaimPublicly,
  type PublicDisclosurePublishDependencies,
} from '../../src/disclosure/publicDisclosure';
import type { PublishReport } from '../../src/nostr/publish';

const NOW_MS = Date.parse('2026-07-19T00:00:00Z');
const CURRENT_CARD_DID = 'did:key:current-card-key';
const ROOT_DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';
const ROOT_PRIVATE_KEY = hexToBytes(
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
);
const ROOT_SIGNER: Signer = async (digest) =>
  p256.sign(digest, ROOT_PRIVATE_KEY, { prehash: false });

function passportCard(
  id: string,
  overrides: Partial<IdentityCardEntity> = {}
): IdentityCardEntity {
  return {
    id,
    type: 'passport',
    issuerType: 'government',
    trustLevel: 'L1',
    title: 'Passport',
    issuerDid: 'did:gov:passport:example',
    holderDid: CURRENT_CARD_DID,
    issuedAt: new Date('2026-07-01T00:00:00Z'),
    status: 'fallback',
    sourceReference: 'MRZ+NFC',
    get rawCredentialJWT(): string {
      throw new Error('public disclosure must never read the passport SD-JWT');
    },
    metadataTags: ['sd-jwt-fallback'],
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function passportClaim(
  id: string,
  identityCardId: string,
  claimType = 'age_over_18',
  overrides: Partial<ProvableClaimEntity> = {}
): ProvableClaimEntity {
  return {
    id,
    identityCardId,
    claimType,
    title: claimType,
    issuerType: 'government',
    trustLevel: 'L1',
    source: 'Passport',
    get payload(): string {
      throw new Error('public disclosure must never read passport claim payload');
    },
    isPresentable: true,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('eligiblePassportPublicDisclosureClaims', () => {
  it('uses only current-device, real, unexpired passport claim metadata', () => {
    const cards = [
      passportCard('valid'),
      passportCard('simulated', {
        status: 'simulated',
        sourceReference: 'MRZ+NFC(simulated)',
      }),
      passportCard('other-device', { holderDid: 'did:key:other-card-key' }),
      passportCard('imported', { sourceReference: undefined }),
      passportCard('expired', { expiresAt: new Date(NOW_MS - 1) }),
    ];
    const claims = [
      passportClaim('valid-age', 'valid'),
      passportClaim('simulated-age', 'simulated'),
      passportClaim('other-device-age', 'other-device'),
      passportClaim('imported-age', 'imported'),
      passportClaim('expired-age', 'expired'),
      passportClaim('nationality', 'valid', 'nationality'),
    ];

    expect(
      eligiblePassportPublicDisclosureClaims(
        cards,
        claims,
        CURRENT_CARD_DID,
        NOW_MS
      ).map((claim) => claim.id)
    ).toEqual(['valid-age']);
  });
});

function profileRecord(badges: readonly ProfileBadge[] = []): ProfileRecord {
  return {
    v: 1,
    did: ROOT_DID,
    displayName: 'Alice',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [],
    badges: [...badges],
    supersededBy: null,
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
}

function publishReport(kind: number, content: string): PublishReport {
  return {
    event: {
      id: 'a'.repeat(64),
      pubkey: 'ab'.repeat(32),
      created_at: Math.floor(NOW_MS / 1000),
      kind,
      tags: [],
      content,
      sig: 'b'.repeat(128),
    },
    results: [
      { relay: 'wss://a', accepted: true, message: 'ok', elapsedMs: 1 },
      { relay: 'wss://b', accepted: true, message: 'ok', elapsedMs: 1 },
      { relay: 'wss://c', accepted: true, message: 'ok', elapsedMs: 1 },
    ],
    acceptedCount: 3,
    requiredCount: 2,
    success: true,
  };
}

describe('publishPassportClaimPublicly', () => {
  it('root-signs presence only, publishes its slot, upserts the badge, then publishes the public projection', async () => {
    const card = passportCard('valid');
    const claim = passportClaim('valid-age', 'valid', 'age_over_18', {
      // Fake PII proves neither the claim payload nor credential bytes enter
      // the published record; both getters above throw if touched.
      title: 'I am over 18',
    });
    const order: string[] = [];
    let savedBadges: readonly ProfileBadge[] = [];
    const disclosureReport = publishReport(30078, 'placeholder');
    const existingBadges: readonly ProfileBadge[] = [
      { type: 'other.badge', subject: 'member', attestation: 'opaque' },
      {
        type: 'solidarity.publicDisclosure.v1',
        subject: 'age_over_18',
        attestation: 'nostr:30078:old:solidarity.disclosure.public.v1:old',
      },
    ];

    const dependencies: PublicDisclosurePublishDependencies = {
      nowMs: () => NOW_MS,
      createSlot: () => '0198a6e4-0c3d-7a21-9657-54a6b6b20275',
      resetBiometricGrace: () => {
        order.push('reset-biometric-grace');
      },
      getRootDid: () => Promise.resolve({ ok: true, value: ROOT_DID }),
      getRootSigner: () => Promise.resolve({ ok: true, value: ROOT_SIGNER }),
      getCurrentCardDid: () => Promise.resolve(CURRENT_CARD_DID),
      getIdentitySnapshot: () => ({ identityCards: [card], provableClaims: [claim] }),
      getProfileSnapshot: () => ({ record: profileRecord(existingBadges) }),
      publishDisclosure: (options) => {
        order.push('publish-disclosure');
        const verified = verifyPublicDisclosure(options.jws, ROOT_DID, { nowMs: NOW_MS });
        expect(verified.ok).toBe(true);
        if (verified.ok) {
          expect(verified.value.evidence.value).toEqual({ claim: 'age_over_18' });
          expect(Object.keys(verified.value.evidence.value)).toEqual(['claim']);
        }
        return Promise.resolve({
          ok: true,
          value: {
            ...disclosureReport,
            event: { ...disclosureReport.event, content: options.jws },
          },
        });
      },
      saveProfileBadges: (badges) => {
        order.push('save-profile-badges');
        savedBadges = badges;
        const record = profileRecord(badges);
        return Promise.resolve({ ok: true, value: { record, jws: 'profile.jws' } });
      },
      publishProfileProjection: () => {
        order.push('publish-profile-projection');
        return Promise.resolve({
          ok: true,
          value: {
            profile: publishReport(30078, 'profile.jws'),
            kind0: publishReport(0, '{}'),
          },
        });
      },
    };

    const result = await publishPassportClaimPublicly(
      { claimId: claim.id, relays: ['wss://a', 'wss://b', 'wss://c'] },
      dependencies
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.record.evidence.value).toEqual({ claim: 'age_over_18' });
    expect(savedBadges).toEqual([
      { type: 'other.badge', subject: 'member', attestation: 'opaque' },
      {
        type: 'solidarity.publicDisclosure.v1',
        subject: 'age_over_18',
        attestation:
          'nostr:30078:abababababababababababababababababababababababababababababababab:solidarity.disclosure.public.v1:0198a6e4-0c3d-7a21-9657-54a6b6b20275',
      },
    ]);
    expect(result.value.partial).toBe(false);
    expect(order).toEqual([
      'reset-biometric-grace',
      'publish-disclosure',
      'save-profile-badges',
      'publish-profile-projection',
      'reset-biometric-grace',
    ]);
  });

  it('does not request Face ID or publish when the claim is not eligible', async () => {
    let sensitiveActionCalled = false;
    const dependencies: PublicDisclosurePublishDependencies = {
      nowMs: () => NOW_MS,
      createSlot: () => '0198a6e4-0c3d-7a21-9657-54a6b6b20275',
      resetBiometricGrace: () => {
        sensitiveActionCalled = true;
      },
      getRootDid: () => Promise.resolve({ ok: true, value: ROOT_DID }),
      getRootSigner: () => {
        sensitiveActionCalled = true;
        return Promise.resolve({ ok: true, value: ROOT_SIGNER });
      },
      getCurrentCardDid: () => Promise.resolve(CURRENT_CARD_DID),
      getIdentitySnapshot: () => ({
        identityCards: [
          passportCard('simulated', {
            status: 'simulated',
            sourceReference: 'MRZ+NFC(simulated)',
          }),
        ],
        provableClaims: [passportClaim('age', 'simulated')],
      }),
      getProfileSnapshot: () => ({ record: profileRecord() }),
      publishDisclosure: () => {
        sensitiveActionCalled = true;
        return Promise.resolve({ ok: false, error: 'must not publish' });
      },
      saveProfileBadges: () => {
        sensitiveActionCalled = true;
        return Promise.resolve({ ok: false, error: 'must not save' });
      },
      publishProfileProjection: () => {
        sensitiveActionCalled = true;
        return Promise.resolve({ ok: false, error: 'must not publish profile' });
      },
    };

    const result = await publishPassportClaimPublicly(
      { claimId: 'age', relays: ['wss://a'] },
      dependencies
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'claimUnavailable',
        detail: 'the claim is not backed by a current-device passport verification',
      },
    });
    expect(sensitiveActionCalled).toBe(false);
  });

  it('does not add a badge when no relay accepts the disclosure', async () => {
    let profileTouched = false;
    let graceResets = 0;
    const card = passportCard('valid');
    const claim = passportClaim('age', 'valid');
    const rejectedReport = {
      ...publishReport(30078, 'record.jws'),
      acceptedCount: 0,
      success: false,
      results: [
        { relay: 'wss://a', accepted: false, message: 'rejected', elapsedMs: 1 },
      ],
    };
    const dependencies: PublicDisclosurePublishDependencies = {
      nowMs: () => NOW_MS,
      createSlot: () => '0198a6e4-0c3d-7a21-9657-54a6b6b20275',
      resetBiometricGrace: () => {
        graceResets += 1;
      },
      getRootDid: () => Promise.resolve({ ok: true, value: ROOT_DID }),
      getRootSigner: () => Promise.resolve({ ok: true, value: ROOT_SIGNER }),
      getCurrentCardDid: () => Promise.resolve(CURRENT_CARD_DID),
      getIdentitySnapshot: () => ({ identityCards: [card], provableClaims: [claim] }),
      getProfileSnapshot: () => ({ record: profileRecord() }),
      publishDisclosure: () => Promise.resolve({ ok: true, value: rejectedReport }),
      saveProfileBadges: () => {
        profileTouched = true;
        return Promise.resolve({ ok: false, error: 'must not save' });
      },
      publishProfileProjection: () => {
        profileTouched = true;
        return Promise.resolve({ ok: false, error: 'must not publish profile' });
      },
    };

    const result = await publishPassportClaimPublicly(
      { claimId: claim.id, relays: ['wss://a'] },
      dependencies
    );

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'disclosurePublishFailed',
        detail: 'no relay accepted the disclosure record',
        disclosureMayBePublic: true,
      },
    });
    expect(profileTouched).toBe(false);
    expect(graceResets).toBe(2);
  });
});
