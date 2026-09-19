/**
 * Envelope handler — exercises the receive-side dispatch built on top of
 * `parseEnvelopeFromWire` + `decryptZKPayload`. We round-trip every format
 * the sender produces (plaintext / zkProof / didSigned) so the test doubles
 * as a parity oracle: any divergence between sender + receiver breaks here.
 *
 * Master-key fixture pattern lifted from qrEnvelopeWire.test.ts so the real
 * AES-GCM seal is exercised end-to-end without an Expo runtime.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

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
    // T7 conflict surface — mocks stay export-complete (A5.3 lesson: a
    // partial module mock poisons real-import files in the same run).
    hasExistingSigningKey: async () => false,
    listSyncableSigningKeys: async () => [],
    resolveSigningKeyConflict: async () => ({ ok: false, error: 'test: unavailable' }),
  }));
  await mock.module('@/zk/issuerProof', () => ({
    generateIssuerProof: async () => null,
    isKnownGroupRoot: async () => false,
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

const NOW = new Date('2027-05-25T12:34:56.789Z');
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
  readonly subscription?: Record<string, unknown>;
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
        ...(args.subscription ? { subscription: args.subscription } : {}),
        name: args.name,
        businessCardId: args.cardId,
        publicKeyJwk: jwk,
      },
    },
  };
  const jwt = signJwtEs256({ alg: 'ES256' }, payload, privateKey);
  return { jwt, publicKeyJwk: jwk };
}

// ── issuerProof wire: anonymity + shape + envelope binding ─────────────────
//
// Guards two hard-won properties:
//   1. Anonymity (lists-anonymity audit 2026-08-18 §5): the sender's
//      Semaphore commitment must NEVER appear in the shared payload — a
//      commitment beside a roster identifies the presenter. The audit asks
//      for a test holding this line, not just a code comment.
//   2. Wire shape + binding: the wire carries the FULL SemaphoreProof
//      envelope; the scanner accepts it (and the legacy inner-JSON shape)
//      and only lets a proof verify when its scope/signal bind to THIS
//      envelope's scope/shareId.

describe('handleScannedPayload — zkProof envelope with issuerProof', () => {
  // Must equal buildShareScopeInline(selectedFields) for makeCard() at the
  // 'professional' level (this file's professionalFields, minus profileImage,
  // plus the always-present 'name', sorted).
  const PROOF_SCOPE = 'fields:company,email,name,phone,title';
  const INNER_PROOF_JSON = JSON.stringify({
    merkle_tree_depth: 16,
    merkle_tree_root: '222',
    nullifier: '111',
    message: 'inner-message',
    scope: 'inner-scope',
    points: [],
  });
  const receivedProofs: { proofJson?: unknown }[] = [];

  function fullProofJson(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      nullifier: '111',
      merkleRoot: '222',
      scope: PROOF_SCOPE,
      signal: SHARE_ID,
      proofJson: INNER_PROOF_JSON,
      merkleTreeDepth: 16,
      ...overrides,
    });
  }

  async function setIssuerProofMock(proofWire: string | null): Promise<void> {
    await mock.module('@/zk/issuerProof', () => ({
      generateIssuerProof: async () =>
        proofWire === null ? null : { proof: proofWire },
      // Provenance oracle for these tests: only merkleRoot '222' names a
      // group "this device" holds (05-spec §6-8).
      isKnownGroupRoot: async (root: string) => root === '222',
      buildShareScope: (selected: readonly string[]) => {
        const set = new Set<string>(selected);
        set.add('name');
        return `fields:${[...set].sort().join(',')}`;
      },
    }));
  }

  async function buildIssuerEnvelopeWire(proofWire: string): Promise<string> {
    await setIssuerProofMock(proofWire);
    const envelope = await payloadMod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    return envelopeMod.encodeEnvelopeToWire(envelope).wire;
  }

  beforeAll(async () => {
    // Export-complete mock (A5.3 lesson: partial module mocks poison
    // real-import files later in the same run).
    await mock.module('@/zk/groupManager', () => ({
      canonicalCommitments: (commitments: readonly string[]) => {
        const set = new Set<string>();
        for (const c of commitments) {
          const t = c.trim();
          if (t.length > 0) set.add(t);
        }
        return [...set].sort();
      },
      recomputeRoot: async () => null,
      leafIndex: () => null,
      generateGroupProof: async () => {
        throw new Error('test: generateGroupProof not used by scanner');
      },
      verifyGroupProof: async (proof: { proofJson?: unknown }) => {
        receivedProofs.push(proof);
        return typeof proof.proofJson === 'string' && proof.proofJson.length > 0;
      },
    }));
  });

  afterAll(async () => {
    // Restore the file-level null mock so later suites see the same state.
    await setIssuerProofMock(null);
  });

  it('never puts the sender commitment into the shared payload', async () => {
    await setIssuerProofMock(fullProofJson());
    const envelope = await payloadMod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
    });
    const decrypted = (await envelopeMod.decryptZKPayload(
      envelope as Parameters<typeof envelopeMod.decryptZKPayload>[0]
    )) as Record<string, unknown> | null;
    expect(decrypted).not.toBeNull();
    expect(typeof decrypted?.['issuerProof']).toBe('string');
    expect(Object.keys(decrypted ?? {})).not.toContain('issuerCommitment');
    expect(JSON.stringify(decrypted)).not.toContain('issuerCommitment');
  });

  it('verifies a full-envelope proof whose INNER root this device holds', async () => {
    const wire = await buildIssuerEnvelopeWire(fullProofJson());
    receivedProofs.length = 0;
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Verified');
    expect(receivedProofs.length).toBe(1);
    expect(receivedProofs[0]?.proofJson).toBe(INNER_PROOF_JSON);
  });

  it('does NOT trust a spoofed outer merkleRoot — provenance reads the verified inner root', async () => {
    // The wire's outer merkleRoot claims a group we hold ('222'), but the
    // SNARK actually committed to a root we do NOT hold ('999'). This is the
    // exact forgery the §6-8 check exists to stop: a valid proof over an
    // attacker's own group dressed up with a known outer root.
    const forgedInner = JSON.stringify({
      merkle_tree_depth: 16,
      merkle_tree_root: '999',
      nullifier: '111',
      message: 'inner-message',
      scope: 'inner-scope',
      points: [],
    });
    const wire = await buildIssuerEnvelopeWire(
      fullProofJson({ merkleRoot: '222', proofJson: forgedInner })
    );
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('card');
    // Crypto-valid but the real (inner) root is unknown → cannot check.
    expect(outcome.verificationStatus).toBe('Unverified');
  });

  it('accepts the legacy inner-JSON wire (root read from the same JSON)', async () => {
    const wire = await buildIssuerEnvelopeWire(INNER_PROOF_JSON);
    receivedProofs.length = 0;
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Verified');
    expect(receivedProofs.length).toBe(1);
    // The wrapper hands the RAW wire string to the native verifier.
    expect(receivedProofs[0]?.proofJson).toBe(INNER_PROOF_JSON);
  });
});

// ── issuerProof root provenance (05-spec §6-8, 2026-08-25) ─────────────────

describe('handleScannedPayload — issuerProof root provenance', () => {
  // Provenance now reads the INNER root (the only bytes the SNARK commits
  // to), so these vary `merkle_tree_root` inside proofJson, NOT the outer
  // wire field. isKnownGroupRoot('222')=true in scanWithIssuer's mock.
  function innerJson(merkleTreeRoot: string): string {
    return JSON.stringify({
      merkle_tree_depth: 16,
      merkle_tree_root: merkleTreeRoot,
      nullifier: '111',
      message: 'inner-message',
      scope: 'inner-scope',
      points: [],
    });
  }

  function proofJson(innerRoot: string): string {
    return JSON.stringify({
      nullifier: '111',
      // Outer merkleRoot deliberately says '222' (a known root) in every
      // case — it must NOT influence the decision; only the inner does.
      merkleRoot: '222',
      scope: 'fields:company,email,name,phone,title',
      signal: SHARE_ID,
      proofJson: innerJson(innerRoot),
      merkleTreeDepth: 16,
    });
  }

  async function scanWithIssuer(
    proofWire: string | null,
    proofClaims?: readonly string[]
  ): Promise<ReturnType<typeof handlerMod.handleScannedPayload>> {
    await mock.module('@/zk/issuerProof', () => ({
      generateIssuerProof: async () => (proofWire === null ? null : { proof: proofWire }),
      isKnownGroupRoot: async (root: string) => root === '222',
      buildShareScope: (selected: readonly string[]) => {
        const set = new Set<string>(selected);
        set.add('name');
        return `fields:${[...set].sort().join(',')}`;
      },
    }));
    const envelope = await payloadMod.buildZKEnvelope(makeCard(), {
      now: NOW,
      shareId: SHARE_ID,
      sharingLevel: 'professional',
      ...(proofClaims ? { proofClaims } : {}),
    });
    const { wire } = envelopeMod.encodeEnvelopeToWire(envelope);
    return handlerMod.handleScannedPayload(wire);
  }

  it('crypto-valid proof with an UNKNOWN inner root is Unverified — cannot check is not a lie', async () => {
    const outcome = await scanWithIssuer(proofJson('999'));
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Unverified');
  });

  it('crypto-valid proof with a KNOWN inner root is Verified', async () => {
    const outcome = await scanWithIssuer(proofJson('222'));
    expect(outcome.verificationStatus).toBe('Verified');
  });

  it('an is_human claim over an unknown inner root is Unverified, never granted', async () => {
    const outcome = await scanWithIssuer(proofJson('999'), ['is_human']);
    expect(outcome.verificationStatus).toBe('Unverified');
  });

  it('an is_human claim over a known inner root is Verified', async () => {
    const outcome = await scanWithIssuer(proofJson('222'), ['is_human']);
    expect(outcome.verificationStatus).toBe('Verified');
  });

  // Our own emitter's `filteredProofClaims` strips claims with no backing
  // proof, so these malicious combinations can only arrive hand-crafted.
  // Forge the encrypted zkProof payload directly to exercise the
  // receive-side guard for exactly that adversary. Seal through the real
  // `encryptJson` (not the literal FIXED_MASTER_KEY) so the ciphertext is
  // always decryptable by `decryptJson` regardless of which master-key mock
  // is active across the full run (many suites mock getMasterKey).
  async function forgeZkEnvelope(sharingPayload: Record<string, unknown>): Promise<string> {
    const { encryptJson } = await import('@/storage/encryptionManager');
    const ciphertext = await encryptJson(sharingPayload);
    return JSON.stringify({
      version: 2,
      format: 'zkProof',
      sharingLevel: 'professional',
      selectedFields: ['name'],
      shareId: SHARE_ID,
      encryptedPayload: ciphertext,
    });
  }

  function baseSharingPayload(extra: Record<string, unknown>): Record<string, unknown> {
    return {
      businessCard: {
        cardId: CARD_ID,
        name: 'Mallory',
        nameType: 'display_name',
        emails: [],
        phones: [],
        skills: [],
        socialProfiles: [],
        categories: [],
        updatedAt: '2026-05-24T00:00:00Z',
      },
      sharingLevel: 'professional',
      selectedFields: ['name'],
      scope: 'fields:name',
      expirationDate: '2030-01-01T00:00:00Z',
      shareId: SHARE_ID,
      createdAt: '2026-05-24T00:00:00Z',
      format: 'zkProof',
      ...extra,
    };
  }

  it('an is_human claim with NO issuer proof at all is Failed (a lie, not cannot-check)', async () => {
    await mock.module('@/zk/issuerProof', () => ({
      generateIssuerProof: async () => null,
      isKnownGroupRoot: async () => false,
      buildShareScope: () => 'fields:name',
    }));
    const wire = await forgeZkEnvelope(baseSharingPayload({ proofClaims: ['is_human'] }));
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Failed');
  });

  it('evaluates age_over_18 failure before downgrading is_human to Unverified', async () => {
    await mock.module('@/zk/issuerProof', () => ({
      generateIssuerProof: async () => null,
      isKnownGroupRoot: async (root: string) => root === '222',
      buildShareScope: () => 'fields:name',
    }));
    // is_human backed by a crypto-valid proof over an UNKNOWN inner root
    // (would be Unverified alone) PLUS age_over_18 with no sd proof (an
    // outright Failed). The unambiguous Failed must win.
    const wire = await forgeZkEnvelope(
      baseSharingPayload({ proofClaims: ['is_human', 'age_over_18'], issuerProof: proofJson('999') })
    );
    const outcome = await handlerMod.handleScannedPayload(wire);
    expect(outcome.verificationStatus).toBe('Failed');
  });
});

// ── nostr subscription pointer in signed card claims (05-spec §3 v1.1) ─────

describe('handleScannedPayload — nostr subscription pointer', () => {
  const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql6verd';

  it('surfaces the pointer from a signature-valid JWT, sanitizing relays', async () => {
    const { jwt } = signTestVcJwt({
      iss: DID,
      sub: DID,
      cardId: CARD_ID,
      name: 'Ada Lovelace',
      subscription: {
        nostr: {
          npub: NPUB,
          relays: [
            'wss://relay.damus.io',
            'https://not-wss.example',
            'wss://relay.damus.io',
            'ftp://nope',
            'wss://nos.lol',
          ],
        },
      },
    });
    const outcome = await handlerMod.handleScannedPayload(jwt);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Verified');
    expect(outcome.nostrPointer).toEqual({
      npub: NPUB,
      relays: ['wss://relay.damus.io', 'wss://nos.lol'],
    });
  });

  it('never surfaces a pointer from an unverifiable JWT', async () => {
    // Build a signed JWT, then break the signature by swapping one payload
    // byte-equivalent: easiest honest path — sign, then tamper the sub in a
    // re-encoded copy is complex; instead craft a JWT with NO embedded key
    // (extractPublicKeyJwk finds nothing → Unverified).
    const { jwt } = signTestVcJwt({
      iss: DID,
      sub: DID,
      cardId: CARD_ID,
      name: 'Ada Lovelace',
      subscription: { nostr: { npub: NPUB, relays: [] } },
    });
    // Strip the embedded jwk by rebuilding the payload without it.
    const [h, p] = jwt.split('.');
    const decoded = JSON.parse(Buffer.from(p!, 'base64url').toString()) as Record<string, unknown>;
    const vc = decoded['vc'] as { credentialSubject: Record<string, unknown> };
    delete vc.credentialSubject['publicKeyJwk'];
    delete (vc.credentialSubject['subject_core'] as Record<string, unknown>)['publicKeyJwk'];
    const tampered = `${h}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.sig`;
    const outcome = await handlerMod.handleScannedPayload(tampered);
    expect(outcome.kind).toBe('card');
    expect(outcome.verificationStatus).toBe('Unverified');
    expect(outcome.nostrPointer).toBeUndefined();
  });

  it('rejects a malformed npub in the claim', async () => {
    const { jwt } = signTestVcJwt({
      iss: DID,
      sub: DID,
      cardId: CARD_ID,
      name: 'Ada Lovelace',
      subscription: { nostr: { npub: 'npub1UPPERCASE-INVALID', relays: [] } },
    });
    const outcome = await handlerMod.handleScannedPayload(jwt);
    expect(outcome.verificationStatus).toBe('Verified');
    expect(outcome.nostrPointer).toBeUndefined();
  });
});
