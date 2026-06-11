import { describe, expect, it } from 'bun:test';

import { base64Encode, bytesToHex, sha256Bytes } from '@solidarity/shared';

import {
  buildPassportShowEnvelopeJson,
  derivePassportShowBucketNonceHash,
  type PassportShowPublicInputs,
} from '../../src/passport/showPresentation';
import {
  PASSPORT_SHOW_PUBLIC_INPUT_FIELD_COUNT,
  consumePassportShowChallenge,
  extractPassportShowProofPublicInputs,
  issuePassportShowChallenge,
  passportScopeToFieldDecimal,
  verifyPassportShowPresentation,
} from '../../src/passport/showVerifier';

const SCOPE = 'airmeishi-passport-v3';
// SHA256('solidarity.openac.scope.v1' || scope) mod BN254-Fr, computed
// independently of the implementation under test.
const SCOPE_FIELD_DECIMAL =
  '2155013680827239163549974999482844600863660738018952081066558645573890940955';

const NOW = new Date('2026-06-12T08:00:00Z');
const NONCE = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);

function fieldBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

interface ProofFixture {
  readonly nonceHash?: Uint8Array;
  readonly linkScopeDecimal?: string;
  readonly today?: { year: number; month: number; day: number };
  readonly discloseAge?: boolean;
  readonly discloseNationality?: boolean;
  readonly outIsOlder?: boolean;
  readonly nationalityBytes?: readonly [number, number, number];
  readonly credentialType?: bigint;
}

function buildFixture(overrides: ProofFixture = {}): {
  proofBytes: Uint8Array;
  publicInputs: PassportShowPublicInputs;
} {
  const nonceHash = overrides.nonceHash ?? NONCE;
  const linkScopeDecimal = overrides.linkScopeDecimal ?? SCOPE_FIELD_DECIMAL;
  const today = overrides.today ?? { year: 2026, month: 6, day: 12 };
  const discloseAge = overrides.discloseAge ?? true;
  const discloseNationality = overrides.discloseNationality ?? true;
  const outIsOlder = overrides.outIsOlder ?? true;
  const nationalityBytes = overrides.nationalityBytes ?? [84, 87, 78];
  const credentialType = overrides.credentialType ?? 1n;

  const fields: bigint[] = [
    credentialType,
    ...Array.from(nonceHash, (b) => BigInt(b)),
    0n, // link_mode
    BigInt(linkScopeDecimal),
    42n, // epoch
    BigInt(today.year),
    BigInt(today.month),
    BigInt(today.day),
    18n, // age_threshold
    discloseNationality ? 1n : 0n,
    discloseAge ? 1n : 0n,
    777n, // out_commitment_x
    888n, // out_commitment_y
    999n, // out_link_tag
    outIsOlder ? 1n : 0n,
    ...nationalityBytes.map((b) => BigInt(b)),
  ];
  expect(fields.length).toBe(PASSPORT_SHOW_PUBLIC_INPUT_FIELD_COUNT);

  const proofBytes = new Uint8Array(fields.length * 32 + 64);
  fields.forEach((value, i) => proofBytes.set(fieldBytes(value), i * 32));
  proofBytes.fill(0xab, fields.length * 32);

  const publicInputs: PassportShowPublicInputs = {
    nonceHashB64: base64Encode(nonceHash),
    linkScope: linkScopeDecimal,
    linkMode: false,
    epoch: '42',
    today,
    ageThreshold: 18,
    discloseAge,
    discloseNationality,
    commitmentX: '777',
    commitmentY: '888',
    linkTag: '999',
    outIsOlder,
    outNationality: discloseNationality
      ? String.fromCharCode(...nationalityBytes)
      : null,
  };
  return { proofBytes, publicInputs };
}

const VK_BYTES = Uint8Array.from({ length: 128 }, (_, i) => (i * 13) % 256);
const VK_SHA256 = bytesToHex(sha256Bytes(VK_BYTES));

function envelopeFor(
  fixture: ReturnType<typeof buildFixture>,
  freshness: 'challenge' | 'time-bucket' = 'challenge'
): string {
  return buildPassportShowEnvelopeJson({
    proofB64: base64Encode(fixture.proofBytes),
    vkB64: base64Encode(VK_BYTES),
    publicInputs: fixture.publicInputs,
    freshness,
    holderDid: 'did:key:zHolder',
    selectedClaims: ['age_over_18', 'nationality'],
  });
}

const verifyTrue = async () => true;

describe('passport show verifier — scope field', () => {
  it('mirrors the Rust scope_to_field derivation', () => {
    expect(passportScopeToFieldDecimal(SCOPE)).toBe(SCOPE_FIELD_DECIMAL);
  });
});

describe('passport show verifier — public input extraction', () => {
  it('round-trips the 49-field public input block', () => {
    const { proofBytes } = buildFixture();
    const decoded = extractPassportShowProofPublicInputs(proofBytes);
    expect(decoded).not.toBe(null);
    expect(decoded?.credentialType).toBe('1');
    expect(decoded && Array.from(decoded.nonceHash)).toEqual(Array.from(NONCE));
    expect(decoded?.linkScope).toBe(SCOPE_FIELD_DECIMAL);
    expect(decoded?.year).toBe(2026);
    expect(decoded?.month).toBe(6);
    expect(decoded?.day).toBe(12);
    expect(decoded?.ageThreshold).toBe(18);
    expect(decoded?.discloseAge).toBe(true);
    expect(decoded?.discloseNationality).toBe(true);
    expect(decoded?.commitmentX).toBe('777');
    expect(decoded?.outIsOlder).toBe(true);
    expect(decoded?.outNationalityBytes).toEqual([84, 87, 78]);
  });

  it('rejects truncated proofs and out-of-range field values', () => {
    const { proofBytes } = buildFixture();
    expect(extractPassportShowProofPublicInputs(proofBytes.slice(0, 100))).toBe(null);

    const badNonceByte = new Uint8Array(proofBytes);
    badNonceByte.set(fieldBytes(256n), 32); // nonce_hash[0] = 256
    expect(extractPassportShowProofPublicInputs(badNonceByte)).toBe(null);

    const badBool = new Uint8Array(proofBytes);
    badBool.set(fieldBytes(2n), 33 * 32); // link_mode = 2
    expect(extractPassportShowProofPublicInputs(badBool)).toBe(null);
  });
});

describe('passport show verifier — verification', () => {
  it('accepts a fresh challenge-mode presentation', async () => {
    const fixture = buildFixture();
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.disclosed.age).toEqual({ threshold: 18, satisfied: true });
    expect(result.disclosed.nationality).toBe('TWN');
    expect(result.freshnessMode).toBe('challenge');
  });

  it('falls back to the enrollment self-pin when no build pin exists', async () => {
    const fixture = buildFixture();
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: null, selfPin: VK_SHA256 },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('fails closed without any vk pin and on pin mismatch', async () => {
    const fixture = buildFixture();
    const missing = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: null, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(missing).toEqual({ ok: false, reason: 'missing-vk-pin' });

    const mismatch = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: 'f'.repeat(64), selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(mismatch).toEqual({ ok: false, reason: 'vk-pin-mismatch' });
  });

  it('rejects when the native proof verification fails', async () => {
    const fixture = buildFixture();
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: async () => false,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'proof-verification-failed' });
  });

  it('rejects when envelope display data diverges from the proof public inputs', async () => {
    const fixture = buildFixture();
    const tampered = envelopeFor({
      proofBytes: fixture.proofBytes,
      publicInputs: { ...fixture.publicInputs, commitmentX: '70007' },
    });
    const result = await verifyPassportShowPresentation({
      envelopeJson: tampered,
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'public-input-mismatch' });
  });

  it('rejects a presentation proven for a different scope', async () => {
    const fixture = buildFixture({ linkScopeDecimal: '12345' });
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'scope-mismatch' });
  });

  it('rejects a nonce that does not match the outstanding challenge', async () => {
    const fixture = buildFixture();
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: {
        mode: 'challenge',
        expectedNonceHash: Uint8Array.from({ length: 32 }, () => 9),
      },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'nonce-mismatch' });
  });

  it('accepts current/previous time-bucket nonces and rejects expired ones', async () => {
    const bucketNonce = derivePassportShowBucketNonceHash(SCOPE, NOW);
    const fixture = buildFixture({ nonceHash: bucketNonce });
    const envelope = envelopeFor(fixture, 'time-bucket');

    const fresh = await verifyPassportShowPresentation({
      envelopeJson: envelope,
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'time-bucket', scope: SCOPE, now: NOW },
      now: NOW,
    });
    expect(fresh.ok).toBe(true);
    if (fresh.ok) expect(fresh.freshnessMode).toBe('time-bucket');

    const later = new Date(NOW.getTime() + 25 * 60 * 1000);
    const expired = await verifyPassportShowPresentation({
      envelopeJson: envelope,
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'time-bucket', scope: SCOPE, now: later },
      now: later,
    });
    expect(expired).toEqual({ ok: false, reason: 'nonce-mismatch' });
  });

  it('rejects stale presentation dates', async () => {
    const fixture = buildFixture({ today: { year: 2026, month: 6, day: 9 } });
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'stale-presentation-date' });
  });

  it('rejects non-passport credential types', async () => {
    const fixture = buildFixture({ credentialType: 2n });
    const result = await verifyPassportShowPresentation({
      envelopeJson: envelopeFor(fixture),
      verifyNoirProof: verifyTrue,
      vkPins: { buildPin: VK_SHA256, selfPin: null },
      expectedScope: SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash: NONCE },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'wrong-credential-type' });
  });
});

describe('passport show verifier — challenge store', () => {
  it('issues a challenge and consumes the outstanding nonce exactly once', () => {
    const issued = issuePassportShowChallenge({
      scope: SCOPE,
      ageThreshold: 18,
      requestAge: true,
      requestNationality: false,
      nonceHash: NONCE,
      now: NOW,
    });
    expect(issued.challengeJson).toContain(base64Encode(NONCE));

    const taken = consumePassportShowChallenge(NOW);
    expect(taken && Array.from(taken)).toEqual(Array.from(NONCE));
    expect(consumePassportShowChallenge(NOW)).toBe(null);
  });

  it('expires outstanding challenges after the TTL', () => {
    issuePassportShowChallenge({
      scope: SCOPE,
      ageThreshold: 18,
      requestAge: true,
      requestNationality: false,
      nonceHash: NONCE,
      now: NOW,
    });
    const afterTtl = new Date(NOW.getTime() + 6 * 60 * 1000);
    expect(consumePassportShowChallenge(afterTtl)).toBe(null);
  });
});
