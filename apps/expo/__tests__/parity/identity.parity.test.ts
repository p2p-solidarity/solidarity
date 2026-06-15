/**
 * Parity test — ES256 JWT + P-256 key derivation
 *
 * Reads a JWT signed by Swift CryptoKit (FixtureExporter) and asserts:
 *   1. TS verifies the Swift signature successfully.
 *   2. TS derives the same public-key point from the same private scalar.
 *   3. The decoded payload matches the source JSON byte-equal.
 *
 * Signatures are randomised in CryptoKit (k is fresh per sign), so we do
 * NOT byte-compare signature output across the boundary — verification is
 * the contract.
 */
import { describe, expect, it } from 'bun:test';

import {
  bytesToHex,
  hexToBytes,
  publicKeyFromPrivate,
  publicKeyToJwk,
  verifyJwtEs256,
} from '@solidarity/shared';

import fixture from '../../../../packages/parity-fixtures/fixtures/identity/es256_jwt.json' assert { type: 'json' };

interface IdentityCase {
  readonly name: string;
  readonly privKeyHex: string;
  readonly publicKeyX963Hex: string;
  readonly headerJson: string;
  readonly payloadJson: string;
  readonly jwt: string;
}

const cases = (fixture as { readonly cases: readonly IdentityCase[] }).cases;

describe('ES256 JWT parity: Swift CryptoKit ↔ @noble/curves', () => {
  for (const c of cases) {
    it(`derives same public point: ${c.name}`, () => {
      const priv = hexToBytes(c.privKeyHex);
      const derived = publicKeyFromPrivate(priv);
      expect(bytesToHex(derived)).toBe(c.publicKeyX963Hex);
    });

    it(`verifies Swift-signed JWT: ${c.name}`, () => {
      const pub = hexToBytes(c.publicKeyX963Hex);
      const jwk = publicKeyToJwk(pub);
      const { payload } = verifyJwtEs256<Record<string, unknown>>(c.jwt, jwk);
      expect(JSON.stringify(payload)).toBe(c.payloadJson);
    });
  }
});
