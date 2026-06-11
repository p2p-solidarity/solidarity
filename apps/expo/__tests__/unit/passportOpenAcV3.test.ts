import { describe, expect, it } from 'bun:test';

import type { PassportReadResult } from '@solidarity/nitro-nfc-passport';

import {
  PASSPORT_NOIR_VERSION,
  PASSPORT_OPENAC_V3_CIRCUITS,
  PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS,
  PASSPORT_REVOCATION_SNAPSHOT_SCHEMA,
  PASSPORT_V3_PROOF_TYPE,
  assessPassportOpenAcV3Readiness,
  buildPassportOpenAcV3ProofCalls,
  buildPassportOpenAcV3ProofPlan,
  buildPassportOpenAcV3WitnessBundleJson,
  buildPassportOpenAcV3WitnessRequestJson,
  bindPassportOpenAcV3DeviceSignature,
  generatePassportOpenAcV3ProofPayload,
  parsePassportOpenAcV3WitnessBundleJson,
  resolvePassportOpenAcV3WitnessBundleJson,
  shouldAllowPassportOpenAcV3FallbackProof,
  shouldPreparePassportOpenAcV3WitnessDuringRead,
} from '../../src/passport/openacV3';

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function text(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buffer));
}

function byteArray(length: number, seed: number): number[] {
  return Array.from({ length }, (_unused, index) => (seed + index) & 0xff);
}

/**
 * Witness values exactly as the Rust builder emits them — every byte a
 * decimal string. Native parseInputs ([String: [String]] on iOS) rejects
 * number arrays, so fixtures must mirror the string shape.
 */
function witnessBytes(length: number, seed: number): string[] {
  return byteArray(length, seed).map(String);
}

const ACTIVE_AUTH_JSON = JSON.stringify({
  challengeB64: 'Y2hhbGxlbmdl',
  signatureRawB64: 'c2lnbmF0dXJl',
});

function readResult(
  overrides: Partial<PassportReadResult> = {}
): PassportReadResult {
  return {
    mrz: {
      nationality: 'UTO',
      documentNumber: 'L898902C36',
      name: 'ERIKSSON ANNA MARIA',
      dateOfBirth: '740812',
      dateOfExpiry: '300101',
      gender: 'F',
    },
    dataGroups: {
      dg1: bytes('dg1'),
      dg15: bytes('dg15'),
      sod: bytes('sod'),
    },
    activeAuthJson: ACTIVE_AUTH_JSON,
    chipUid: 'NFC-L898902C36',
    passiveAuthValid: true,
    ...overrides,
  };
}

const REVOCATION_SNAPSHOT = {
  schema: 'gg.solidarity.passport.revocation.v1',
  generatedAt: '2026-06-10T12:00:00Z',
  sourceCount: 1,
  revokedCertificateCount: 1,
  sourceSetSha256: 'a'.repeat(64),
  sources: [
    {
      id: 'source-1',
      uri: 'icaopkd-001-dsccrl-test.ldif',
      format: 'ldif',
      sha256: 'b'.repeat(64),
      crlCount: 1,
      revokedCertificateCount: 1,
      issuers: [],
    },
  ],
  entries: [
    {
      issuerName: 'CN=Country Signing Authority,O=Test CSCA,C=GB',
      issuerNameSha256: 'c'.repeat(64),
      authorityKeyIdentifierHex: '499E4730278520C57CFC118024E14C1562A249D6',
      serialHex: '492F0116',
      serial20Hex: '00000000000000000000000000000000492F0116',
      revokedAt: '2026-06-09T12:00:00Z',
      sourceId: 'source-1',
      crlIndex: 0,
    },
  ],
} as const;

function openAcV3Plan() {
  const plan = buildPassportOpenAcV3ProofPlan({
    ...readResult(),
    revocationSnapshot: REVOCATION_SNAPSHOT,
  });
  if (plan.kind !== 'openac-v3') {
    throw new Error(`expected openac-v3 plan, got ${plan.kind}`);
  }
  return plan;
}

describe('passport OpenAC v3.1 / passport-noir 0.3.0 contract', () => {
  it('pins the latest passport-noir version and v3 circuit sequence', () => {
    expect(PASSPORT_NOIR_VERSION).toBe('0.3.0');
    expect(PASSPORT_V3_PROOF_TYPE).toBe('passport_v3');
    expect(PASSPORT_REVOCATION_SNAPSHOT_SCHEMA).toBe('gg.solidarity.passport.revocation.v1');
    expect(PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS).toEqual(['SOD', 'DG1']);
    expect(PASSPORT_OPENAC_V3_CIRCUITS.map((c) => c.name)).toEqual([
      'dsc_chain',
      'passport_adapter',
      'openac_show',
    ]);
    expect(PASSPORT_OPENAC_V3_CIRCUITS.map((c) => c.circuitPath)).not.toContain('disclosure');
  });

  it('builds a proof plan that calls the 0.3.0 circuits explicitly', () => {
    const plan = openAcV3Plan();
    expect(plan.version).toBe('0.3.0');
    expect(plan.proofType).toBe('passport_v3');
    expect(plan.circuits.map((c) => c.circuitPath)).toEqual([
      'dsc_chain',
      'passport_adapter',
      'openac_show',
    ]);
    // All three circuits share the single merged SRS.
    expect(plan.circuits.map((c) => c.srsPath)).toEqual([
      'passport',
      'passport',
      'passport',
    ]);
    expect(plan.circuits.map((c) => c.srsAsset)).toEqual([
      'passport.srs.bin',
      'passport.srs.bin',
      'passport.srs.bin',
    ]);

    const calls = buildPassportOpenAcV3ProofCalls(plan, {
      dscChainInputsJson: '{"dsc":true}',
      passportAdapterInputsJson: '{"passport":true}',
      openAcShowInputsJson: '{"show":true}',
    });
    expect(calls.map((c) => [c.circuit.name, c.inputsJson])).toEqual([
      ['dsc_chain', '{"dsc":true}'],
      ['passport_adapter', '{"passport":true}'],
      ['openac_show', '{"show":true}'],
    ]);
  });

  it('runs the prepare/show v3 proof flow and verifies each generated circuit proof', async () => {
    const calls: string[] = [];
    const payload = await generatePassportOpenAcV3ProofPayload({
      plan: openAcV3Plan(),
      witnesses: {
        dscChainInputsJson: '{"dsc":true}',
        passportAdapterInputsJson: '{"passport":true}',
        openAcShowInputsJson: '{"show":true}',
      },
      encodeProofBytes: text,
      prover: {
        generateNoirProof: async (circuitPath, srsPath, inputsJson) => {
          calls.push(`generate:${circuitPath}:${srsPath ?? ''}:${inputsJson}`);
          return {
            proof: bytes(`proof:${circuitPath}:${inputsJson}`),
            vk: bytes(`vk:${circuitPath}`),
          };
        },
        verifyNoirProof: async (proof, vk) => {
          calls.push(`verify:${text(proof)}:${text(vk)}`);
          return true;
        },
      },
    });

    // Every circuit is proved against the shared merged-SRS alias 'passport'.
    expect(calls).toEqual([
      'generate:dsc_chain:passport:{"dsc":true}',
      'verify:proof:dsc_chain:{"dsc":true}:vk:dsc_chain',
      'generate:passport_adapter:passport:{"passport":true}',
      'verify:proof:passport_adapter:{"passport":true}:vk:passport_adapter',
      'generate:openac_show:passport:{"show":true}',
      'verify:proof:openac_show:{"show":true}:vk:openac_show',
    ]);

    const parsed = JSON.parse(payload.proofPayload) as {
      proofType: string;
      passportNoirVersion: string;
      proofs: Array<{ circuit: string; stage: string; proofB64: string; vkB64: string }>;
      phases: {
        prepare: {
          dscChain: { circuit: string };
          passportAdapter: { circuit: string };
        };
        show: {
          openAcShow: { circuit: string };
        };
      };
    };
    expect(parsed.proofType).toBe('passport_v3');
    expect(parsed.passportNoirVersion).toBe('0.3.0');
    expect(parsed.proofs.map((proof) => proof.circuit)).toEqual([
      'dsc_chain',
      'passport_adapter',
      'openac_show',
    ]);
    expect(parsed.proofs.map((proof) => proof.stage)).toEqual([
      'prepare',
      'prepare',
      'show',
    ]);
    expect(parsed.proofs.map((proof) => proof.circuit)).not.toContain('disclosure');
    expect(parsed.phases.prepare.dscChain.circuit).toBe('dsc_chain');
    expect(parsed.phases.prepare.passportAdapter.circuit).toBe('passport_adapter');
    expect(parsed.phases.show.openAcShow.circuit).toBe('openac_show');
  });

  it('fails the v3 flow when any generated proof does not verify', async () => {
    await expect(
      generatePassportOpenAcV3ProofPayload({
        plan: openAcV3Plan(),
        witnesses: {
          dscChainInputsJson: '{"dsc":true}',
          passportAdapterInputsJson: '{"passport":true}',
          openAcShowInputsJson: '{"show":true}',
        },
        encodeProofBytes: text,
        prover: {
          generateNoirProof: async (circuitPath) => ({
            proof: bytes(`proof:${circuitPath}`),
            vk: bytes(`vk:${circuitPath}`),
          }),
          verifyNoirProof: async (_proof, vk) => text(vk) !== 'vk:passport_adapter',
        },
      })
    ).rejects.toThrow('passport_adapter proof did not verify');
  });

  it('parses only complete OpenAC v3 witness bundle JSON', () => {
    const valid = parsePassportOpenAcV3WitnessBundleJson(
      JSON.stringify({
        dscChainInputsJson: '{"dsc":true}',
        passportAdapterInputsJson: '{"passport":true}',
        openAcShowInputsJson: '{"show":true}',
      })
    );
    expect(valid?.dscChainInputsJson).toBe('{"dsc":true}');

    expect(parsePassportOpenAcV3WitnessBundleJson('')).toBe(null);
    expect(
      parsePassportOpenAcV3WitnessBundleJson(
        JSON.stringify({
          dscChainInputsJson: '{"dsc":true}',
          passportAdapterInputsJson: '{"passport":true}',
        })
      )
    ).toBe(null);
    expect(
      parsePassportOpenAcV3WitnessBundleJson(
        JSON.stringify({
          dscChainInputsJson: '{"dsc":true}',
          passportAdapterInputsJson: 'not-json',
          openAcShowInputsJson: '{"show":true}',
        })
      )
    ).toBe(null);
  });

  it('builds a shared Rust witness request from chip evidence and binding inputs', () => {
    const requestJson = buildPassportOpenAcV3WitnessRequestJson({
      chip: readResult(),
      revocationSnapshot: REVOCATION_SNAPSHOT,
      devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
      nonceHash: Uint8Array.from(byteArray(32, 151)),
      linkScope: 'airmeishi-passport-v3',
      requireAA: true,
    });

    const parsed = JSON.parse(requestJson) as {
      schema: string;
      passportNoirVersion: string;
      dataGroups: Record<string, string>;
      devicePublicKeyRawB64: string;
      nonceHashB64: string;
      linkScope: string;
      requireAA: boolean;
      revocationSnapshot: unknown;
    };

    expect(parsed.schema).toBe('gg.solidarity.passport.openac-v3.witness-request.v1');
    expect(parsed.passportNoirVersion).toBe('0.3.0');
    expect(parsed.dataGroups['sod']).toBeDefined();
    expect(parsed.dataGroups['dg1']).toBeDefined();
    expect(parsed.dataGroups['dg15']).toBeDefined();
    expect(parsed.devicePublicKeyRawB64.length).toBeGreaterThan(0);
    expect(parsed.nonceHashB64.length).toBeGreaterThan(0);
    expect(parsed.linkScope).toBe('airmeishi-passport-v3');
    expect(parsed.requireAA).toBe(true);
    expect(parsed.revocationSnapshot).toEqual(REVOCATION_SNAPSHOT);
  });

  it('builds a passive-only witness request without DG15 when AA is not required', () => {
    const requestJson = buildPassportOpenAcV3WitnessRequestJson({
      chip: readResult({ dataGroups: { dg1: bytes('dg1'), sod: bytes('sod') } }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
      devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
      nonceHash: Uint8Array.from(byteArray(32, 151)),
      linkScope: 'airmeishi-passport-v3',
      requireAA: false,
    });

    const parsed = JSON.parse(requestJson) as {
      dataGroups: Record<string, string>;
      requireAA: boolean;
      activeAuth?: unknown;
    };
    expect(parsed.dataGroups['sod']).toBeDefined();
    expect(parsed.dataGroups['dg1']).toBeDefined();
    expect(parsed.dataGroups).not.toHaveProperty('dg15');
    expect(parsed.requireAA).toBe(false);
    expect(parsed).not.toHaveProperty('activeAuth');
  });

  it('omits chain-bound DG15 bytes from the witness request when AA is not required', () => {
    // RSA-AA chip shape: DG15 bytes were read, but no usable ECDSA evidence
    // exists. The request must not carry dg15 — the Rust builder fails
    // closed on (Some(dg15), no evidence), so the passive path requires the
    // DG15 slot to stay empty (dg_count = 1, placeholder triple).
    const requestJson = buildPassportOpenAcV3WitnessRequestJson({
      chip: readResult({ activeAuthJson: undefined }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
      devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
      nonceHash: Uint8Array.from(byteArray(32, 151)),
      linkScope: 'airmeishi-passport-v3',
      requireAA: false,
    });

    const parsed = JSON.parse(requestJson) as {
      dataGroups: Record<string, string>;
      requireAA: boolean;
      activeAuth?: unknown;
    };
    expect(parsed.dataGroups['sod']).toBeDefined();
    expect(parsed.dataGroups['dg1']).toBeDefined();
    expect(parsed.dataGroups).not.toHaveProperty('dg15');
    expect(parsed.requireAA).toBe(false);
    expect(parsed).not.toHaveProperty('activeAuth');
  });

  it('threads DG15 Active Authentication evidence into the witness request', async () => {
    const { parsePassportOpenAcV3ActiveAuthJson } = await import(
      '../../src/passport/openacV3'
    );
    const activeAuthJson = JSON.stringify({
      challengeB64: 'Y2hhbGxlbmdl',
      signatureRawB64: 'c2lnbmF0dXJl',
    });
    const activeAuth = parsePassportOpenAcV3ActiveAuthJson(activeAuthJson);
    expect(activeAuth).toEqual({
      challengeB64: 'Y2hhbGxlbmdl',
      signatureRawB64: 'c2lnbmF0dXJl',
    });

    const requestJson = buildPassportOpenAcV3WitnessRequestJson({
      chip: readResult(),
      revocationSnapshot: REVOCATION_SNAPSHOT,
      devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
      nonceHash: Uint8Array.from(byteArray(32, 151)),
      linkScope: 'airmeishi-passport-v3',
      requireAA: true,
      activeAuth: activeAuth ?? undefined,
    });
    const parsed = JSON.parse(requestJson) as {
      activeAuth?: { challengeB64: string; signatureRawB64: string };
    };
    expect(parsed.activeAuth).toEqual({
      challengeB64: 'Y2hhbGxlbmdl',
      signatureRawB64: 'c2lnbmF0dXJl',
    });
  });

  it('omits activeAuth and returns null for malformed AA evidence', async () => {
    const { parsePassportOpenAcV3ActiveAuthJson } = await import(
      '../../src/passport/openacV3'
    );
    expect(parsePassportOpenAcV3ActiveAuthJson(undefined)).toBe(null);
    expect(parsePassportOpenAcV3ActiveAuthJson('not json')).toBe(null);
    expect(parsePassportOpenAcV3ActiveAuthJson('{"challengeB64":"x"}')).toBe(null);

    const requestJson = buildPassportOpenAcV3WitnessRequestJson({
      chip: readResult(),
      revocationSnapshot: REVOCATION_SNAPSHOT,
      devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
      nonceHash: Uint8Array.from(byteArray(32, 151)),
      linkScope: 'airmeishi-passport-v3',
      requireAA: true,
    });
    expect(JSON.parse(requestJson)).not.toHaveProperty('activeAuth');
  });

  it('returns the shared Rust witness bundle only when the builder reports ready', async () => {
    const bundleJson = JSON.stringify({
      dscChainInputsJson: '{"dsc":true}',
      passportAdapterInputsJson: '{"passport":true}',
      openAcShowInputsJson: '{"show":true}',
    });

    await expect(
      buildPassportOpenAcV3WitnessBundleJson({
        chip: readResult(),
        revocationSnapshot: REVOCATION_SNAPSHOT,
        devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
        nonceHash: Uint8Array.from(byteArray(32, 151)),
        linkScope: 'airmeishi-passport-v3',
        requireAA: true,
        builder: {
          buildOpenAcV3WitnessBundle: async (requestJson) => {
            expect(requestJson).toContain('openac-v3.witness-request.v1');
            return {
              schema: 'gg.solidarity.passport.openac-v3.witness-build-result.v1',
              passportNoirVersion: '0.3.0',
              ready: true,
              bundleJson,
            };
          },
        },
      })
    ).resolves.toBe(bundleJson);
  });

  it('rebuilds a passive-only witness bundle at proof time when the read-stage witness is missing', async () => {
    const bundleJson = JSON.stringify({
      dscChainInputsJson: '{"dsc":true}',
      passportAdapterInputsJson: '{"passport":true}',
      openAcShowInputsJson: '{"show":true}',
    });
    const requests: unknown[] = [];

    await expect(
      resolvePassportOpenAcV3WitnessBundleJson({
        existingWitnessBundleJson: undefined,
        chip: readResult({
          dataGroups: { dg1: bytes('dg1'), sod: bytes('sod') },
          activeAuthJson: undefined,
        }),
        revocationSnapshot: REVOCATION_SNAPSHOT,
        devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
        nonceHash: Uint8Array.from(byteArray(32, 151)),
        linkScope: 'airmeishi-passport-v3',
        builder: {
          buildOpenAcV3WitnessBundle: async (requestJson) => {
            requests.push(JSON.parse(requestJson));
            return {
              schema: 'gg.solidarity.passport.openac-v3.witness-build-result.v1',
              passportNoirVersion: '0.3.0',
              ready: true,
              bundleJson,
            };
          },
        },
      })
    ).resolves.toBe(bundleJson);

    expect(requests.length).toBe(1);
    const request = requests[0] as {
      dataGroups: Record<string, string>;
      requireAA: boolean;
      activeAuth?: unknown;
    };
    expect(request.requireAA).toBe(false);
    expect(request.dataGroups['sod']).toBeDefined();
    expect(request.dataGroups['dg1']).toBeDefined();
    expect(request.dataGroups).not.toHaveProperty('dg15');
    expect(request).not.toHaveProperty('activeAuth');
  });

  it('resolves a passive-only witness request for a chip with DG15 bytes but no AA evidence', async () => {
    const bundleJson = JSON.stringify({
      dscChainInputsJson: '{"dsc":true}',
      passportAdapterInputsJson: '{"passport":true}',
      openAcShowInputsJson: '{"show":true}',
    });
    const requests: unknown[] = [];

    await expect(
      resolvePassportOpenAcV3WitnessBundleJson({
        existingWitnessBundleJson: undefined,
        chip: readResult({ activeAuthJson: undefined }),
        revocationSnapshot: REVOCATION_SNAPSHOT,
        devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
        nonceHash: Uint8Array.from(byteArray(32, 151)),
        linkScope: 'airmeishi-passport-v3',
        builder: {
          buildOpenAcV3WitnessBundle: async (requestJson) => {
            requests.push(JSON.parse(requestJson));
            return {
              schema: 'gg.solidarity.passport.openac-v3.witness-build-result.v1',
              passportNoirVersion: '0.3.0',
              ready: true,
              bundleJson,
            };
          },
        },
      })
    ).resolves.toBe(bundleJson);

    expect(requests.length).toBe(1);
    const request = requests[0] as {
      dataGroups: Record<string, string>;
      requireAA: boolean;
      activeAuth?: unknown;
    };
    expect(request.requireAA).toBe(false);
    expect(request.dataGroups).not.toHaveProperty('dg15');
    expect(request).not.toHaveProperty('activeAuth');
  });

  it('uses an existing valid witness bundle without calling the proof-stage builder', async () => {
    const bundleJson = JSON.stringify({
      dscChainInputsJson: '{"dsc":true}',
      passportAdapterInputsJson: '{"passport":true}',
      openAcShowInputsJson: '{"show":true}',
    });

    const resolved = await resolvePassportOpenAcV3WitnessBundleJson({
      existingWitnessBundleJson: bundleJson,
      chip: readResult(),
      revocationSnapshot: REVOCATION_SNAPSHOT,
      devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
      nonceHash: Uint8Array.from(byteArray(32, 151)),
      linkScope: 'airmeishi-passport-v3',
      builder: {
        buildOpenAcV3WitnessBundle: async () => {
          throw new Error('builder should not be called');
        },
      },
    });

    expect(resolved).toBe(bundleJson);
  });

  it('fails closed with the shared Rust witness unavailable reason', async () => {
    await expect(
      buildPassportOpenAcV3WitnessBundleJson({
        chip: readResult(),
        revocationSnapshot: REVOCATION_SNAPSHOT,
        devicePublicKeyRaw: Uint8Array.from([...byteArray(32, 11), ...byteArray(32, 71)]),
        nonceHash: Uint8Array.from(byteArray(32, 151)),
        linkScope: 'airmeishi-passport-v3',
        requireAA: true,
        builder: {
          buildOpenAcV3WitnessBundle: async () => ({
            schema: 'gg.solidarity.passport.openac-v3.witness-build-result.v1',
            passportNoirVersion: '0.3.0',
            ready: false,
            reason: 'missing-active-auth-witness',
          }),
        },
      })
    ).rejects.toThrow('OpenAC v3 witness unavailable: missing-active-auth-witness');
  });

  it('binds the OpenAC show witness to a fresh raw device signature', async () => {
    const publicKeyRaw = Uint8Array.from([
      ...byteArray(32, 1),
      ...byteArray(32, 101),
    ]);
    const signature = Uint8Array.from(byteArray(64, 201));
    const nonceHash = byteArray(32, 31);

    const result = await bindPassportOpenAcV3DeviceSignature(
      {
        dscChainInputsJson: '{"dsc":true}',
        passportAdapterInputsJson: JSON.stringify({
          enclave_pk_x: witnessBytes(32, 1),
          enclave_pk_y: witnessBytes(32, 101),
        }),
        openAcShowInputsJson: JSON.stringify({
          nonce_hash: nonceHash.map(String),
          enclave_pk_x: witnessBytes(32, 1),
          enclave_pk_y: witnessBytes(32, 101),
          signature: witnessBytes(64, 0),
        }),
      },
      async (digest) => {
        expect(Array.from(digest)).toEqual(nonceHash);
        return { signature, publicKeyRaw };
      }
    );

    expect(result.ready).toBe(true);
    if (!result.ready) return;
    const show = JSON.parse(result.witnesses.openAcShowInputsJson) as Record<
      string,
      unknown
    >;
    expect(show['signature']).toEqual(Array.from(signature, String));
    expect(show['enclave_pk_x']).toEqual(witnessBytes(32, 1));
    expect(show['enclave_pk_y']).toEqual(witnessBytes(32, 101));
    // Native prover contract: every witness value must stay a string array
    // ({ [string]: string[] } — PassportZk Code=2 rejects anything else).
    const nonStringArrayKeys = Object.entries(show)
      .filter(
        ([, value]) =>
          !Array.isArray(value) ||
          value.some((item) => typeof item !== 'string')
      )
      .map(([key]) => key);
    expect(nonStringArrayKeys).toEqual([]);
  });

  it('fails closed when OpenAC device binding witness material is missing or mismatched', async () => {
    const signer = async () => ({
      signature: Uint8Array.from(byteArray(64, 1)),
      publicKeyRaw: Uint8Array.from([...byteArray(32, 2), ...byteArray(32, 3)]),
    });

    const missing = await bindPassportOpenAcV3DeviceSignature(
      {
        dscChainInputsJson: '{"dsc":true}',
        passportAdapterInputsJson: '{"passport":true}',
        openAcShowInputsJson: JSON.stringify({
          nonce_hash: witnessBytes(32, 1),
        }),
      },
      signer
    );
    expect(missing).toEqual({
      ready: false,
      reason: 'missing-device-public-key',
    });

    const mismatched = await bindPassportOpenAcV3DeviceSignature(
      {
        dscChainInputsJson: '{"dsc":true}',
        passportAdapterInputsJson: JSON.stringify({
          enclave_pk_x: witnessBytes(32, 9),
          enclave_pk_y: witnessBytes(32, 9),
        }),
        openAcShowInputsJson: JSON.stringify({
          nonce_hash: witnessBytes(32, 1),
          enclave_pk_x: witnessBytes(32, 9),
          enclave_pk_y: witnessBytes(32, 9),
        }),
      },
      signer
    );
    expect(mismatched).toEqual({
      ready: false,
      reason: 'device-public-key-mismatch',
    });
  });

  it('marks a passive-authenticated real chip without DG15 as passive-only v3-ready', () => {
    const readiness = assessPassportOpenAcV3Readiness({
      ...readResult({
        activeAuthJson: undefined,
        dataGroups: { dg1: bytes('dg1'), sod: bytes('sod') },
      }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });
    expect(readiness.ready).toBe(true);
    if (readiness.ready) {
      expect(readiness.requiredDataGroups).toEqual(['SOD', 'DG1']);
      expect(readiness.aaMode).toBe('passive');
    }

    const plan = buildPassportOpenAcV3ProofPlan({
      ...readResult({
        activeAuthJson: undefined,
        dataGroups: { dg1: bytes('dg1'), sod: bytes('sod') },
      }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });
    expect(plan.kind).toBe('openac-v3');

    const readStageDecision = shouldPreparePassportOpenAcV3WitnessDuringRead({
      ...readResult({
        activeAuthJson: undefined,
        dataGroups: { dg1: bytes('dg1'), sod: bytes('sod') },
      }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });
    expect(readStageDecision.prepare).toBe(true);
  });

  it('degrades to passive-only when DG15 is present but AA evidence is absent', () => {
    // A chain-bound DG15 key without the chip's signature cannot produce a
    // verifying witness (the prover constrains only succeeding ECDSA), so
    // the chip routes to the passive-only path (require_aa = false, DG15
    // kept out of the witness request) instead of losing the ZK path. This
    // is the RSA-AA passport shape: the native reader only emits evidence
    // for ECDSA-P256 AA keys.
    const readiness = assessPassportOpenAcV3Readiness({
      ...readResult({ activeAuthJson: undefined }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });
    expect(readiness.ready).toBe(true);
    if (readiness.ready) {
      expect(readiness.aaMode).toBe('passive');
    }

    const plan = buildPassportOpenAcV3ProofPlan({
      ...readResult({ activeAuthJson: undefined }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });
    expect(plan.kind).toBe('openac-v3');
  });

  it('marks a passive-authenticated real chip with SOD/DG1/DG15, AA evidence, and revocation snapshot as v3-ready', () => {
    const readiness = assessPassportOpenAcV3Readiness({
      ...readResult(),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });

    expect(readiness.ready).toBe(true);
    if (readiness.ready) {
      expect(readiness.requiredDataGroups).toEqual(['SOD', 'DG1']);
      expect(readiness.aaMode).toBe('active');
    }
  });

  it('fails closed when OpenAC v3 inputs are missing or untrusted', () => {
    const missing = assessPassportOpenAcV3Readiness(
      readResult({ dataGroups: { dg1: bytes('dg1') } })
    );
    expect(missing.ready).toBe(false);
    if (!missing.ready) {
      expect(missing.reason).toBe('missing-data-groups');
      expect(missing.missingDataGroups).toEqual(['SOD']);
    }

    const untrusted = assessPassportOpenAcV3Readiness(
      {
        ...readResult({ passiveAuthValid: false }),
        revocationSnapshot: REVOCATION_SNAPSHOT,
      }
    );
    expect(untrusted.ready).toBe(false);
    if (!untrusted.ready) expect(untrusted.reason).toBe('passive-auth-failed');
  });

  it('does not require read-stage witness preparation when passive auth is unavailable', () => {
    const decision = shouldPreparePassportOpenAcV3WitnessDuringRead({
      ...readResult({ passiveAuthValid: false }),
      revocationSnapshot: REVOCATION_SNAPSHOT,
    });

    expect(decision.prepare).toBe(false);
    expect(decision.reason).toBe('passive-auth-failed');
  });

  it('allows SD-JWT fallback proof only for simulated passport chips', () => {
    expect(
      shouldAllowPassportOpenAcV3FallbackProof({ isSimulated: true })
    ).toBe(true);
    expect(
      shouldAllowPassportOpenAcV3FallbackProof({ isSimulated: false })
    ).toBe(false);
    expect(shouldAllowPassportOpenAcV3FallbackProof({})).toBe(false);
  });

  it('fails closed when the revocation snapshot is missing or malformed', () => {
    const missing = assessPassportOpenAcV3Readiness(readResult());
    expect(missing.ready).toBe(false);
    if (!missing.ready) expect(missing.reason).toBe('missing-revocation-snapshot');

    const malformed = assessPassportOpenAcV3Readiness({
      ...readResult(),
      revocationSnapshot: {
        ...REVOCATION_SNAPSHOT,
        sourceCount: 0,
        sources: [],
      },
    });
    expect(malformed.ready).toBe(false);
    if (!malformed.ready) expect(malformed.reason).toBe('invalid-revocation-snapshot');
  });
});
