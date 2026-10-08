/**
 * CRD1 wire — app-side integration: the card share emits a CRD1 COSE_Sign1
 * wire whose claims equal the legacy VC-JWT payload, the scanner verifies +
 * rebuilds a card from it (and from an evidence pack), tampering and
 * holder-binding violations fail closed, and the legacy wires keep parsing.
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';
import {
  didKeyFromPublicKey,
  encodeCrd1,
  hexToBytes,
  publicKeyFromPrivate,
  publicKeyToJwk,
  sha256Bytes,
  unwrap,
  type BusinessCard,
} from '@solidarity/shared';

import { buildCrd1CardWire, verifyCrd1Wire } from '@/cards/crd1Envelope';
import {
  buildEvidencePackClaims,
  buildEvidencePackRows,
  estimateEvidencePack,
  signEvidencePack,
  EVIDENCE_PACK_TYP,
  type EvidencePackSource,
} from '@/cards/evidencePack';
import { parseQrPayload } from '@/cards/qrCodeManager';
import type { SolidarityQrSigner } from '@/cards/solidarityQrTypes';
import { handleScannedPayload } from '@/scan/envelopeHandler';

// TEST-ONLY scalar — same fixture family as packages/shared/test/crd1.test.ts.
const TEST_PRIV = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
const TEST_PUB = publicKeyFromPrivate(TEST_PRIV);
const TEST_DID = didKeyFromPublicKey(TEST_PUB);
const OTHER_PRIV = hexToBytes('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f');
const OTHER_DID = didKeyFromPublicKey(publicKeyFromPrivate(OTHER_PRIV));

const signRaw = async (message: Uint8Array): Promise<Uint8Array> =>
  p256.sign(sha256Bytes(message), TEST_PRIV, { prehash: false });

const signer: SolidarityQrSigner = {
  issuerDid: TEST_DID,
  publicKeyJwk: publicKeyToJwk(TEST_PUB),
  signJwt: () => Promise.reject(new Error('JWT path must not run in these tests')),
  signRaw,
};

function card(): BusinessCard {
  const now = new Date('2026-08-19T10:00:00Z');
  return {
    id: 'b6bfe4a5-9df1-4f0f-9e9a-6a1a54d7a001',
    name: 'Gimmy Chang',
    title: 'Organizer',
    company: 'Solidarity',
    email: 'gm@solidarity.gg',
    phone: '+886900000000',
    profileImage: undefined,
    animal: undefined,
    socialNetworks: [
      {
        id: 'b6bfe4a5-9df1-4f0f-9e9a-6a1a54d7a002',
        platform: 'GitHub',
        username: 'gimmy',
        url: 'https://github.com/gimmy',
      },
    ],
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(['name', 'email']),
      professionalFields: new Set(['name', 'title', 'company', 'email']),
      personalFields: new Set(['name']),
      allowForwarding: true,
      expirationDate: undefined,
      useZK: false,
      sharingFormat: 'didSigned',
    },
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: now,
    updatedAt: now,
  };
}

describe('CRD1 card wire', () => {
  it('emits a CRD1 wire at EC level Q that the scanner verifies into a card', async () => {
    const wire = await buildCrd1CardWire(card(), { signer, sharingLevel: 'professional' });
    expect(wire).not.toBeNull();
    if (!wire) return;
    expect(wire.wire.startsWith('CRD1:')).toBe(true);
    expect(wire.startingLevel).toBe('Q');
    expect(wire.chars).toBeLessThanOrEqual(2420);

    expect(parseQrPayload(wire.wire).kind).toBe('card');

    const outcome = await handleScannedPayload(wire.wire);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Verified');
    expect(outcome.card?.name).toBe('Gimmy Chang');
    expect(outcome.card?.company).toBe('Solidarity');
  });

  it('claims carry the same iss/holder binding the JWT path had', async () => {
    const wire = await buildCrd1CardWire(card(), { signer });
    if (!wire) throw new Error('expected wire');
    const verified = unwrap(verifyCrd1Wire(wire.wire));
    expect(verified.did).toBe(TEST_DID);
    expect(verified.claims.iss).toBe(TEST_DID);
    expect(verified.claims['sub']).toBe(TEST_DID);
    // 30-day cap applied even though the card set no expiry.
    expect(verified.claims.exp - verified.claims.iat).toBeLessThanOrEqual(30 * 86400);
  });

  it('returns null (legacy fallback) when the signer lacks signRaw', async () => {
    const legacyOnly: SolidarityQrSigner = { ...signer, signRaw: undefined };
    expect(await buildCrd1CardWire(card(), { signer: legacyOnly })).toBeNull();
  });

  it('rejects a wire signed by a key that does not match its embedded subject key', async () => {
    // Signer claims TEST_DID's identity JWK but signs with OTHER key AND
    // frames under OTHER's kid — envelope verifies, holder binding must not.
    const mismatched: SolidarityQrSigner = {
      issuerDid: OTHER_DID,
      publicKeyJwk: publicKeyToJwk(TEST_PUB),
      signJwt: () => Promise.reject(new Error('unused')),
      signRaw: async (message) => p256.sign(sha256Bytes(message), OTHER_PRIV, { prehash: false }),
    };
    const wire = await buildCrd1CardWire(card(), { signer: mismatched });
    if (!wire) throw new Error('expected wire');
    const verified = verifyCrd1Wire(wire.wire);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error).toContain('subject key');

    const outcome = await handleScannedPayload(wire.wire);
    expect(outcome.kind).toBe('error');
  });

  it('rejects a present but malformed embedded subject key', async () => {
    const now = Math.floor(Date.now() / 1000);
    const encoded = await encodeCrd1(
      {
        iss: TEST_DID,
        sub: TEST_DID,
        iat: now,
        exp: now + 60,
        vc: {
          credentialSubject: {
            subject_core: {
              publicKeyJwk: {
                ...publicKeyToJwk(TEST_PUB),
                kty: 'RSA',
              },
            },
            // A valid duplicate must not turn the malformed preferred key
            // into an apparently absent holder-binding claim.
            publicKeyJwk: publicKeyToJwk(TEST_PUB),
          },
        },
      },
      TEST_DID,
      signRaw
    );
    if (!encoded.ok) throw new Error('expected wire');

    const verified = verifyCrd1Wire(encoded.wire);
    expect(verified).toEqual({ ok: false, error: 'embedded subject key is malformed' });

    const outcome = await handleScannedPayload(encoded.wire);
    expect(outcome.kind).toBe('error');
  });

  it('rejects a tampered wire at scan time', async () => {
    const wire = await buildCrd1CardWire(card(), { signer });
    if (!wire) throw new Error('expected wire');
    const body = wire.wire.slice('CRD1:'.length);
    const tampered = `CRD1:${body.slice(1)}${body.slice(0, 1)}`;
    const outcome = await handleScannedPayload(tampered);
    expect(outcome.kind).toBe('error');
  });

  it('still routes legacy wires (JSON envelope, sce1, JWT-shaped) as before', async () => {
    expect((await handleScannedPayload('{"nonsense":true}')).kind).toBe('unknown');
    expect((await handleScannedPayload('sce1:not-a-real-payload')).kind).toBe('unknown');
    expect(parseQrPayload('BEGIN:VCARD').kind).toBe('card');
  });
});

describe('evidence pack', () => {
  const source: EvidencePackSource = {
    record: {
      v: 1,
      did: TEST_DID,
      displayName: 'Gimmy',
      avatar: null,
      bio: '',
      links: [
        { label: 'Blog', url: 'https://gimmy.blog' },
        { label: '', url: 'https://example.com/x' },
      ],
      alsoKnownAs: [],
      badges: [],
      supersededBy: null,
      updatedAt: '2026-08-19T00:00:00Z',
    },
    username: 'gimmy',
    nostr: {
      checkedAt: Date.parse('2026-08-19T09:00:00Z'),
      result: {
        state: 'verified',
        npub: 'npub1exampleexampleexampleexampleexampleexampleexampleexample',
        evidence: {
          kind0CreatedAt: 1755500000,
          reason: 'kind-0 reciprocates the did',
        } as never,
      },
    },
    atproto: {
      checkedAt: Date.parse('2026-08-19T08:00:00Z'),
      result: {
        state: 'stale',
        handle: 'gimmy.bsky.social',
        evidence: {
          repoDid: null,
          recordUri: null,
          direction1: true,
          direction2: null,
          reason: 'lapsed',
        } as never,
      },
    },
  };

  it('marks only cache-verified bindings as verified; links stay declared', () => {
    const rows = buildEvidencePackRows(source);
    const nostr = rows.find((row) => row.id.startsWith('binding:nostr'));
    const bluesky = rows.find((row) => row.id.startsWith('binding:bluesky'));
    const links = rows.filter((row) => row.kind === 'link');
    expect(nostr?.status).toBe('verified');
    expect(nostr?.checkedAt).toBe(Math.floor(Date.parse('2026-08-19T09:00:00Z') / 1000));
    expect(bluesky?.status).toBe('declared');
    expect(bluesky?.checkedAt).toBeUndefined();
    expect(links.every((row) => row.status === 'declared')).toBe(true);
    // Unlabelled links fall back to their URL as the label.
    expect(links[1]?.label).toBe('https://example.com/x');
  });

  it('estimates without signing, then signs a scannable pack', async () => {
    const rows = buildEvidencePackRows(source);
    const estimated = estimateEvidencePack(source, rows);
    expect(estimated.ok).toBe(true);

    const signed = await signEvidencePack(source, rows, signRaw);
    if (!signed.ok) throw new Error('expected in-capacity pack');
    if (!estimated.ok) return;
    expect(Math.abs(estimated.chars - signed.chars)).toBeLessThanOrEqual(12);

    const outcome = await handleScannedPayload(signed.wire);
    expect(outcome.kind).toBe('card');
    // The pack signature authenticates the issuer, but declared rows remain
    // declarations and must not produce the app's green verified seal.
    expect(outcome.verificationStatus).toBe('Unverified');
    expect(outcome.card?.name).toBe('Gimmy');
    expect(outcome.card?.socialNetworks.some((s) => s.url === 'https://gimmy.blog')).toBe(true);
  });

  it('claims carry the pack type, 30-day window, and per-row honesty fields', () => {
    const rows = buildEvidencePackRows(source);
    const claims = buildEvidencePackClaims(source, rows, new Date('2026-08-19T12:00:00Z'));
    expect(claims.typ).toBe(EVIDENCE_PACK_TYP);
    expect(claims.exp - claims.iat).toBe(30 * 86400);
    expect(claims.username).toBe('gimmy');
    const verifiedRows = claims.claims.filter((row) => row.status === 'verified');
    expect(verifiedRows.every((row) => row.method !== undefined && row.checkedAt !== undefined)).toBe(true);
    const declaredRows = claims.claims.filter((row) => row.status === 'declared');
    expect(declaredRows.every((row) => row.method === undefined && row.checkedAt === undefined)).toBe(true);
  });

  it('uses Verified only for a non-empty pack whose claim rows are all verified', async () => {
    const verifiedOnlySource: EvidencePackSource = {
      ...source,
      record: { ...source.record, links: [] },
      atproto: null,
    };
    const verifiedRows = buildEvidencePackRows(verifiedOnlySource);
    expect(verifiedRows.length).toBe(1);
    expect(verifiedRows.every((row) => row.status === 'verified')).toBe(true);

    const verifiedPack = await signEvidencePack(verifiedOnlySource, verifiedRows, signRaw);
    if (!verifiedPack.ok) throw new Error('expected verified-only pack');
    const verifiedOutcome = await handleScannedPayload(verifiedPack.wire);
    expect(verifiedOutcome.verificationStatus).toBe('Verified');

    const emptyPack = await signEvidencePack(verifiedOnlySource, [], signRaw);
    if (!emptyPack.ok) throw new Error('expected empty pack');
    const emptyOutcome = await handleScannedPayload(emptyPack.wire);
    expect(emptyOutcome.verificationStatus).toBe('Unverified');
  });
});
