/**
 * derive.ts — unified mnemonic derivation (BIP-39 -> HKDF-SHA256 ->
 * curve-order-reduced scalar) round trip: same (mnemonic, info) always
 * derives the identical scalar; distinct info labels (HKDF_INFO_ROOT vs
 * HKDF_INFO_NOSTR) derive unrelated keys from the same mnemonic. Plus
 * consumption of the frozen conformance vectors in ../vectors/derive.json
 * — the App<->Web mnemonic-portability conformance basis (04-plan Phase
 * A1 amendment; the web viewer's W1 replays this same file).
 */
import { describe, expect, test } from 'bun:test';
import { schnorr } from '@noble/curves/secp256k1.js';

import {
  HKDF_INFO_NOSTR,
  HKDF_INFO_ROOT,
  deriveBackupKeyFromMnemonic,
  deriveP256Scalar,
  deriveSecp256k1Scalar,
  generateMnemonic,
} from '../src/derive';
import { didKeyFromPublicKey, publicKeyFromPrivate } from '../src/identity';
import { bytesToHex } from '../src/crypto/hex';
import vectors from '../vectors/derive.json';

// Standard BIP-39 test-vector mnemonics (Trezor/bitcoinjs conformance list) —
// not app-specific secrets, safe to pin in source.
const FIXED_MNEMONIC_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const FIXED_MNEMONIC_B = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
// Same word list as FIXED_MNEMONIC_A's "about"-ending sibling, but with a
// broken checksum (all-"abandon" is the canonical invalid-checksum fixture
// used by the BIP-39 reference test suite).
const INVALID_CHECKSUM_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';

describe('deriveP256Scalar / deriveSecp256k1Scalar — determinism + separation', () => {
  test('is deterministic: same (mnemonic, info) -> identical scalar across repeated calls', () => {
    const a = deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT);
    const b = deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT);
    expect(bytesToHex(a)).toBe(bytesToHex(b));

    const c = deriveSecp256k1Scalar(FIXED_MNEMONIC_A, HKDF_INFO_NOSTR);
    const d = deriveSecp256k1Scalar(FIXED_MNEMONIC_A, HKDF_INFO_NOSTR);
    expect(bytesToHex(c)).toBe(bytesToHex(d));
  });

  test('returns a 32-byte scalar for both curves', () => {
    expect(deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT).length).toBe(32);
    expect(deriveSecp256k1Scalar(FIXED_MNEMONIC_A, HKDF_INFO_NOSTR).length).toBe(32);
  });

  test('info-string separation: HKDF_INFO_ROOT vs HKDF_INFO_NOSTR derive different scalars on the same curve from the same mnemonic', () => {
    const rootScalar = deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT);
    const nostrLabelOnP256 = deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_NOSTR);
    expect(bytesToHex(rootScalar)).not.toBe(bytesToHex(nostrLabelOnP256));
  });

  test('curve separation: deriveP256Scalar and deriveSecp256k1Scalar differ for the same (mnemonic, info)', () => {
    const p = deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT);
    const k = deriveSecp256k1Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT);
    expect(bytesToHex(p)).not.toBe(bytesToHex(k));
  });

  test('different mnemonics derive different scalars for the same info', () => {
    const a = deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT);
    const b = deriveP256Scalar(FIXED_MNEMONIC_B, HKDF_INFO_ROOT);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test('throws RangeError on a mnemonic with a broken BIP-39 checksum', () => {
    expect(() => deriveP256Scalar(INVALID_CHECKSUM_MNEMONIC, HKDF_INFO_ROOT)).toThrow(RangeError);
    expect(() => deriveSecp256k1Scalar(INVALID_CHECKSUM_MNEMONIC, HKDF_INFO_NOSTR)).toThrow(RangeError);
  });

  test('throws RangeError on a non-BIP-39 sentence', () => {
    expect(() => deriveP256Scalar('not a real mnemonic at all just some words', HKDF_INFO_ROOT)).toThrow(RangeError);
  });
});

describe('deriveBackupKeyFromMnemonic — Portable Backup Key (SOLB v2)', () => {
  test('is deterministic and returns a 32-byte AES key', () => {
    const a = deriveBackupKeyFromMnemonic(FIXED_MNEMONIC_A);
    const b = deriveBackupKeyFromMnemonic(FIXED_MNEMONIC_A);
    expect(a.length).toBe(32);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  test('domain separation: the backup key shares no material with the root/nostr scalars from the same mnemonic', () => {
    const backup = bytesToHex(deriveBackupKeyFromMnemonic(FIXED_MNEMONIC_A));
    const root = bytesToHex(deriveP256Scalar(FIXED_MNEMONIC_A, HKDF_INFO_ROOT));
    const nostr = bytesToHex(deriveSecp256k1Scalar(FIXED_MNEMONIC_A, HKDF_INFO_NOSTR));
    expect(backup).not.toBe(root);
    expect(backup).not.toBe(nostr);
  });

  test('different mnemonics derive different backup keys', () => {
    const a = bytesToHex(deriveBackupKeyFromMnemonic(FIXED_MNEMONIC_A));
    const b = bytesToHex(deriveBackupKeyFromMnemonic(FIXED_MNEMONIC_B));
    expect(a).not.toBe(b);
  });

  test('validates the BIP-39 checksum before deriving (throws RangeError, never a usable key)', () => {
    expect(() => deriveBackupKeyFromMnemonic(INVALID_CHECKSUM_MNEMONIC)).toThrow(RangeError);
    expect(() => deriveBackupKeyFromMnemonic('not a real mnemonic at all just some words')).toThrow(RangeError);
  });
});

describe('generateMnemonic', () => {
  test('produces a 24-word (256-bit) valid BIP-39 English mnemonic usable by deriveP256Scalar', () => {
    const m = generateMnemonic();
    expect(m.split(' ').length).toBe(24);
    expect(() => deriveP256Scalar(m, HKDF_INFO_ROOT)).not.toThrow();
  });

  test('produces different mnemonics across calls', () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });
});

describe('derive.json conformance vectors — App/Web mnemonic portability', () => {
  for (const v of vectors.valid) {
    test(v.name, () => {
      const p256Scalar = deriveP256Scalar(v.mnemonic, HKDF_INFO_ROOT);
      const did = didKeyFromPublicKey(publicKeyFromPrivate(p256Scalar));
      expect(did).toBe(v.did);

      const k1Scalar = deriveSecp256k1Scalar(v.mnemonic, HKDF_INFO_NOSTR);
      const nostrPubkeyHex = bytesToHex(schnorr.getPublicKey(k1Scalar));
      expect(nostrPubkeyHex).toBe(v.nostrPubkeyHex);

      // Portable Backup Key (SOLB v2) — frozen so the web viewer can replay the
      // same phrase and derive the same archive key for cross-device restore.
      expect(bytesToHex(deriveBackupKeyFromMnemonic(v.mnemonic))).toBe(v.backupKeyHex);
    });
  }

  for (const v of vectors.invalid) {
    test(v.name, () => {
      let caught: unknown;
      try {
        deriveP256Scalar(v.mnemonic, HKDF_INFO_ROOT);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RangeError);
      expect((caught as Error).message).toContain(v.errorContains);
    });
  }
});
