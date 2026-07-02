/**
 * did:key conformance vectors — packages/shared/src/identity/didKey.ts is an
 * existing, Swift-parity-verified implementation (untouched by this task).
 * These tests pin it against ../vectors/didkey.json so a future regression
 * fails loudly, and so the web viewer can replay the exact same fixed
 * vectors later (03-spec §3 conformance).
 */
import { describe, expect, test } from 'bun:test';

import {
  compressPublicKey,
  didKeyFromPublicKey,
  jwkToPublicKey,
  publicKeyFromPrivate,
  resolveDidKey,
} from '../src/identity';
import { bytesToHex, hexToBytes } from '../src/crypto/hex';
import vectors from '../vectors/didkey.json';

describe('didkey.json — valid vectors round-trip', () => {
  for (const v of vectors.valid) {
    test(v.name, () => {
      const priv = hexToBytes(v.privateKeyHex);
      const pub = publicKeyFromPrivate(priv);
      expect(bytesToHex(pub)).toBe(v.publicKeyUncompressedHex);
      expect(bytesToHex(compressPublicKey(pub))).toBe(v.publicKeyCompressedHex);
      expect(didKeyFromPublicKey(pub)).toBe(v.did);

      const resolvedPub = jwkToPublicKey(resolveDidKey(v.did));
      expect(bytesToHex(resolvedPub)).toBe(v.publicKeyUncompressedHex);
    });
  }
});

describe('didkey.json — invalid vectors are rejected', () => {
  for (const v of vectors.invalid) {
    test(v.name, () => {
      expect(() => resolveDidKey(v.did)).toThrow();
    });
  }
});
