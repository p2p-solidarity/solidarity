import { describe, expect, it } from 'bun:test';

import { base64Decode, base64Encode } from '@solidarity/shared';

import {
  PASSPORT_SHOW_CHALLENGE_SCHEMA,
  PASSPORT_SHOW_PRESENTATION_SCHEMA,
  PASSPORT_SHOW_PROOF_TYPE,
  acceptablePassportShowBucketNonceHashes,
  buildPassportShowChallengeJson,
  buildPassportShowEnvelopeJson,
  computePassportShowVkSha256,
  decodePassportClaimsField,
  derivePassportShowBucketNonceHash,
  generatePassportShowPresentation,
  isPassportAgeAtLeast,
  parsePassportShowChallengeJson,
  parsePassportShowEnvelopeJson,
  swapPassportShowInputs,
} from '../../src/passport/showPresentation';

// pack_passport_claims(2000, 3, 15, "TWN") — precomputed decimal, NOT derived
// via the implementation under test:
//   2000·2^40 + 3·2^32 + 15·2^24 + 84·2^16 + 87·2^8 + 78
const CLAIMS_2000_03_15_TWN = '2199036397639502';

function decimalBytes(seed: number, length: number): string[] {
  return Array.from({ length }, (_, i) => String((seed + i) % 256));
}

/** Witness map mirroring Rust `openac_show_inputs` (all Vec<String>). */
function showInputsFixture(overrides: Record<string, string[]> = {}): Record<string, string[]> {
  return {
    claims: [CLAIMS_2000_03_15_TWN],
    sod_hash_hi: ['1111'],
    sod_hash_lo: ['2222'],
    dg1_hash_hi: ['3333'],
    dg1_hash_lo: ['4444'],
    link_rand: ['5555'],
    enclave_pk_x: decimalBytes(10, 32),
    enclave_pk_y: decimalBytes(70, 32),
    signature: decimalBytes(1, 64),
    credential_type: ['1'],
    nonce_hash: decimalBytes(200, 32),
    link_mode: ['0'],
    link_scope: ['987654321'],
    epoch: ['42'],
    current_year: ['2026'],
    current_month: ['5'],
    current_day: ['20'],
    age_threshold: ['18'],
    disclose_nationality: ['1'],
    disclose_age: ['1'],
    out_commitment_x: ['777'],
    out_commitment_y: ['888'],
    out_link_tag: ['999'],
    out_is_older: ['1'],
    out_nationality: ['84', '87', '78'],
    ...overrides,
  };
}

function witnessBundleFixture(showOverrides: Record<string, string[]> = {}): string {
  return JSON.stringify({
    dscChainInputsJson: JSON.stringify({ out_dsc_id: ['1'] }),
    passportAdapterInputsJson: JSON.stringify({
      enclave_pk_x: decimalBytes(10, 32),
      enclave_pk_y: decimalBytes(70, 32),
    }),
    openAcShowInputsJson: JSON.stringify(showInputsFixture(showOverrides)),
  });
}

const FRESH_NONCE = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const TODAY = { year: 2026, month: 6, day: 12 } as const;

describe('passport show presentation — claims field decode', () => {
  it('decodes the packed 72-bit claims field', () => {
    const profile = decodePassportClaimsField(CLAIMS_2000_03_15_TWN);
    expect(profile).toEqual({
      birthYear: 2000,
      birthMonth: 3,
      birthDay: 15,
      nationalityBytes: [84, 87, 78],
      nationality: 'TWN',
    });
  });

  it('rejects values beyond 72 bits and non-numeric input', () => {
    expect(decodePassportClaimsField(String(1n << 72n))).toBe(null);
    expect(decodePassportClaimsField('not-a-number')).toBe(null);
    expect(decodePassportClaimsField('')).toBe(null);
    expect(decodePassportClaimsField('-5')).toBe(null);
  });
});

describe('passport show presentation — age predicate mirrors check_age_above', () => {
  const profile = decodePassportClaimsField(CLAIMS_2000_03_15_TWN);
  if (profile === null) throw new Error('fixture decode failed');

  it('counts a birthday that already occurred this year', () => {
    expect(isPassportAgeAtLeast(profile, { year: 2018, month: 3, day: 15 }, 18)).toBe(true);
    expect(isPassportAgeAtLeast(profile, { year: 2018, month: 3, day: 14 }, 18)).toBe(false);
    expect(isPassportAgeAtLeast(profile, { year: 2026, month: 6, day: 12 }, 18)).toBe(true);
  });

  it('mirrors the HIGH-2 same-year-newborn guard (age stays 0, never wraps)', () => {
    const newborn = {
      birthYear: 2026,
      birthMonth: 6,
      birthDay: 30,
      nationalityBytes: [84, 87, 78] as const,
      nationality: 'TWN',
    };
    expect(isPassportAgeAtLeast(newborn, { year: 2026, month: 1, day: 1 }, 18)).toBe(false);
  });
});

describe('passport show presentation — input swap', () => {
  it('swaps nonce, today, and disclosure while keeping every value a decimal string', () => {
    const result = swapPassportShowInputs({
      showInputsJson: JSON.stringify(showInputsFixture()),
      nonceHash: FRESH_NONCE,
      today: TODAY,
      disclosure: { discloseAge: true, discloseNationality: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const map = JSON.parse(result.showInputsJson) as Record<string, string[]>;
    expect(map['nonce_hash']).toEqual(Array.from(FRESH_NONCE, String));
    expect(map['current_year']).toEqual(['2026']);
    expect(map['current_month']).toEqual(['6']);
    expect(map['current_day']).toEqual(['12']);
    expect(map['disclose_age']).toEqual(['1']);
    expect(map['disclose_nationality']).toEqual(['1']);
    expect(map['out_is_older']).toEqual(['1']);
    expect(map['out_nationality']).toEqual(['84', '87', '78']);
    // Commitment opening + pseudonym inputs must be untouched.
    expect(map['claims']).toEqual([CLAIMS_2000_03_15_TWN]);
    expect(map['link_scope']).toEqual(['987654321']);
    expect(map['epoch']).toEqual(['42']);
    expect(map['out_link_tag']).toEqual(['999']);
    expect(map['out_commitment_x']).toEqual(['777']);
    // PassportZk Code=2 guard: decimal strings only, never numbers.
    for (const values of Object.values(map)) {
      for (const value of values) {
        expect(typeof value).toBe('string');
        expect(value).toMatch(/^\d+$/);
      }
    }
  });

  it('pins sentinel outputs when a predicate is not disclosed (CRITICAL-2)', () => {
    const result = swapPassportShowInputs({
      showInputsJson: JSON.stringify(showInputsFixture()),
      nonceHash: FRESH_NONCE,
      today: TODAY,
      disclosure: { discloseAge: false, discloseNationality: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = JSON.parse(result.showInputsJson) as Record<string, string[]>;
    expect(map['disclose_age']).toEqual(['0']);
    expect(map['disclose_nationality']).toEqual(['0']);
    expect(map['out_is_older']).toEqual(['0']);
    expect(map['out_nationality']).toEqual(['0', '0', '0']);
  });

  it('computes out_is_older honestly for an underage holder', () => {
    const result = swapPassportShowInputs({
      showInputsJson: JSON.stringify(showInputsFixture()),
      nonceHash: FRESH_NONCE,
      today: { year: 2017, month: 1, day: 1 },
      disclosure: { discloseAge: true, discloseNationality: false },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const map = JSON.parse(result.showInputsJson) as Record<string, string[]>;
    expect(map['out_is_older']).toEqual(['0']);
  });

  it('exposes the swapped public inputs for the envelope', () => {
    const result = swapPassportShowInputs({
      showInputsJson: JSON.stringify(showInputsFixture()),
      nonceHash: FRESH_NONCE,
      today: TODAY,
      disclosure: { discloseAge: true, discloseNationality: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.publicInputs).toEqual({
      nonceHashB64: base64Encode(FRESH_NONCE),
      linkScope: '987654321',
      linkMode: false,
      epoch: '42',
      today: TODAY,
      ageThreshold: 18,
      discloseAge: true,
      discloseNationality: true,
      commitmentX: '777',
      commitmentY: '888',
      linkTag: '999',
      outIsOlder: true,
      outNationality: 'TWN',
    });
  });

  it('rejects malformed inputs', () => {
    expect(
      swapPassportShowInputs({
        showInputsJson: 'not-json',
        nonceHash: FRESH_NONCE,
        today: TODAY,
        disclosure: { discloseAge: true, discloseNationality: true },
      }).ok
    ).toBe(false);
    expect(
      swapPassportShowInputs({
        showInputsJson: JSON.stringify(showInputsFixture()),
        nonceHash: new Uint8Array(16),
        today: TODAY,
        disclosure: { discloseAge: true, discloseNationality: true },
      }).ok
    ).toBe(false);
    expect(
      swapPassportShowInputs({
        showInputsJson: JSON.stringify({ nonce_hash: decimalBytes(0, 32) }),
        nonceHash: FRESH_NONCE,
        today: TODAY,
        disclosure: { discloseAge: true, discloseNationality: true },
      }).ok
    ).toBe(false);
  });
});

describe('passport show presentation — challenge', () => {
  it('round-trips a verifier challenge', () => {
    const json = buildPassportShowChallengeJson({
      nonceHash: FRESH_NONCE,
      scope: 'airmeishi-passport-v3',
      ageThreshold: 18,
      requestAge: true,
      requestNationality: false,
      issuedAt: '2026-06-12T08:00:00.000Z',
    });
    const parsed = parsePassportShowChallengeJson(json);
    expect(parsed).not.toBe(null);
    expect(parsed?.schema).toBe(PASSPORT_SHOW_CHALLENGE_SCHEMA);
    expect(parsed?.scope).toBe('airmeishi-passport-v3');
    expect(parsed?.requestAge).toBe(true);
    expect(parsed?.requestNationality).toBe(false);
    expect(parsed && base64Decode(parsed.nonceHashB64)).toEqual(FRESH_NONCE);
  });

  it('rejects foreign schemas and short nonces', () => {
    expect(parsePassportShowChallengeJson('{}')).toBe(null);
    expect(parsePassportShowChallengeJson('not json')).toBe(null);
    const wrongNonce = buildPassportShowChallengeJson({
      nonceHash: FRESH_NONCE,
      scope: 's',
      ageThreshold: 18,
      requestAge: true,
      requestNationality: true,
      issuedAt: '2026-06-12T08:00:00.000Z',
    }).replace(base64Encode(FRESH_NONCE), base64Encode(new Uint8Array(8)));
    expect(parsePassportShowChallengeJson(wrongNonce)).toBe(null);
  });
});

describe('passport show presentation — time-bucket nonce', () => {
  it('is stable within a 10-minute bucket and changes across buckets', () => {
    const a = derivePassportShowBucketNonceHash('scope-a', new Date('2026-06-12T08:01:00Z'));
    const b = derivePassportShowBucketNonceHash('scope-a', new Date('2026-06-12T08:09:59Z'));
    const c = derivePassportShowBucketNonceHash('scope-a', new Date('2026-06-12T08:10:00Z'));
    const d = derivePassportShowBucketNonceHash('scope-b', new Date('2026-06-12T08:01:00Z'));
    expect(base64Encode(a)).toBe(base64Encode(b));
    expect(base64Encode(a)).not.toBe(base64Encode(c));
    expect(base64Encode(a)).not.toBe(base64Encode(d));
    expect(a.length).toBe(32);
  });

  it('acceptance window covers the current and previous bucket across boundaries', () => {
    const now = new Date('2026-06-12T00:00:30Z');
    const hashes = acceptablePassportShowBucketNonceHashes('scope-a', now).map(base64Encode);
    expect(hashes).toContain(
      base64Encode(derivePassportShowBucketNonceHash('scope-a', now))
    );
    // Previous bucket falls on the prior day — the window must roll over.
    expect(hashes).toContain(
      base64Encode(
        derivePassportShowBucketNonceHash('scope-a', new Date('2026-06-11T23:59:59Z'))
      )
    );
    expect(hashes.length).toBe(2);
  });
});

describe('passport show presentation — envelope', () => {
  const publicInputs = {
    nonceHashB64: base64Encode(FRESH_NONCE),
    linkScope: '987654321',
    linkMode: false,
    epoch: '42',
    today: TODAY,
    ageThreshold: 18,
    discloseAge: true,
    discloseNationality: true,
    commitmentX: '777',
    commitmentY: '888',
    linkTag: '999',
    outIsOlder: true,
    outNationality: 'TWN',
  } as const;

  it('round-trips and carries no prepare proofs', () => {
    const json = buildPassportShowEnvelopeJson({
      proofB64: 'cHJvb2Y=',
      vkB64: 'dms=',
      publicInputs,
      freshness: 'challenge',
      holderDid: 'did:key:zHolder',
      selectedClaims: ['age_over_18', 'nationality'],
    });
    const parsed = parsePassportShowEnvelopeJson(json);
    expect(parsed).not.toBe(null);
    expect(parsed?.schema).toBe(PASSPORT_SHOW_PRESENTATION_SCHEMA);
    expect(parsed?.proofType).toBe(PASSPORT_SHOW_PROOF_TYPE);
    expect(parsed?.circuit).toBe('openac_show');
    expect(parsed?.freshness).toBe('challenge');
    expect(parsed?.publicInputs).toEqual(publicInputs);
    expect(json).not.toContain('dscChain');
    expect(json).not.toContain('passport_adapter');
  });

  it('rejects malformed envelopes', () => {
    expect(parsePassportShowEnvelopeJson('nope')).toBe(null);
    expect(parsePassportShowEnvelopeJson('{}')).toBe(null);
    expect(
      parsePassportShowEnvelopeJson(
        JSON.stringify({ schema: PASSPORT_SHOW_PRESENTATION_SCHEMA })
      )
    ).toBe(null);
  });
});

describe('passport show presentation — enrollment vk self-pin', () => {
  it('hashes the vk produced by getNoirVerificationKey for openac_show + merged SRS', async () => {
    const vkBytes = Uint8Array.from([1, 2, 3, 4]);
    const calls: Array<readonly [string, string | undefined]> = [];
    const pin = await computePassportShowVkSha256({
      getNoirVerificationKey: async (circuitPath, srsPath) => {
        calls.push([circuitPath, srsPath]);
        return vkBytes.slice().buffer;
      },
    });
    expect(calls).toEqual([['openac_show', 'passport']]);
    // sha256([1,2,3,4]) — precomputed, NOT derived via the implementation.
    expect(pin).toBe(
      '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a'
    );
  });

  it('returns null when the native call fails (never throws on the persist path)', async () => {
    const pin = await computePassportShowVkSha256({
      getNoirVerificationKey: async () => {
        throw new Error('not linked');
      },
    });
    expect(pin).toBe(null);
  });
});

describe('passport show presentation — generation orchestrator', () => {
  const signer = async (nonceHash: Uint8Array) => {
    expect(Array.from(nonceHash)).toEqual(Array.from(FRESH_NONCE));
    return {
      signature: Uint8Array.from({ length: 64 }, (_, i) => i + 1),
      publicKeyRaw: Uint8Array.from([
        ...decimalBytes(10, 32).map(Number),
        ...decimalBytes(70, 32).map(Number),
      ]),
    };
  };

  it('binds a fresh signature, proves openac_show only, and emits an envelope', async () => {
    const calls: { circuit: string; srs: string | undefined; inputs: string }[] = [];
    const result = await generatePassportShowPresentation({
      witnessBundleJson: witnessBundleFixture(),
      nonceHash: FRESH_NONCE,
      today: TODAY,
      disclosure: { discloseAge: true, discloseNationality: true },
      freshness: 'challenge',
      holderDid: 'did:key:zHolder',
      selectedClaims: ['age_over_18'],
      signDeviceDigest: signer,
      prover: {
        generateNoirProof: async (circuitPath, srsPath, inputsJson) => {
          calls.push({ circuit: circuitPath, srs: srsPath, inputs: inputsJson });
          return {
            proof: Uint8Array.from([9, 9, 9]).buffer,
            vk: Uint8Array.from([7, 7]).buffer,
          };
        },
        verifyNoirProof: async () => true,
      },
      encodeProofBytes: (buffer) => base64Encode(new Uint8Array(buffer)),
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.circuit).toBe('openac_show');
    expect(calls[0]?.srs).toBe('passport');
    const inputs = JSON.parse(calls[0]?.inputs ?? '{}') as Record<string, string[]>;
    expect(inputs['nonce_hash']).toEqual(Array.from(FRESH_NONCE, String));
    expect(inputs['signature']).toEqual(
      Array.from({ length: 64 }, (_, i) => String(i + 1))
    );

    const envelope = parsePassportShowEnvelopeJson(result.envelopeJson);
    expect(envelope).not.toBe(null);
    expect(envelope?.proofB64).toBe(base64Encode(Uint8Array.from([9, 9, 9])));
    expect(envelope?.vkB64).toBe(base64Encode(Uint8Array.from([7, 7])));
    expect(envelope?.holderDid).toBe('did:key:zHolder');
  });

  it('skips the on-device self-verify when selfVerify is false', async () => {
    let verifyCalls = 0;
    const result = await generatePassportShowPresentation({
      witnessBundleJson: witnessBundleFixture(),
      nonceHash: FRESH_NONCE,
      today: TODAY,
      disclosure: { discloseAge: true, discloseNationality: true },
      freshness: 'challenge',
      holderDid: 'did:key:zHolder',
      selectedClaims: ['age_over_18'],
      signDeviceDigest: signer,
      selfVerify: false,
      prover: {
        generateNoirProof: async () => ({
          proof: Uint8Array.from([9, 9, 9]).buffer,
          vk: Uint8Array.from([7, 7]).buffer,
        }),
        verifyNoirProof: async () => {
          verifyCalls += 1;
          return true;
        },
      },
      encodeProofBytes: (buffer) => base64Encode(new Uint8Array(buffer)),
    });
    expect(result.envelopeJson.length).toBeGreaterThan(0);
    expect(verifyCalls).toBe(0);
  });

  it('fails closed when the fresh proof does not self-verify', async () => {
    await expect(
      generatePassportShowPresentation({
        witnessBundleJson: witnessBundleFixture(),
        nonceHash: FRESH_NONCE,
        today: TODAY,
        disclosure: { discloseAge: true, discloseNationality: true },
        freshness: 'time-bucket',
        holderDid: 'did:key:zHolder',
        selectedClaims: ['age_over_18'],
        signDeviceDigest: signer,
        prover: {
          generateNoirProof: async () => ({
            proof: new ArrayBuffer(3),
            vk: new ArrayBuffer(2),
          }),
          verifyNoirProof: async () => false,
        },
        encodeProofBytes: (buffer) => base64Encode(new Uint8Array(buffer)),
      })
    ).rejects.toThrow(/did not verify/);
  });
});
