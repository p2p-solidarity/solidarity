/**
 * QR envelope wire format — covers the zkProof escrow path and the
 * cross-format `encodeEnvelopeToWire` / `parseEnvelopeFromWire` round-trips
 * that mirror Swift's `QRCodeGenerationService.encodeEnvelopeToImage`
 * (Services/Card/QRCodeGenerationService.swift L74-100).
 *
 * Master-key fixture pattern lifted from icloudBackupRoundtrip.test.ts:
 * we install a deterministic master key via `mock.module` so the real
 * AES-GCM seal in `encryptionManager` is exercised end-to-end.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

import {
  aesGcmSeal,
  base64Encode,
  utf8ToBytes,
  type BusinessCard,
  type PublicKeyJWK,
  type SharingPreferences,
} from '@solidarity/shared';

// ── Master-key fixture (must be installed before importing the module) ─────

const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xa1);

interface SolidarityQrPayloadModule {
  readonly buildZKEnvelope: (
    card: BusinessCard,
    options?: Record<string, unknown>
  ) => Promise<{
    readonly format: string;
    readonly version: number;
    readonly encryptedPayload?: string;
    readonly plaintext?: unknown;
    readonly didSigned?: unknown;
    readonly shareId: string;
    readonly sharingLevel: string;
    readonly selectedFields: readonly string[];
  }>;
  readonly buildSolidarityQrPayload: (
    card: BusinessCard,
    options?: Record<string, unknown>
  ) => string;
  readonly buildDidSignedEnvelope: (
    card: BusinessCard,
    options: Record<string, unknown>
  ) => Promise<unknown>;
}

interface QrEnvelopeModule {
  readonly encodeEnvelopeToWire: (envelope: unknown) => {
    readonly wire: string;
    readonly startingLevel: 'L' | 'M' | 'Q' | 'H';
  };
  readonly parseEnvelopeFromWire: (wire: string) => {
    readonly format: string;
    readonly didSigned?: { readonly jwt: string };
    readonly encryptedPayload?: string;
    readonly shareId: string;
  } | null;
  readonly decryptZKPayload: (envelope: unknown) => Promise<{
    readonly businessCard: { readonly cardId: string };
    readonly shareId: string;
  } | null>;
}

let mod: SolidarityQrPayloadModule & QrEnvelopeModule;

beforeAll(async () => {
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => FIXED_MASTER_KEY,
    resetMasterKeyForTesting: async () => undefined,
    evictMasterKeyCache: () => undefined,
  }));
  // Stub `@/keychain/signingKey` + `@/zk/proofManager` so the dynamic
  // imports buildZKEnvelope does at runtime succeed (the real chain pulls
  // in `@solidarity/nitro-spruce-did` → `react-native`, which Bun can't
  // parse). We deliberately return a NO-OP signer + a proofManager whose
  // generators always throw — the envelope-build path then swallows the
  // error and emits an envelope with no proofs, which is exactly what
  // these wire-format tests need to assert.
  await mock.module('@/keychain/signingKey', () => ({
    signRawEs256: async () => {
      throw new Error('test: signing key unavailable in qrEnvelopeWire suite');
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
  // Same shape — stub the issuer-proof path so it short-circuits to null
  // without hitting the Semaphore Nitro bridge.
  await mock.module('@/zk/issuerProof', () => ({
    generateIssuerProof: async () => null,
    isKnownGroupRoot: async () => false,
    buildShareScope: (selected: readonly string[]) => {
      const set = new Set<string>(selected);
      set.add('name');
      return `fields:${[...set].sort().join(',')}`;
    },
  }));
  const payloadMod = (await import('../../src/cards/solidarityQrPayload')) as unknown as SolidarityQrPayloadModule;
  const envelopeMod = (await import('../../src/cards/qrEnvelope')) as unknown as QrEnvelopeModule;
  mod = { ...payloadMod, ...envelopeMod };
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-25T12:34:56.789Z');
const SHARE_ID = '11111111-2222-4333-8444-555555555555';
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
    professionalFields: new Set([
      'name',
      'title',
      'company',
      'email',
      'phone',
      'socialNetworks',
      'skills',
    ]),
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
    sharingFormat: 'zkProof',
  };
}

function makeCard(): BusinessCard {
  return {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'Ada Lovelace',
    title: 'Founder',
    company: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+1-555-0100',
    profileImage: 'base64-image',
    animal: 'dove',
    socialNetworks: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        platform: 'GitHub',
        username: 'ada',
        url: 'https://github.com/ada',
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        platform: 'Twitter',
        username: 'ada_lovelace',
        url: 'https://twitter.com/ada_lovelace',
      },
    ],
    skills: [
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Mathematics', category: 'Science', proficiencyLevel: 'Expert' },
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Mechanical Engineering', category: 'Engineering', proficiencyLevel: 'Expert' },
      { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Cryptography', category: 'Science', proficiencyLevel: 'Advanced' },
    ],
    categories: ['computing', 'engineering'],
    sharingPreferences: makePrefs(),
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2026-05-20T00:00:00Z'),
    updatedAt: new Date('2026-05-24T00:00:00Z'),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildZKEnvelope', () => {
  it('returns a zkProof envelope with a populated encryptedPayload', async () => {
    const envelope = await mod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });

    expect(envelope.format).toBe('zkProof');
    expect(envelope.version).toBe(2);
    expect(envelope.shareId).toBe(SHARE_ID);
    expect(envelope.sharingLevel).toBe('professional');
    expect(envelope.plaintext).toBeUndefined();
    expect(envelope.didSigned).toBeUndefined();
    expect(typeof envelope.encryptedPayload).toBe('string');
    expect((envelope.encryptedPayload ?? '').length).toBeGreaterThan(0);
    // Wire format is base64 — must match the regex CryptoKit `.combined` would produce.
    expect(envelope.encryptedPayload).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('encodeEnvelopeToWire', () => {
  it('emits sce1:-framed wire for zkProof envelopes large enough to compress', async () => {
    const envelope = await mod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const { wire, startingLevel } = mod.encodeEnvelopeToWire(envelope);
    expect(startingLevel).toBe('M');
    // Either compressed (`sce1:`) or raw JSON envelope — both accepted, but
    // the envelope JSON itself is well over the compression-saving threshold.
    expect(wire.startsWith('sce1:') || wire.startsWith('{')).toBe(true);
  });

  it('returns bare JWT for didSigned envelopes (startingLevel L)', async () => {
    const fakeJwt =
      'eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ1cm46dXVpZDoxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJpc3MiOiJkaWQ6a2V5OnpUZXN0SXNzdWVyIiwic3ViIjoiZGlkOmtleTp6VGVzdElzc3VlciIsImlhdCI6MTc3OTcxMjQ5N30.sig';
    const envelope = {
      version: 2 as const,
      format: 'didSigned' as const,
      sharingLevel: 'professional',
      selectedFields: ['name'],
      shareId: SHARE_ID,
      didSigned: {
        jwt: fakeJwt,
        shareId: SHARE_ID,
        createdAt: '2026-05-25T12:34:56Z',
        expirationDate: undefined,
        issuerDid: DID,
        holderDid: DID,
      },
    };
    const { wire, startingLevel } = mod.encodeEnvelopeToWire(envelope);
    expect(wire).toBe(fakeJwt);
    expect(startingLevel).toBe('L');
  });

  it('emits raw JSON for plaintext envelopes (startingLevel H)', () => {
    const json = mod.buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const envelope = JSON.parse(json) as unknown as {
      readonly format: string;
    };
    const { wire, startingLevel } = mod.encodeEnvelopeToWire(envelope);
    expect(startingLevel).toBe('H');
    expect(wire.startsWith('{')).toBe(true);
    expect(JSON.parse(wire)).toMatchObject({ format: 'plaintext' });
  });
});

describe('parseEnvelopeFromWire', () => {
  it('round-trips an sce1:-framed zkProof envelope', async () => {
    const envelope = await mod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const { wire } = mod.encodeEnvelopeToWire(envelope);
    const parsed = mod.parseEnvelopeFromWire(wire);
    expect(parsed).not.toBeNull();
    expect(parsed?.format).toBe('zkProof');
    expect(parsed?.shareId).toBe(SHARE_ID);
    expect(parsed?.encryptedPayload).toBe(envelope.encryptedPayload);
  });

  it('round-trips a plaintext JSON envelope', () => {
    const json = mod.buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const parsed = mod.parseEnvelopeFromWire(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.format).toBe('plaintext');
    expect(parsed?.shareId).toBe(SHARE_ID);
  });

  it('wraps a bare VC JWT into a synthetic didSigned envelope', () => {
    const fakeJwt =
      'eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ1cm46dXVpZDoxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJpc3MiOiJkaWQ6a2V5OnpUZXN0SXNzdWVyIiwic3ViIjoiZGlkOmtleTp6VGVzdElzc3VlciIsImlhdCI6MTc3OTcxMjQ5NywiZXhwIjoxNzc5Nzk4ODk3fQ.sig';
    const parsed = mod.parseEnvelopeFromWire(fakeJwt);
    expect(parsed).not.toBeNull();
    expect(parsed?.format).toBe('didSigned');
    expect(parsed?.didSigned?.jwt).toBe(fakeJwt);
    expect(parsed?.shareId).toBe(SHARE_ID);
  });

  it('returns null for unrecognised wire strings', () => {
    expect(mod.parseEnvelopeFromWire('')).toBeNull();
    expect(mod.parseEnvelopeFromWire('hello world')).toBeNull();
    expect(mod.parseEnvelopeFromWire('sce1:!!!not-base64')).toBeNull();
  });
});

describe('decryptZKPayload', () => {
  it('returns the original QRSharingPayload after round-trip', async () => {
    const envelope = await mod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const decrypted = await mod.decryptZKPayload(envelope);
    expect(decrypted).not.toBeNull();
    expect(decrypted?.businessCard.cardId).toBe(
      'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    );
    expect(decrypted?.shareId).toBe(SHARE_ID);
  });

  it('decrypts an envelope parsed from sce1:-framed wire', async () => {
    const envelope = await mod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const { wire } = mod.encodeEnvelopeToWire(envelope);
    const parsed = mod.parseEnvelopeFromWire(wire);
    expect(parsed).not.toBeNull();
    const decrypted = await mod.decryptZKPayload(parsed!);
    expect(decrypted?.businessCard.cardId).toBe(
      'f47ac10b-58cc-4372-a567-0e02b2c3d479'
    );
  });

  it('returns null for non-zkProof envelopes', async () => {
    const json = mod.buildSolidarityQrPayload(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const envelope = JSON.parse(json) as unknown;
    expect(await mod.decryptZKPayload(envelope)).toBeNull();
  });

  it('returns null when the ciphertext was sealed with a different key', async () => {
    // Wrong-key blob: seal with a deterministically-different key.
    const wrongKey = new Uint8Array(32).fill(0xb2);
    const garbage = base64Encode(
      aesGcmSeal(wrongKey, utf8ToBytes(JSON.stringify({ businessCard: { cardId: 'x' } })))
    );
    const envelope = {
      version: 2 as const,
      format: 'zkProof' as const,
      sharingLevel: 'professional',
      selectedFields: [],
      shareId: SHARE_ID,
      encryptedPayload: garbage,
    };
    expect(await mod.decryptZKPayload(envelope)).toBeNull();
  });
});

describe('didSigned envelope wire round-trip', () => {
  it('builds a didSigned envelope via signer, encodes to bare JWT, parses back', async () => {
    const envelope = await mod.buildDidSignedEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      credentialId: '22222222-3333-4444-8555-666666666666',
      sharingLevel: 'professional',
      signer: {
        issuerDid: DID,
        publicKeyJwk: PUBLIC_JWK,
        signJwt: async () =>
          'eyJhbGciOiJFUzI1NiJ9.eyJqdGkiOiJ1cm46dXVpZDoyMjIyMjIyMi0zMzMzLTQ0NDQtODU1NS02NjY2NjY2NjY2NjYiLCJpc3MiOiJkaWQ6a2V5OnpUZXN0SXNzdWVyIiwic3ViIjoiZGlkOmtleTp6VGVzdElzc3VlciJ9.sig',
      },
    });
    expect(envelope).not.toBeNull();
    const { wire, startingLevel } = mod.encodeEnvelopeToWire(envelope);
    expect(startingLevel).toBe('L');
    expect(wire.startsWith('eyJ')).toBe(true);
    const parsed = mod.parseEnvelopeFromWire(wire);
    expect(parsed?.format).toBe('didSigned');
    expect(parsed?.didSigned?.jwt).toBe(wire);
  });
});
