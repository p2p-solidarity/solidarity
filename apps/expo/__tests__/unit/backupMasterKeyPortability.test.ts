/**
 * Backup Archive portability — behavioral test (fixed 2026-07-16).
 *
 * Originally CHARACTERIZED the gap: a `.solbk` sealed with a device-local key
 * could not be opened on another device. The fix seals cross-device SOLB v2
 * archives with the Recovery-Phrase-derived **Portable Backup Key** (same
 * phrase → same key on every device). This suite now asserts the DESIRED
 * behavior against the REAL production helpers:
 *   - `encryptJsonWithKey` / `decryptJsonWithKey` (src/storage/jsonCrypto.ts)
 *   - `encodeSolb` / `decodeSolb` v2 (src/backup/solbEnvelope.ts)
 *   - `deriveBackupKeyFromMnemonic` (@solidarity/shared)
 *
 * `jsonCrypto.ts` imports only `@solidarity/shared`, so no expo-secure-store /
 * native module is pulled in — this stays a pure in-process unit test.
 */
import { describe, expect, it } from 'bun:test';

import { deriveBackupKeyFromMnemonic } from '@solidarity/shared';

import { decodeSolb, encodeSolb } from '../../src/backup/solbEnvelope';
import {
  DecryptError,
  decryptJsonWithKey,
  encryptJsonWithKey,
} from '../../src/storage/jsonCrypto';

// Two independently-known-valid BIP-39 phrases (Trezor reference vectors).
const PHRASE_A = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PHRASE_B = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

const PAYLOAD = {
  schemaVersion: 3 as const,
  cards: [{ id: 'c1', name: 'Ada Lovelace' }],
  contacts: [{ id: 'p1', name: 'Alan Turing' }],
  // A Set to exercise jsonReplacer round-tripping through the real helpers.
  publicFields: new Set(['name', 'email']),
};

/** Seal a payload into a v2 SOLB archive under the phrase's Portable Backup Key. */
function sealV2Archive(phrase: string, value: unknown): string {
  const key = deriveBackupKeyFromMnemonic(phrase);
  return encodeSolb(encryptJsonWithKey(key, value), 2);
}

describe('SOLB v2 archive is portable across devices via the Recovery Phrase', () => {
  it('a device holding the SAME Recovery Phrase restores the archive (different Device Storage Keys are irrelevant)', () => {
    const archive = sealV2Archive(PHRASE_A, PAYLOAD);

    // Device B: independent device, no shared Device Storage Key — only the
    // same Recovery Phrase. It derives the identical Portable Backup Key.
    const decoded = decodeSolb(archive);
    expect(decoded.version).toBe(2);
    expect(decoded.keyScheme).toBe('recovery-phrase-hkdf-v1');

    const keyB = deriveBackupKeyFromMnemonic(PHRASE_A);
    const restored = decryptJsonWithKey<typeof PAYLOAD>(keyB, decoded.ciphertextB64);
    expect(restored.cards).toEqual(PAYLOAD.cards);
    expect(restored.contacts).toEqual(PAYLOAD.contacts);
    // jsonReplacer serialised the Set as an array — the real helper's contract.
    expect(restored.publicFields).toEqual(['name', 'email'] as unknown as Set<string>);
  });

  it('a DIFFERENT Recovery Phrase fails the auth tag with a typed DecryptError (never leaks plaintext)', () => {
    const archive = sealV2Archive(PHRASE_A, PAYLOAD);
    const decoded = decodeSolb(archive);
    const wrongKey = deriveBackupKeyFromMnemonic(PHRASE_B);
    expect(() => decryptJsonWithKey(wrongKey, decoded.ciphertextB64)).toThrow(DecryptError);
  });

  it('each seal uses a fresh nonce — reusing one Portable Backup Key across archives is safe', () => {
    const a = sealV2Archive(PHRASE_A, PAYLOAD);
    const b = sealV2Archive(PHRASE_A, PAYLOAD);
    // Same key + same payload, yet the ciphertexts differ (random 96-bit nonce).
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    const keyA = deriveBackupKeyFromMnemonic(PHRASE_A);
    expect(decryptJsonWithKey<typeof PAYLOAD>(keyA, decodeSolb(a).ciphertextB64).cards).toEqual(
      decryptJsonWithKey<typeof PAYLOAD>(keyA, decodeSolb(b).ciphertextB64).cards
    );
  });
});
