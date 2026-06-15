/**
 * Envelope handler — exercises the receive-side dispatch built on top of
 * `parseEnvelopeFromWire` + `decryptZKPayload`. We round-trip every format
 * the sender produces (plaintext / zkProof / didSigned) so the test doubles
 * as a parity oracle: any divergence between sender + receiver breaks here.
 *
 * Master-key fixture pattern lifted from qrEnvelopeWire.test.ts so the real
 * AES-GCM seal is exercised end-to-end without an Expo runtime.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

import type * as SolidarityQrPayloadModule from '../../src/cards/solidarityQrPayload';
import type * as QrEnvelopeModule from '../../src/cards/qrEnvelope';
import type * as EnvelopeHandlerModule from '../../src/scan/envelopeHandler';

import {
  generateP256KeyPair,
  publicKeyToJwk,
  signJwtEs256,
  type BusinessCard,
  type PublicKeyJWK,
  type SharingPreferences,
} from '@solidarity/shared';

const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xa1);

let payloadMod: typeof SolidarityQrPayloadModule;
let envelopeMod: typeof QrEnvelopeModule;
let handlerMod: typeof EnvelopeHandlerModule;

beforeAll(async () => {
  // Process-wide mocks: bun caches mock.module registrations across test
  // files, so any file that doesn't intercept these chains can pollute the
  // module cache for files that run later (specifically: `expo-secure-store`
  // pulls in `react-native/index.js` which uses Flow's `import typeof`,
  // and Bun's parser rejects it).
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => FIXED_MASTER_KEY,
    resetMasterKeyForTesting: async () => undefined,
    evictMasterKeyCache: () => undefined,
  }));
  await mock.module('@/keychain/signingKey', () => ({
    signRawEs256: async () => {
      throw new Error('test: signing key unavailable in envelopeHandler suite');
    },
    wrapRawSigningInputForSpruce: (p: Uint8Array) => p,
    ensureSigningKey: async () => {
      throw new Error('test: signing key unavailable');
    },
    publicJwk: async () => {
      throw new Error('test: signing key unavailable');
    },
    signJwt: async () => 'signed.jwt.fake',
    didKeyForCurrentIdentity: async () => 'did:key:zTestStub',
    resetSigningKeyForTesting: async () => undefined,
  }));
  await mock.module('@/zk/issuerProof', () => ({
    generateIssuerProof: async () => null,
    buildShareScope: (selected: readonly string[]) => {
      const set = new Set<string>(selected);
      set.add('name');
      return `fields:${[...set].sort().join(',')}`;
    },
  }));
  payloadMod = await import('../../src/cards/solidarityQrPayload');
  envelopeMod = await import('../../src/cards/qrEnvelope');
  handlerMod = await import('../../src/scan/envelopeHandler');
});

const NOW = new Date('2026-05-25T12:34:56.789Z');
const SHARE_ID = '11111111-2222-4333-8444-555555555555';
const CREDENTIAL_ID = '22222222-3333-4444-8555-666666666666';
const CARD_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const DID = 'did:key:zTestIssuer';

function makePrefs(): SharingPreferences {
  return {
    publicFields: new Set(['name', 'title', 'company']),
    professionalFields: new Set([
      'name',
      'title',
      'company',
      'email',
      'phone',
    ]),
    personalFields: new Set([
      'name',
      'title',
      'company',
      'email',
      'phone',
      'socialNetworks',
    ]),
    allowForwarding: false,
    expirationDate: undefined,
    useZK: true,
    sharingFormat: 'zkProof',
  };
}

function makeCard(): BusinessCard {
  return {
    id: CARD_ID,
    name: 'Ada Lovelace',
    title: 'Founder',
    company: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+1-555-0100',
    profileImage: undefined,
    animal: 'dove',
    socialNetworks: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        platform: 'GitHub',
        username: 'ada',
        url: 'https://github.com/ada',
      },
    ],
    skills: [],
    categories: ['computing'],
    sharingPreferences: makePrefs(),
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2026-05-20T00:00:00Z'),
    updatedAt: new Date('2026-05-24T00:00:00Z'),
  };
}

describe('handleScannedPayload — plaintext envelope', () => {
  it('rebuilds a BusinessCard from a plaintext snapshot', async () => {
    const wire = payloadMod.buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('card');
    expect(outcome.card?.id).toBe(CARD_ID);
    expect(outcome.card?.name).toBe('Ada Lovelace');
    expect(outcome.card?.title).toBe('Founder');
    expect(outcome.card?.email).toBe('ada@example.com');
    expect(outcome.verificationStatus).toBe('Unverified');
  });

  it('rejects an expired plaintext envelope', async () => {
    const wire = payloadMod.buildSolidarityQrPayload(makeCard(), {
      now: new Date('2020-01-01T00:00:00Z'),
      shareId: SHARE_ID,
      sharingLevel: 'professional',
      expirationDate: new Date('2020-01-02T00:00:00Z'),
    });
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('error');
    expect(outcome.errorMessage).toContain('expired');
  });
});

describe('handleScannedPayload — zkProof envelope', () => {
  it('decrypts the encrypted payload back into a BusinessCard', async () => {
    const envelope = await payloadMod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const { wire } = envelopeMod.encodeEnvelopeToWire(envelope);
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('card');
    expect(outcome.card?.id).toBe(CARD_ID);
    expect(outcome.card?.name).toBe('Ada Lovelace');
    // No sd/issuer proofs in the zkProof envelope built by our sender →
    // `Unverified`, not `Verified`.
    expect(outcome.verificationStatus).toBe('Unverified');
  });

  it('returns an error when ciphertext cannot be decrypted', async () => {
    // Forge a zkProof envelope with garbage ciphertext.
    const garbageEnvelope = JSON.stringify({
      version: 2,
      format: 'zkProof',
      sharingLevel: 'professional',
      selectedFields: [],
      shareId: SHARE_ID,
      encryptedPayload: 'AAAAAAAAAAAAAAAAAAAAAAAA',
    });
    const outcome = await handlerMod.handleScannedPayload(garbageEnvelope);
    expect(outcome.kind).toBe('error');
    expect(outcome.errorMessage).toContain('decrypt');
  });
});

describe('handleScannedPayload — didSigned (bare JWT)', () => {
  it('verifies a signature-valid JWT and emits Verified', async () => {
    const { jwt, publicKeyJwk } = signTestVcJwt({
      iss: DID,
      sub: DID,
      cardId: CARD_ID,
      name: 'Ada Lovelace',
    });
    void publicKeyJwk;
    const outcome = await handlerMod.handleScannedPayload(jwt);
    expect(outcome.kind).toBe('card');
    expect(outcome.card?.id).toBe(CARD_ID);
    expect(outcome.card?.name).toBe('Ada Lovelace');
    expect(outcome.verificationStatus).toBe('Verified');
  });

  it('returns Failed when the signature is tampered', async () => {
    const { jwt } = signTestVcJwt({
      iss: DID,
      sub: DID,
      cardId: CARD_ID,
      name: 'Ada Lovelace',
    });
    const parts = jwt.split('.');
    // Replace the signature with a deterministically-different 64-byte
    // string. Any single-char nudge could still be a valid signature for
    // a different curve point pair, so flip an entire segment.
    const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(86)}`;
    const outcome = await handlerMod.handleScannedPayload(tampered);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Failed');
  });
});

describe('handleScannedPayload — fast paths', () => {
  it('classifies openid4vp:// as an OIDC request', async () => {
    const url = 'openid4vp://present?client_id=demo&request_uri=https://example.com/r';
    const outcome = await handlerMod.handleScannedPayload(url);
    expect(outcome.kind).toBe('oidc-request');
    expect(outcome.oidcPayload).toBe(url);
  });

  it('returns unknown for random strings', async () => {
    expect((await handlerMod.handleScannedPayload('hello world')).kind).toBe('unknown');
    expect((await handlerMod.handleScannedPayload('')).kind).toBe('unknown');
  });

  it('returns unknown for solidarity:// deep links (legacy handler takes over)', async () => {
    expect(
      (await handlerMod.handleScannedPayload(`solidarity://card/${CARD_ID}`)).kind
    ).toBe('unknown');
  });
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function signTestVcJwt(args: {
  readonly iss: string;
  readonly sub: string;
  readonly cardId: string;
  readonly name: string;
}): { readonly jwt: string; readonly publicKeyJwk: PublicKeyJWK } {
  const { privateKey, publicKey } = generateP256KeyPair();
  const jwk = publicKeyToJwk(publicKey);
  const iat = Math.round(NOW.getTime() / 1000);
  const payload: Record<string, unknown> = {
    jti: `urn:uuid:${CREDENTIAL_ID}`,
    iss: args.iss,
    sub: args.sub,
    iat,
    nbf: iat,
    vc: {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://schema.org'],
      type: ['VerifiableCredential', 'BusinessCardCredential'],
      credentialSubject: {
        id: args.sub,
        '@type': ['Person', 'BusinessCardSubject'],
        subject_core: {
          name: args.name,
          nameType: 'display_name',
          nameVerificationStatus: 'self_attested',
          businessCardId: args.cardId,
          publicKeyJwk: jwk,
        },
        name: args.name,
        businessCardId: args.cardId,
        publicKeyJwk: jwk,
      },
    },
  };
  const jwt = signJwtEs256({ alg: 'ES256' }, payload, privateKey);
  return { jwt, publicKeyJwk: jwk };
}

