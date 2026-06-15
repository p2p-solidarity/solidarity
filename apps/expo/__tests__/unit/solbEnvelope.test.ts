/**
 * SOLB envelope unit tests — the 5-byte header framing that keeps Expo
 * backups byte-compatible with the SwiftUI app's `.solbk` files.
 *
 * Reference: solidarity/Services/Backup/BackupManager.swift decodeBackup
 *   "SOLB" (0x53 0x4F 0x4C 0x42) || 0x01 (version) || AES-GCM(ciphertext)
 */
import { describe, expect, it } from 'bun:test';

import { base64Decode, base64Encode, utf8ToBytes } from '@solidarity/shared';

import { decodeSolb, encodeSolb } from '../../src/backup/solbEnvelope';

describe('SOLB envelope', () => {
  it('encode → decode round-trips the ciphertext unchanged', () => {
    const ciphertextB64 = base64Encode(utf8ToBytes('any-aes-gcm-bytes-here'));
    const file = encodeSolb(ciphertextB64);
    expect(decodeSolb(file)).toBe(ciphertextB64);
  });

  it('prepends the "SOLB" magic + version byte (Swift wire format)', () => {
    const ciphertextB64 = base64Encode(new Uint8Array([1, 2, 3]));
    const bytes = base64Decode(encodeSolb(ciphertextB64));
    expect(Array.from(bytes.subarray(0, 5))).toEqual([0x53, 0x4f, 0x4c, 0x42, 0x01]);
    expect(Array.from(bytes.subarray(5))).toEqual([1, 2, 3]);
  });

  it('refuses a legacy plaintext backup (starts with "{")', () => {
    const plaintext = base64Encode(utf8ToBytes('{"version":1,"businessCards":[]}'));
    expect(() => decodeSolb(plaintext)).toThrow(/Legacy plaintext/);
  });

  it('rejects an unsupported version byte', () => {
    const raw = new Uint8Array([0x53, 0x4f, 0x4c, 0x42, 0x02, 9, 9, 9]);
    expect(() => decodeSolb(base64Encode(raw))).toThrow(/Unsupported backup version/);
  });

  it('rejects an unrecognised (non-SOLB, non-JSON) format', () => {
    const garbage = base64Encode(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));
    expect(() => decodeSolb(garbage)).toThrow(/Unrecognized backup format/);
  });
});
