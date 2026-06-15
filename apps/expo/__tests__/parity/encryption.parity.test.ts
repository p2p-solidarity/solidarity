/**
 * Parity test — AES-256-GCM
 *
 * Reads the golden fixture written by solidarityTests/FixtureExporter.swift
 * (Swift CryptoKit `AES.GCM.seal`) and asserts that:
 *   1. Our TS impl produces byte-equal `nonce || ciphertext || tag` blobs
 *      when given the same (key, nonce, plaintext).
 *   2. Our TS impl can decrypt Swift-produced ciphertexts back to plaintext.
 *
 * If this test fails, either:
 *   - Swift changed its encryption layout (rare), OR
 *   - TS @noble/ciphers diverges from CryptoKit's AES-GCM (very rare), OR
 *   - The fixture is stale (re-run scripts/export_parity_fixtures.sh).
 *
 * Run:
 *   cd apps/expo && bun test __tests__/parity/encryption.parity.test.ts
 */
import { describe, expect, it } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  utf8ToBytes,
} from '@solidarity/shared';

import fixture from '../../../../packages/parity-fixtures/fixtures/encryption/aes_gcm_round_trip.json' assert { type: 'json' };

interface AesCase {
  readonly name: string;
  readonly key: string;
  readonly nonce: string;
  readonly plaintext: string;
  readonly ciphertext: string;
}

const cases = (fixture as { readonly cases: readonly AesCase[] }).cases;

describe('AES-256-GCM parity: Swift CryptoKit ↔ @noble/ciphers', () => {
  for (const c of cases) {
    it(`encrypt: ${c.name}`, () => {
      const key = hexToBytes(c.key);
      const nonce = hexToBytes(c.nonce);
      const pt = utf8ToBytes(c.plaintext);
      const sealed = aesGcmSeal(key, pt, nonce);
      expect(bytesToHex(sealed)).toBe(c.ciphertext);
    });

    it(`decrypt: ${c.name}`, () => {
      const key = hexToBytes(c.key);
      const combined = hexToBytes(c.ciphertext);
      const opened = aesGcmOpen(key, combined);
      expect(bytesToUtf8(opened)).toBe(c.plaintext);
    });
  }
});
