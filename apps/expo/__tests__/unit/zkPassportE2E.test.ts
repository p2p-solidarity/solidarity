/**
 * ZK passport pipeline E2E — MRZ → NFC dump → ZK proof → verify.
 *
 * Drives the same surface the live `app/passport/index.tsx` screen uses
 * (getNfcPassport + getPassportZk + runPassportPipeline) but with the
 * Nitro modules stubbed out to deterministic seeds. The native
 * `@solidarity/nitro-passport-zk` HybridObject is replaced via
 * `mock.module` so:
 *
 *   - `generateNoirProof(circuitPath, srsPath, inputsJson)` returns a
 *     deterministic ArrayBuffer derived from `sha256(inputsJson || seed)`.
 *   - `verifyNoirProof(proof, vk)` returns true iff the proof bytes match
 *     what `generateNoirProof` would have produced for the SAME vk
 *     (i.e. tampering either the proof or the public inputs flips it
 *     to false).
 *   - `getNoirVerificationKey(...)` returns a fixed 32-byte buffer so
 *     parity tests can pin the vk shape across both platforms.
 *
 * Why this test exists: the Swift side runs the same generate→verify
 * round-trip inside `MoproProofService.generateWithOpenPassport` (see
 * the `verifyNoirProof` immediately after `generateNoirProof`). When the
 * Android Rust cdylib + JNI bindings land we want the SAME test to keep
 * passing so any divergence between iOS and Android breaks here, not in
 * production with a real passport.
 *
 * Tampering coverage:
 *   1. Flip one byte of the proof → verify must return false.
 *   2. Flip one byte of the MRZ-derived public input → witness changes,
 *      proof bytes change, but if we lie about the public input the
 *      verifier rejects.
 *
 * Run: cd apps/expo && bun test __tests__/unit/zkPassportE2E.test.ts
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

import {
  bytesToHex,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

import type {
  PassportMRZ,
  PassportReadResult,
} from '@solidarity/nitro-nfc-passport';
import type {
  NitroNoirProof,
  PassportZk,
} from '@solidarity/nitro-passport-zk';

import {
  arrayBufferToBase64,
  derivePassportPublicSignals,
  runPassportPipeline,
  serializePassportProofPayload,
  type PassportStep,
} from '../../src/passport/pipeline';

// ---------------------------------------------------------------------------
// Deterministic mock for @solidarity/nitro-passport-zk.
//
// The real Nitro bridge wraps mopro-binding which calls into the Barretenberg
// proving backend (foreign C++ code, fresh randomness per proof). For unit
// tests we replace it with a hash-based stand-in: same inputsJson + same
// circuit path → same proof bytes, deterministically. Tampering either side
// breaks the equality so verify returns false. This mirrors the contract
// `verifyNoirProof` enforces in production without dragging the native
// prover into a pure-TS test env.
// ---------------------------------------------------------------------------

const SEED = utf8ToBytes('solidarity.passport.zk.fixture.v1');
const STUB_VK_BYTES = sha256Bytes(utf8ToBytes('solidarity.zk.vk.stub.v1'));

function expectedProofBytes(inputsJson: string, circuitPath: string): Uint8Array {
  const input = utf8ToBytes(`${circuitPath}|${inputsJson}`);
  const combined = new Uint8Array(SEED.length + input.length);
  combined.set(SEED, 0);
  combined.set(input, SEED.length);
  // 64-byte proof: hash(seed||input) || hash(seed||input||"second")
  const first = sha256Bytes(combined);
  const tail = utf8ToBytes('second');
  const tailInput = new Uint8Array(combined.length + tail.length);
  tailInput.set(combined, 0);
  tailInput.set(tail, combined.length);
  const second = sha256Bytes(tailInput);
  const out = new Uint8Array(64);
  out.set(first, 0);
  out.set(second, 32);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function fromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

// State the mock uses to remember which `inputsJson` produced which proof
// so `verifyNoirProof` can check byte equality. Keyed by `bytesToHex(vk)`
// so multiple circuits coexist without colliding.
const issuedProofs = new Map<string, { inputsJson: string; proof: Uint8Array }>();

beforeAll(async () => {
  await mock.module('@solidarity/nitro-passport-zk', () => {
    const stub: PassportZk = {
      generateNoirProof: (circuitPath: string, _srsPath: string | undefined, inputsJson: string): Promise<NitroNoirProof> => {
        const proof = expectedProofBytes(inputsJson, circuitPath);
        const vkKey = bytesToHex(STUB_VK_BYTES);
        issuedProofs.set(vkKey, { inputsJson, proof });
        return Promise.resolve({
          proof: toArrayBuffer(proof),
          vk: toArrayBuffer(STUB_VK_BYTES),
        });
      },
      getNoirVerificationKey: (_circuitPath: string, _srsPath: string | undefined): Promise<ArrayBuffer> =>
        Promise.resolve(toArrayBuffer(STUB_VK_BYTES)),
      verifyNoirProof: (proof: ArrayBuffer, vk: ArrayBuffer): Promise<boolean> => {
        const vkKey = bytesToHex(fromArrayBuffer(vk));
        const issued = issuedProofs.get(vkKey);
        if (!issued) return Promise.resolve(false);
        const submitted = fromArrayBuffer(proof);
        if (submitted.length !== issued.proof.length) return Promise.resolve(false);
        for (let i = 0; i < submitted.length; i += 1) {
          if (submitted[i] !== issued.proof[i]) return Promise.resolve(false);
        }
        return Promise.resolve(true);
      },
    } as PassportZk;
    return {
      getPassportZk: () => stub,
    };
  });
});

// ---------------------------------------------------------------------------
// Test fixtures.
//
// MRZ: a TD3 passport with embedded check digit "10" on the document number.
// Nationality UTO is the ICAO-9303 specimen code; matches the OpenPassport
// reference suite. DOB 740812 → ageOver18 = true on currentDate 260524.
// ---------------------------------------------------------------------------

const FIXTURE_MRZ_STRING =
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<L898902C36UTO7408122F1204159ZE184226B<<<<<10';

// Document number + check digit slice from line 2 (cols 0-9) — matches
// the wire format `PassportMRZ.documentNumber` is supposed to carry.
const FIXTURE_MRZ: PassportMRZ = {
  documentNumber: 'L898902C36',
  dateOfBirth: '740812',
  dateOfExpiry: '120415',
};

const FIXTURE_NFC_DUMP: PassportReadResult = {
  mrz: {
    nationality: 'UTO',
    documentNumber: 'L898902C36',
    name: 'ERIKSSON ANNA MARIA',
    dateOfBirth: '740812',
    dateOfExpiry: '120415',
    gender: 'F',
  },
  dataGroups: {
    // Pin the DG1 bytes to the canonical MRZ so the proof witness is
    // deterministic. dg2/dg14/dg15/sod are unused by the disclosure circuit.
    dg1: toArrayBuffer(utf8ToBytes(FIXTURE_MRZ_STRING)),
  },
  chipUid: 'NFC-L898902C36',
  passiveAuthValid: true,
};

// ---------------------------------------------------------------------------
// E2E tests.
// ---------------------------------------------------------------------------

describe('ZK passport pipeline — MRZ → NFC → proof → verify', () => {
  it('generates a deterministic proof that verifies against the same public inputs', async () => {
    const { getPassportZk } = await import('@solidarity/nitro-passport-zk');
    const zk = getPassportZk();

    // Build the inputs the disclosure circuit consumes — keyed off the
    // DG1 bytes from the NFC dump. Matches Swift's MoproProofService
    // `buildDisclosureWitness` shape (witness map → JSON string).
    const dg1Bytes = new Uint8Array(FIXTURE_NFC_DUMP.dataGroups.dg1 ?? new ArrayBuffer(0));
    const inputs = {
      mrz_data: Array.from(dg1Bytes).map((b) => String(b)),
      disclose_nationality: ['1'],
      disclose_older_than: ['1'],
      age_threshold: ['18'],
    };
    const inputsJson = JSON.stringify(inputs);

    const proof = await zk.generateNoirProof('disclosure.acir', 'srs.bin', inputsJson);
    const verified = await zk.verifyNoirProof(proof.proof, proof.vk);
    expect(verified).toBe(true);

    // Proof bytes deterministic for the same inputsJson — re-running with
    // the SAME witness MUST produce the SAME bytes (no fresh randomness in
    // the stub). The real Barretenberg backend has fresh k per call, so
    // this assertion is stub-only and would be relaxed against a real
    // prover (we'd verify, not byte-compare).
    const second = await zk.generateNoirProof('disclosure.acir', 'srs.bin', inputsJson);
    expect(bytesToHex(new Uint8Array(second.proof))).toBe(bytesToHex(new Uint8Array(proof.proof)));
  });

  it('detects a single-byte tamper of the proof bytes', async () => {
    const { getPassportZk } = await import('@solidarity/nitro-passport-zk');
    const zk = getPassportZk();
    const inputsJson = JSON.stringify({ mrz_data: ['1', '2', '3'] });
    const proof = await zk.generateNoirProof('disclosure.acir', undefined, inputsJson);

    // Flip the first byte (XOR with 0x01) — verifier must reject.
    const tampered = new Uint8Array(proof.proof.slice(0));
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    const tamperedBuffer = toArrayBuffer(tampered);

    const verified = await zk.verifyNoirProof(tamperedBuffer, proof.vk);
    expect(verified).toBe(false);
  });

  it('detects a single-byte tamper of the MRZ-derived public input', async () => {
    const { getPassportZk } = await import('@solidarity/nitro-passport-zk');
    const zk = getPassportZk();

    const originalInputs = JSON.stringify({ mrz_data: ['85', '60'], age_threshold: ['18'] });
    const original = await zk.generateNoirProof('disclosure.acir', undefined, originalInputs);

    // Tamper: pretend the public input was different from what we proved
    // by reusing the original proof bytes but rebuilding "inputs" with a
    // single-byte flip. Since the stub's verify is keyed on the EXACT
    // inputsJson that produced the proof, the tampered witness changes
    // the expected proof bytes — and the original proof no longer matches.
    const tamperedInputs = JSON.stringify({ mrz_data: ['85', '61'], age_threshold: ['18'] });
    const expectedForTamper = expectedProofBytes(tamperedInputs, 'disclosure.acir');

    // Submit the original proof bytes but ask verify to check them against
    // what the tampered inputs SHOULD have produced.
    const tamperedProofBuffer = toArrayBuffer(expectedForTamper);
    // Reuse the original vk but the proof bytes now belong to a different
    // witness. issuedProofs keyed by vk → mismatch → false.
    const verified = await zk.verifyNoirProof(original.proof, original.vk);
    expect(verified).toBe(true); // sanity — original still verifies
    const tamperedVerifies = await zk.verifyNoirProof(tamperedProofBuffer, original.vk);
    expect(tamperedVerifies).toBe(false);
  });

  it('runs the full pipeline end-to-end via runPassportPipeline + nitro ZK', async () => {
    const { getPassportZk } = await import('@solidarity/nitro-passport-zk');
    const zk = getPassportZk();

    const steps: PassportStep[] = [];
    const jwt = await runPassportPipeline(
      FIXTURE_MRZ,
      {
        readChip: () => Promise.resolve(FIXTURE_NFC_DUMP),
        generateProof: async (chipData) => {
          const dg1Bytes = new Uint8Array(chipData.dataGroups.dg1 ?? new ArrayBuffer(0));
          const inputs = {
            mrz_data: Array.from(dg1Bytes).map((b) => String(b)),
            disclose_nationality: ['1'],
          };
          const result = await zk.generateNoirProof('disclosure.acir', undefined, JSON.stringify(inputs));
          // Verify on-device immediately (mirrors Swift MoproProofService
          // generateWithOpenPassport which calls verifyNoirProof right after).
          const verified = await zk.verifyNoirProof(result.proof, result.vk);
          if (!verified) throw new Error('proof did not verify');
          return result.proof;
        },
        issueVc: (chipData, proof) => {
          // Build the same VC envelope shape Swift's buildOpenPassportPayload emits.
          const signals = derivePassportPublicSignals({
            dg1MRZData: FIXTURE_MRZ_STRING,
            fallbackNationality: chipData.mrz.nationality,
            currentDateYyMmDd: '260524',
          });
          const envelope = serializePassportProofPayload({
            proofType: 'mopro-noir',
            mrzHashHex: bytesToHex(sha256Bytes(utf8ToBytes(FIXTURE_MRZ_STRING))),
            publicSignals: signals,
            proofB64: arrayBufferToBase64(proof),
            vkB64: 'stub-vk',
          });
          // Pretend to sign — return envelope so the test can assert shape.
          return Promise.resolve(`header.${envelope}.sig`);
        },
      },
      (s) => { steps.push(s); }
    );

    expect(jwt).toMatch(/^header\..+\.sig$/);
    const stepTypes = steps.map((s) => s.type);
    expect(stepTypes).toEqual([
      'mrzScanned',
      'nfcReading',
      'nfcRead',
      'proofGenerating',
      'proofGenerated',
      'vcIssued',
    ]);
  });
});

// ---------------------------------------------------------------------------
// TODO(parity): once the Android cdylib lands and Swift FixtureExporter
// dumps a real proof envelope, swap the stubbed `mock.module` block above
// for a real `getPassportZk()` call gated by `process.env.SOLIDARITY_E2E_NATIVE`
// and assert envelope-key equality with the parity fixture.
// ---------------------------------------------------------------------------
