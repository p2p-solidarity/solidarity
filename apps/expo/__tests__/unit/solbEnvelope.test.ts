/**
 * SOLB envelope unit tests — the 5-byte header framing whose version byte
 * selects EXACTLY ONE key scheme (device-storage v1 vs recovery-phrase v2).
 *
 * Reference: solidarity/Services/Backup/BackupManager.swift decodeBackup
 *   "SOLB" (0x53 0x4F 0x4C 0x42) || version || AES-GCM(ciphertext)
 */
import { describe, expect, it } from 'bun:test';

import { base64Decode, base64Encode, utf8ToBytes } from '@solidarity/shared';

import { decodeSolb, encodeSolb } from '../../src/backup/solbEnvelope';

describe('SOLB envelope', () => {
  it('defaults to v2 (portable) and round-trips the ciphertext + key scheme', () => {
    const ciphertextB64 = base64Encode(utf8ToBytes('any-aes-gcm-bytes-here'));
    const decoded = decodeSolb(encodeSolb(ciphertextB64));
    expect(decoded.version).toBe(2);
    expect(decoded.keyScheme).toBe('recovery-phrase-hkdf-v1');
    expect(decoded.ciphertextB64).toBe(ciphertextB64);
  });

  it('reads a v1 (device-storage) archive with the legacy key scheme', () => {
    const ciphertextB64 = base64Encode(utf8ToBytes('legacy-device-key-bytes'));
    const decoded = decodeSolb(encodeSolb(ciphertextB64, 1));
    expect(decoded.version).toBe(1);
    expect(decoded.keyScheme).toBe('device-storage-v1');
    expect(decoded.ciphertextB64).toBe(ciphertextB64);
  });

  it('prepends the "SOLB" magic + the correct version byte', () => {
    const ciphertextB64 = base64Encode(new Uint8Array([1, 2, 3]));
    const v1 = base64Decode(encodeSolb(ciphertextB64, 1));
    expect(Array.from(v1.subarray(0, 5))).toEqual([0x53, 0x4f, 0x4c, 0x42, 0x01]);
    expect(Array.from(v1.subarray(5))).toEqual([1, 2, 3]);

    const v2 = base64Decode(encodeSolb(ciphertextB64, 2));
    expect(Array.from(v2.subarray(0, 5))).toEqual([0x53, 0x4f, 0x4c, 0x42, 0x02]);
  });

  it('refuses a legacy plaintext backup (starts with "{")', () => {
    const plaintext = base64Encode(utf8ToBytes('{"version":1,"businessCards":[]}'));
    expect(() => decodeSolb(plaintext)).toThrow(/Legacy plaintext/);
  });

  it('fails closed on an unknown version byte', () => {
    const raw = new Uint8Array([0x53, 0x4f, 0x4c, 0x42, 0x09, 9, 9, 9]);
    expect(() => decodeSolb(base64Encode(raw))).toThrow(/Unsupported backup version/);
  });

  it('rejects an unrecognised (non-SOLB, non-JSON) format', () => {
    const garbage = base64Encode(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));
    expect(() => decodeSolb(garbage)).toThrow(/Unrecognized backup format/);
  });
});
