/**
 * Sakura blob crypto — X25519 ECIES + AES-GCM round trip + tamper-evidence.
 */
import { describe, expect, it } from 'bun:test';

import {
  bytesToHex,
  bytesToUtf8,
  generateRecipientKeyPair,
  openBlob,
  sealBlob,
  utf8ToBytes,
} from '@solidarity/shared';

describe('Sakura blob ECIES + AES-GCM', () => {
  it('round-trips a small payload', () => {
    const r = generateRecipientKeyPair();
    const pt = utf8ToBytes('hello, sakura');
    const blob = sealBlob(r.publicKey, pt);
    const opened = openBlob(r.privateKey, blob);
    expect(bytesToUtf8(opened)).toBe('hello, sakura');
  });

  it('every encryption produces a unique blob (ephemeral keys)', () => {
    const r = generateRecipientKeyPair();
    const pt = utf8ToBytes('hello, sakura');
    const a = sealBlob(r.publicKey, pt);
    const b = sealBlob(r.publicKey, pt);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('decryption with wrong key fails', () => {
    const recipient = generateRecipientKeyPair();
    const eve = generateRecipientKeyPair();
    const blob = sealBlob(recipient.publicKey, utf8ToBytes('secret'));
    expect(() => openBlob(eve.privateKey, blob)).toThrow();
  });

  it('flipped ciphertext byte breaks auth tag', () => {
    const r = generateRecipientKeyPair();
    const blob = sealBlob(r.publicKey, utf8ToBytes('secret'));
    const tampered = new Uint8Array(blob);
    tampered[60] = (tampered[60] ?? 0) ^ 0x01;
    expect(() => openBlob(r.privateKey, tampered)).toThrow();
  });

  it('rejects undersized blobs', () => {
    const r = generateRecipientKeyPair();
    expect(() => openBlob(r.privateKey, new Uint8Array(10))).toThrow();
  });
});
