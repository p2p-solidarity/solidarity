import { beforeEach, describe, expect, it } from 'bun:test';

import {
  base64UrlEncode,
  utf8ToBytes,
  type BusinessCard,
  type PublicKeyJWK,
  type SharingPreferences,
} from '@solidarity/shared';

import type { StoredCredential } from '../../src/credentials/store';
import { createDidKeyBusinessCardCredential } from '../../src/credentials/didKeyCredential';

const NOW = new Date('2026-05-25T12:34:56.789Z');
const CREDENTIAL_ID = '22222222-3333-4444-8555-666666666666';
const DID = 'did:key:zSelfIssued';
const PUBLIC_JWK: PublicKeyJWK = {
  kty: 'EC',
  crv: 'P-256',
  alg: 'ES256',
  x: 'abc',
  y: 'def',
};

const signedPayloads: Record<string, unknown>[] = [];
const persistedCredentials: StoredCredential[] = [];

beforeEach(() => {
  signedPayloads.length = 0;
  persistedCredentials.length = 0;
});

function prefs(): SharingPreferences {
  return {
    publicFields: new Set(['name']),
    professionalFields: new Set(['name', 'title', 'company', 'email']),
    personalFields: new Set(['name', 'title', 'company', 'email', 'phone']),
    allowForwarding: false,
    expirationDate: undefined,
    useZK: false,
    sharingFormat: 'didSigned',
  };
}

function card(): BusinessCard {
  return {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'Ada Lovelace',
    title: 'Founder',
    company: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+1-555-0100',
    animal: 'dove',
    socialNetworks: [],
    skills: [],
    categories: ['computing'],
    sharingPreferences: prefs(),
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2026-05-20T00:00:00Z'),
    updatedAt: new Date('2026-05-24T00:00:00Z'),
  };
}

describe('createDidKeyBusinessCardCredential', () => {
  it('signs and persists a did:key BusinessCardCredential', async () => {
    const stored = await createDidKeyBusinessCardCredential(card(), {
      now: NOW,
      credentialId: CREDENTIAL_ID,
      signer: {
        issuerDid: DID,
        holderDid: DID,
        publicKeyJwk: PUBLIC_JWK,
        signJwt: (header, payload) => {
          signedPayloads.push(payload);
          return Promise.resolve([
            base64UrlEncode(utf8ToBytes(JSON.stringify(header))),
            base64UrlEncode(utf8ToBytes(JSON.stringify(payload))),
            'sig',
          ].join('.'));
        },
      },
      persistCredential: (credential) => {
        persistedCredentials.push(credential);
        return Promise.resolve();
      },
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

    expect(stored).toMatchObject({
      id: CREDENTIAL_ID,
      type: 'business_card',
      title: 'Business Card',
      issuerDid: DID,
      holderDid: DID,
      trustLevel: 'L1',
      issuedAt: new Date('2026-05-25T12:34:57.000Z'),
      metadataTags: ['jwt_vc_json', 'did:key', 'self_issued'],
    });
    expect(stored.rawJwt.split('.')).toHaveLength(3);
    expect(signedPayloads).toHaveLength(1);
    expect(signedPayloads[0]?.['jti']).toBe(`urn:uuid:${CREDENTIAL_ID}`);
    expect(
      (signedPayloads[0]?.['vc'] as { readonly type?: readonly string[] } | undefined)?.type
    ).toEqual(['VerifiableCredential', 'BusinessCardCredential']);
    expect(persistedCredentials).toEqual([stored]);
  });
});
