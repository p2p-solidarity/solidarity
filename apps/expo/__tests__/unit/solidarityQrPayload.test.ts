import { describe, expect, it } from 'bun:test';

import type {
  BusinessCard,
  PublicKeyJWK,
  SharingPreferences,
} from '@solidarity/shared';

import {
  buildDidSignedEnvelope,
  buildSolidarityQrPayloadAsync,
  buildSolidarityQrPayload,
  enabledFieldsFromSharePreferences,
  shareFieldPreferencesFromFields,
} from '../../src/cards/solidarityQrPayload';

const NOW = new Date('2026-05-25T12:34:56.789Z');
const SHARE_ID = '11111111-2222-4333-8444-555555555555';
const CREDENTIAL_ID = '22222222-3333-4444-8555-666666666666';
const DID = 'did:key:zTestIssuer';
const PUBLIC_JWK: PublicKeyJWK = {
  kty: 'EC',
  crv: 'P-256',
  alg: 'ES256',
  x: 'abc',
  y: 'def',
};

function makePrefs(): SharingPreferences {
  return {
    publicFields: new Set(['name', 'title', 'company']),
    professionalFields: new Set(['name', 'title', 'company', 'email', 'skills']),
    personalFields: new Set([
      'name',
      'title',
      'company',
      'email',
      'phone',
      'profileImage',
      'socialNetworks',
      'skills',
    ]),
    allowForwarding: false,
    expirationDate: undefined,
    useZK: true,
    sharingFormat: 'didSigned',
  };
}

function makeCard(): BusinessCard {
  return {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'Ada Lovelace',
    title: '  Founder  ',
    company: ' Analytical Engines ',
    email: ' ada@example.com ',
    phone: ' +1-555-0100 ',
    profileImage: 'base64-image',
    animal: 'dove',
    socialNetworks: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        platform: 'GitHub',
        username: 'ada',
        url: 'https://github.com/ada',
      },
    ],
    skills: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        name: 'Math',
        category: 'Science',
        proficiencyLevel: 'Expert',
      },
    ],
    categories: ['computing'],
    sharingPreferences: makePrefs(),
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2026-05-20T00:00:00Z'),
    updatedAt: new Date('2026-05-24T00:00:00Z'),
  };
}

describe('Solidarity settings QR payload', () => {
  it('uses Swift ShareSettingsStore field toggles with name always enabled', () => {
    const fields = enabledFieldsFromSharePreferences({
      shareTitle: true,
      shareCompany: false,
      shareEmail: true,
      sharePhone: false,
      shareProfileImage: true,
      shareSocialNetworks: false,
      shareSkills: true,
    });

    expect(fields).toEqual(['email', 'name', 'profileImage', 'skills', 'title']);
  });

  it('maps Swift enabled fields back into share-field preferences', () => {
    expect(
      shareFieldPreferencesFromFields(['name', 'company', 'phone', 'skills'])
    ).toEqual({
      shareTitle: false,
      shareCompany: true,
      shareEmail: false,
      sharePhone: true,
      shareProfileImage: false,
      shareSocialNetworks: false,
      shareSkills: true,
    });
  });

  it('builds a plaintext QRCodeEnvelope instead of a card-id URL pointer', () => {
    const payload = buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
      shareFieldPreferences: {
        shareTitle: true,
        shareCompany: true,
        shareEmail: true,
        sharePhone: false,
        shareProfileImage: true,
        shareSocialNetworks: false,
        shareSkills: true,
      },
    });

    expect(payload.startsWith('https://solidarity.gg/c/')).toBe(false);
    expect(Object.keys(JSON.parse(payload) as Record<string, unknown>)).toEqual([
      'format',
      'plaintext',
      'selectedFields',
      'shareId',
      'sharingLevel',
      'version',
    ]);

    const envelope = JSON.parse(payload) as {
      readonly format: string;
      readonly sharingLevel: string;
      readonly shareId: string;
      readonly selectedFields: readonly string[];
      readonly plaintext: {
        readonly createdAt: string;
        readonly shareId: string;
        readonly selectedFields: readonly string[];
        readonly snapshot: {
          readonly cardId: string;
          readonly name: string;
          readonly title?: string;
          readonly company?: string;
          readonly emails: readonly string[];
          readonly phones: readonly string[];
          readonly profileImageDataURI?: string;
          readonly socialProfiles: readonly unknown[];
          readonly skills: readonly unknown[];
          readonly summary?: string;
          readonly updatedAt: string;
        };
      };
      readonly version: number;
    };

    expect(envelope.version).toBe(2);
    expect(envelope.format).toBe('plaintext');
    expect(envelope.sharingLevel).toBe('professional');
    expect(envelope.shareId).toBe(SHARE_ID);
    expect(envelope.selectedFields).toEqual([
      'company',
      'email',
      'name',
      'skills',
      'title',
    ]);
    expect(envelope.plaintext.selectedFields).toEqual(envelope.selectedFields);
    expect(envelope.plaintext.createdAt).toBe('2026-05-25T12:34:56Z');
    expect(envelope.plaintext.shareId).toBe(SHARE_ID);
    expect(envelope.plaintext.snapshot).toMatchObject({
      cardId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'Ada Lovelace',
      title: 'Founder',
      company: 'Analytical Engines',
      emails: ['ada@example.com'],
      phones: [],
      summary: 'Founder @ Analytical Engines',
      updatedAt: '2026-05-24T00:00:00Z',
    });
    expect(envelope.plaintext.snapshot.profileImageDataURI).toBeUndefined();
    expect(envelope.plaintext.snapshot.socialProfiles).toEqual([]);
    expect(envelope.plaintext.snapshot.skills).toEqual([
      { category: 'Science', name: 'Math', proficiency: 'Expert' },
    ]);
  });

  it('includes selected proof claims in plaintext QR payloads', () => {
    const withoutProofs = buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
      proofClaims: [],
    });
    const withProofs = buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
      proofClaims: ['age_over_18'],
    });

    expect(withProofs).not.toBe(withoutProofs);

    const envelope = JSON.parse(withProofs) as {
      readonly plaintext: {
        readonly proofClaims?: readonly string[];
      };
    };
    expect(envelope.plaintext.proofClaims).toEqual(['age_over_18']);
  });

  it('prefers Swift-style DID-signed VC JWT payload when a signer is available', async () => {
    const signedPayloads: Record<string, unknown>[] = [];
    const jwt = await buildSolidarityQrPayloadAsync(makeCard(), {
      now: NOW,
      credentialId: CREDENTIAL_ID,
      sharingLevel: 'professional',
      shareFieldPreferences: {
        shareTitle: true,
        shareCompany: true,
        shareEmail: true,
        sharePhone: true,
        shareProfileImage: true,
        shareSocialNetworks: true,
        shareSkills: true,
      },
      signer: {
        issuerDid: DID,
        publicKeyJwk: PUBLIC_JWK,
        signJwt: (_header, payload) => {
          signedPayloads.push(payload);
          return Promise.resolve('signed.vc.jwt');
        },
      },
    });

    expect(jwt).toBe('signed.vc.jwt');
    expect(signedPayloads).toHaveLength(1);

    const signed = signedPayloads[0] as {
      readonly jti: string;
      readonly iss: string;
      readonly sub: string;
      readonly iat: number;
      readonly nbf: number;
      readonly vc: {
        readonly '@context': readonly string[];
        readonly type: readonly string[];
        readonly credentialSubject: {
          readonly '@type': readonly string[];
          readonly subject_core: {
            readonly name: string;
            readonly nameType: string;
            readonly nameVerificationStatus: string;
            readonly businessCardId: string;
            readonly publicKeyJwk: PublicKeyJWK;
          };
          readonly verified_contact_claims?: {
            readonly jobTitle?: string;
            readonly worksFor?: { readonly '@type': string; readonly name: string };
            readonly email?: readonly string[];
            readonly telephone?: readonly string[];
            readonly image?: string;
            readonly contactPoint?: readonly unknown[];
            readonly fieldStatuses?: Record<string, string>;
          };
          readonly credential_meta: {
            readonly schemaVersion: number;
            readonly updatedAt: string;
          };
          readonly hasSkill?: readonly unknown[];
          readonly image?: string;
          readonly name: string;
          readonly businessCardId: string;
          readonly publicKeyJwk: PublicKeyJWK;
        };
      };
    };

    expect(signed.jti).toBe(`urn:uuid:${CREDENTIAL_ID}`);
    expect(signed.iss).toBe(DID);
    expect(signed.sub).toBe(DID);
    expect(signed.iat).toBe(1779712497);
    expect(signed.nbf).toBe(1779712497);
    expect(signed.vc['@context']).toEqual([
      'https://www.w3.org/2018/credentials/v1',
      'https://schema.org',
    ]);
    expect(signed.vc.type).toEqual([
      'VerifiableCredential',
      'BusinessCardCredential',
    ]);

    const subject = signed.vc.credentialSubject;
    expect(subject['@type']).toEqual(['Person', 'BusinessCardSubject']);
    expect(subject.subject_core).toEqual({
      name: 'Ada Lovelace',
      nameType: 'display_name',
      nameVerificationStatus: 'self_attested',
      businessCardId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      publicKeyJwk: PUBLIC_JWK,
    });
    expect(subject.verified_contact_claims).toMatchObject({
      jobTitle: 'Founder',
      worksFor: { '@type': 'Organization', name: 'Analytical Engines' },
      email: ['ada@example.com'],
      telephone: ['+1-555-0100'],
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'GitHub',
          identifier: 'ada',
          url: 'https://github.com/ada',
        },
      ],
      fieldStatuses: {
        company: 'self_attested',
        email: 'self_attested',
        name: 'self_attested',
        phone: 'self_attested',
        socialNetworks: 'self_attested',
        title: 'self_attested',
      },
    });
    expect(subject.verified_contact_claims?.image).toBeUndefined();
    expect(subject.hasSkill).toBeUndefined();
    expect(subject.image).toBeUndefined();
    expect(subject.credential_meta).toMatchObject({
      schemaVersion: 2,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });
    expect(subject.name).toBe('Ada Lovelace');
    expect(subject.businessCardId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(subject.publicKeyJwk).toEqual(PUBLIC_JWK);
  });

  it('falls back to plaintext envelope when DID signing is unavailable', async () => {
    const payload = await buildSolidarityQrPayloadAsync(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      signer: {
        issuerDid: DID,
        publicKeyJwk: PUBLIC_JWK,
        signJwt: () => Promise.reject(new Error('biometric cancelled')),
      },
    });

    const envelope = JSON.parse(payload) as { readonly format: string };
    expect(envelope.format).toBe('plaintext');
  });

  it('builds a didSigned envelope mirroring Swift QRCodeEnvelope shape', async () => {
    const envelope = await buildDidSignedEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      credentialId: CREDENTIAL_ID,
      sharingLevel: 'professional',
      signer: {
        issuerDid: DID,
        publicKeyJwk: PUBLIC_JWK,
        signJwt: () => Promise.resolve('signed.vc.jwt'),
      },
    });

    expect(envelope).not.toBeNull();
    if (!envelope) return;

    expect(envelope.format).toBe('didSigned');
    expect(envelope.version).toBe(2);
    expect(envelope.sharingLevel).toBe('professional');
    expect(envelope.shareId).toBe(SHARE_ID);
    expect(envelope.didSigned).toBeDefined();
    expect(envelope.didSigned?.jwt).toBe('signed.vc.jwt');
    expect(envelope.didSigned?.issuerDid).toBe(DID);
    expect(envelope.didSigned?.holderDid).toBe(DID);
    expect(envelope.didSigned?.shareId).toBe(envelope.shareId);
    expect(envelope.didSigned?.createdAt).toBe('2026-05-25T12:34:56Z');
    expect(envelope.plaintext).toBeUndefined();
    expect(envelope.encryptedPayload).toBeUndefined();
  });

  it('returns null from buildDidSignedEnvelope when no signer is provided', async () => {
    const envelope = await buildDidSignedEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
    });
    expect(envelope).toBeNull();
  });
});
