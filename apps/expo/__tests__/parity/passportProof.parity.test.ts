/**
 * Parity test — passport ZK proof public signals + envelope shape.
 *
 * What this test pins (the bits that ARE deterministic across Swift +
 * TS, even though the proof bytes themselves are not):
 *
 *   1. mrz_hash_hex (SHA-256 over the sanitized DG1 MRZ prefix) MUST
 *      match between Swift `MoproProofService.buildDisclosureWitness`
 *      and TS `derivePassportPublicSignals + sha256Bytes`. Pinned via
 *      the fixture's `expected_public_signals.mrz_hash_hex`.
 *
 *   2. publicSignals payload — { is_human, age_over_18, nationality }
 *      must be byte-equal for the SAME MRZ. Swift derives these in
 *      buildDisclosureWitness, TS in derivePassportPublicSignals; if
 *      either diverges, downstream verifiers (sakura / oidc) silently
 *      accept stale claims.
 *
 *   3. Envelope JSON keys MUST stay alphabetically sorted to match
 *      Swift JSONEncoder(sortedKeys) output. JS's default JSON.stringify
 *      preserves insertion order; serializePassportProofPayload assembles
 *      keys in alpha order so the wire bytes are identical.
 *
 * What we explicitly DO NOT pin (per parity-fixtures README):
 *   - proof_b64 / vk_b64 — randomized per call by Barretenberg.
 *   - generated_at — wall-clock timestamp.
 *
 * Swift side (TODO): wire FixtureExporter to dump
 *   { mrzHashHex, publicSignals[], envelopeJSONSortedKeys[] } so this
 * test can compare against real Swift output instead of just the
 * pinned constants.
 *
 * Run: cd apps/expo && bun test __tests__/parity/passportProof.parity.test.ts
 */
import { describe, expect, it } from 'bun:test';

import {
  bytesToHex,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

import {
  derivePassportPublicSignals,
  serializePassportProofPayload,
} from '../../src/passport/pipeline';

import fixture from '../../../../packages/parity-fixtures/fixtures/passport/passport_proof_reference.json' assert { type: 'json' };

interface PassportFixture {
  readonly schema: string;
  readonly source: string;
  readonly mrz_string: string;
  readonly current_date_yyMMdd: string;
  readonly fallback_nationality: string;
  readonly expected_public_signals: {
    readonly is_human: boolean;
    readonly age_over_18: boolean;
    readonly nationality: string;
    readonly mrz_hash_hex: string;
  };
  readonly expected_envelope_keys_sorted: readonly string[];
  readonly deterministic_seed: string;
}

const fx = fixture as unknown as PassportFixture;

describe('passport ZK proof parity — Swift MoproProofService ↔ TS pipeline', () => {
  it('derives the same MRZ digest hex as Swift SHA256(DG1 prefix 88)', () => {
    // Swift normalizes DG1 with .uppercased() + .filter(isLetter || isNumber || `<`),
    // takes prefix 88, runs SHA256. Our fixture is already normalized — DG1 in
    // the fixture is exactly the 88-char string Swift would produce after
    // sanitization, so a direct SHA256 here matches buildDisclosureWitness.
    const bytes = utf8ToBytes(fx.mrz_string);
    expect(bytes.length).toBe(88);
    const hash = sha256Bytes(bytes);
    expect(bytesToHex(hash)).toBe(fx.expected_public_signals.mrz_hash_hex);
  });

  it('derives the same public signals payload as Swift buildDisclosureWitness', () => {
    const signals = derivePassportPublicSignals({
      dg1MRZData: fx.mrz_string,
      fallbackNationality: fx.fallback_nationality,
      currentDateYyMmDd: fx.current_date_yyMMdd,
    });
    expect(signals.isHuman).toBe(fx.expected_public_signals.is_human);
    expect(signals.ageOver18).toBe(fx.expected_public_signals.age_over_18);
    expect(signals.nationality).toBe(fx.expected_public_signals.nationality);
  });

  it('emits an envelope JSON whose keys match Swift JSONEncoder(sortedKeys)', () => {
    const signals = derivePassportPublicSignals({
      dg1MRZData: fx.mrz_string,
      fallbackNationality: fx.fallback_nationality,
      currentDateYyMmDd: fx.current_date_yyMMdd,
    });
    const envelope = serializePassportProofPayload({
      proofType: 'mopro-noir',
      mrzHashHex: fx.expected_public_signals.mrz_hash_hex,
      publicSignals: signals,
      proofB64: 'aaaa', // any deterministic placeholder — order is what we assert
      vkB64: 'bbbb',
    });
    const parsed = JSON.parse(envelope) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    // JSON.stringify preserves insertion order; we control the literal in
    // serializePassportProofPayload to be alphabetically sorted. The fixture
    // pins the expected order so a careless edit of the serializer flags
    // here instead of in production.
    expect(keys).toEqual([...fx.expected_envelope_keys_sorted]);
  });

  it('produces a byte-identical envelope for the same inputs (deterministic)', () => {
    const signals = derivePassportPublicSignals({
      dg1MRZData: fx.mrz_string,
      fallbackNationality: fx.fallback_nationality,
      currentDateYyMmDd: fx.current_date_yyMMdd,
    });
    const args = {
      proofType: 'mopro-noir',
      mrzHashHex: fx.expected_public_signals.mrz_hash_hex,
      publicSignals: signals,
      proofB64: 'deadbeef',
      vkB64: 'cafebabe',
    } as const;
    const a = serializePassportProofPayload(args);
    const b = serializePassportProofPayload(args);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// TODO(parity): when solidarityTests/FixtureExporter.swift is taught to dump
// `passport_proof_reference.json`, replace the pinned `mrz_hash_hex` field
// in the fixture with whatever Swift emits and re-run this suite. The MRZ
// string itself was hand-pinned to the ICAO 9303 specimen so neither side
// is randomising input — only the proof bytes (Barretenberg) are.
// ---------------------------------------------------------------------------
