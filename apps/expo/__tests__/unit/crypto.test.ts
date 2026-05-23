/**
 * Unit tests for the @solidarity/shared crypto primitives.
 * (Not parity — pure TS round-trip + golden vectors from RFC 4648.)
 */
import { describe, expect, it } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  generateAesKey,
  hexToBytes,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

describe('AES-256-GCM round trip', () => {
  it('seals + opens', () => {
    const key = generateAesKey();
    const pt = utf8ToBytes('hello world');
    const sealed = aesGcmSeal(key, pt);
    const opened = aesGcmOpen(key, sealed);
    expect(bytesToHex(opened)).toBe(bytesToHex(pt));
  });

  it('rejects truncated ciphertext', () => {
    const key = generateAesKey();
    const sealed = aesGcmSeal(key, utf8ToBytes('test'));
    expect(() => aesGcmOpen(key, sealed.subarray(0, 10))).toThrow();
  });

  it('rejects wrong key', () => {
    const k1 = generateAesKey();
    const k2 = generateAesKey();
    const sealed = aesGcmSeal(k1, utf8ToBytes('secret'));
    expect(() => aesGcmOpen(k2, sealed)).toThrow();
  });
});

describe('base64 / base64url', () => {
  // RFC 4648 test vectors
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('base64(%j) === %j', (input, expected) => {
    expect(base64Encode(utf8ToBytes(input))).toBe(expected);
    expect(new TextDecoder().decode(base64Decode(expected))).toBe(input);
  });

  it('base64url has no padding and uses url-safe chars', () => {
    const bytes = hexToBytes('fbffbe');
    expect(base64UrlEncode(bytes)).toBe('-_--');
    expect(bytesToHex(base64UrlDecode('-_--'))).toBe('fbffbe');
  });
});

describe('SHA-256', () => {
  it('matches the NIST empty-string vector', () => {
    const empty = sha256Bytes('');
    expect(bytesToHex(empty)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
