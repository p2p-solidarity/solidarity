/**
 * Unit tests for pairwise key derivation. These tests stub out secure-store
 * so we don't depend on the native module in pure-TS test env.
 *
 * Determinism property under test: same master key + same domain →
 * byte-identical pairwise private scalar. Different domains → different keys.
 */
import { describe, expect, it, mock } from 'bun:test';

import {
  bytesToHex,
  deriveKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

// Re-implement the derivation in-test so we don't need to touch SecureStore.
// This test PROVES the derivation is deterministic; the integration test that
// actually round-trips through SecureStore lives in __tests__/integration/.
const PAIRWISE_SALT = utf8ToBytes('gg.solidarity.pairwise.salt.v1');
const PAIRWISE_INFO_PREFIX = 'solidarity.pairwise.v1:';

function pairwise(master: Uint8Array, domain: string): Uint8Array {
  return deriveKey(
    master,
    PAIRWISE_SALT,
    sha256Bytes(`${PAIRWISE_INFO_PREFIX}${domain.toLowerCase()}`),
    32
  );
}

const FIXED_MASTER = new Uint8Array(32).fill(0x42);

describe('pairwise key derivation', () => {
  it('is deterministic for same (master, domain)', () => {
    const a = pairwise(FIXED_MASTER, 'verifier.example.com');
    const b = pairwise(FIXED_MASTER, 'verifier.example.com');
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('differs across domains', () => {
    const a = pairwise(FIXED_MASTER, 'verifier-a.example');
    const b = pairwise(FIXED_MASTER, 'verifier-b.example');
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('is case-insensitive on domain', () => {
    const a = pairwise(FIXED_MASTER, 'Example.COM');
    const b = pairwise(FIXED_MASTER, 'example.com');
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it('produces a valid P-256 keypair JWK', () => {
    const priv = pairwise(FIXED_MASTER, 'verifier.example.com');
    const jwk = publicKeyToJwk(publicKeyFromPrivate(priv));
    expect(jwk.crv).toBe('P-256');
    expect(jwk.x).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(jwk.y).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// Mock SecureStore for the import-time side effects elsewhere (none here).
// `mock.module` returns a Promise — wrap in `void` so eslint stops nagging
// about unhandled rejection (the mock load is best-effort).
void mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(undefined),
  deleteItemAsync: () => Promise.resolve(undefined),
}));
