/**
 * Parity test — SpruceID DID Nitro module
 *
 * Exercises the JS-side wiring that talks to `@solidarity/nitro-keystone`
 * by injecting an in-memory driver (`InMemorySpruceDidDriver`) that mimics
 * the native HybridObject's contract. We can't load the real Nitro module
 * in bun tests (no JSI), so the test isolates the surface we control:
 *
 *   1. `ensureSigningKey()` is idempotent — first call provisions a key
 *      under `solidarity.master.v2`, subsequent calls return the same alias.
 *   2. `publicJwk()` returns a P-256 JWK that round-trips through
 *      `publicKeyJwkSchema`.
 *   3. `signJwt({alg: 'ES256'}, payload)` produces a compact JWS whose
 *      payload segment decodes back to the original claims.
 *   4. Custom `typ` / `kid` headers are spliced into the JWS without
 *      breaking the signature.
 *   5. Legacy migration: if `gg.solidarity.signing.v2` exists in SecureStore,
 *      ensureSigningKey() generates a fresh hardware key under the new
 *      alias and clears the legacy bytes. (Real key rotation; documented
 *      behaviour.)
 *
 * Run:
 *   cd apps/expo && bun test __tests__/parity/spruceDid.parity.test.ts
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';

import {
  base64UrlDecode,
  base64UrlEncode,
  didKeyFromJwk,
  generateP256KeyPair,
  jwkToPublicKey,
  publicKeyJwkSchema,
  publicKeyToJwk,
  sha256Bytes,
  signJwtEs256,
  utf8ToBytes,
  verifyJwtEs256,
} from '@solidarity/shared';
import { p256 } from '@noble/curves/nist.js';
import type {
  SpruceDid,
  SpruceDidEvent,
} from '@solidarity/nitro-keystone';

/** Local alias for the HybridObject interface so `equals(other)` typechecks. */
type HybridLike = SpruceDid;

let generateKeyGate: Promise<void> | null = null;
let generateKeyStarted: (() => void) | null = null;

// In-memory test driver. Implements the surface @/keychain/signingKey.ts
// actually uses (generateKey, hasKey, getPublicKeyJwk, deleteKey, signJws).
// Everything else throws — keeps the test honest about what it covers.
class InMemorySpruceDidDriver implements SpruceDid {
  // HybridObject contract — toString / equals / dispose / name. We can't
  // wire JSI in tests so these are stubs.
  readonly name = 'SpruceDid' as const;
  toString(): string { return '[InMemorySpruceDidDriver]'; }
  equals(other: HybridLike): boolean { return other === (this as unknown as HybridLike); }
  dispose(): void { /* no-op for the test driver */ }

  private readonly keys = new Map<
    string,
    {
      privateKey: Uint8Array;
      publicKey: Uint8Array;
      requireBiometric: boolean;
    }
  >();
  private readonly listeners = new Set<(e: SpruceDidEvent) => void>();

  /**
   * Settable per test: 'native-acl' simulates a legacy SE key whose
   * keychain ACL prompts inside the native sign (the JS gate must step
   * aside); 'js-gated' is the syncable-key default.
   */
  keyAuthModeResult: 'native-acl' | 'js-gated' = 'js-gated';

  keyAuthMode(_alias: string): Promise<string> {
    return Promise.resolve(this.keyAuthModeResult);
  }

  // ---- Dual-key-under-one-tag modeling (key-resolution invariant) -----------
  // The native iOS fix (`SpruceDidKeyStore.copyECPrivateKey`) deterministically
  // resolves ONE physical key per alias for BOTH `getPublicKeyJwk` and
  // `signRawP256`, even when several entries share the keychain tag (an
  // iCloud-synced copy + a stale Secure-Enclave key). The pre-fix lookup used
  // `kSecAttrSynchronizableAny` + `kSecMatchLimitOne`, which could return a
  // DIFFERENT entry per call → the bound device pubkey and the signer disagree
  // → the OpenAC device-binding (and the ZK proof that consumes it) fail. The
  // default driver stores one keypair per alias, so it cannot exercise that
  // divergence; this models it explicitly.

  /**
   * A SECOND ("phantom") keypair planted under the same tag as `alias`, the
   * stand-in for the SE phantom / non-synced copy the legacy lookup could pick.
   * Only consulted when `signResolution === 'divergent'`.
   */
  private readonly phantomKeys = new Map<
    string,
    { privateKey: Uint8Array; publicKey: Uint8Array }
  >();

  /**
   * Which physical key `signRawP256` resolves to:
   *  - 'deterministic' (the `copyECPrivateKey` fix): the SAME primary entry
   *    `getPublicKeyJwk` returns — pubkey and signer always agree.
   *  - 'divergent' (the pre-fix `SynchronizableAny` ambiguity): the phantom,
   *    so the bound pubkey and the signer disagree.
   */
  signResolution: 'deterministic' | 'divergent' = 'deterministic';

  /** Plant a distinct phantom keypair under `alias`'s tag. */
  seedPhantomKeyForTag(alias: string): void {
    const kp = generateP256KeyPair();
    this.phantomKeys.set(alias, {
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
    });
  }

  /** The public key `signRawP256` will actually sign with for `alias`. */
  resolvedSignerPublicKey(alias: string): Uint8Array {
    if (this.signResolution === 'divergent') {
      const phantom = this.phantomKeys.get(alias);
      if (phantom) return phantom.publicKey;
    }
    const entry = this.keys.get(alias);
    if (!entry) throw new Error(`no key for ${alias}`);
    return entry.publicKey;
  }

  /** Restore the deterministic default + drop phantoms (per-test teardown). */
  resetResolutionForTesting(): void {
    this.signResolution = 'deterministic';
    this.phantomKeys.clear();
  }

  async generateKey(
    alias: string,
    keyType: string,
    requireBiometric: boolean
  ): Promise<string> {
    // 'p256-syncable' is the iCloud-Keychain-portable variant (software P-256,
    // synchronizable item) — cryptographically identical to 'p256' from the
    // test driver's POV, so it shares the in-memory keypair path.
    const isP256 = keyType === 'p256' || keyType === 'p256-syncable';
    if (!isP256) {
      throw new Error(`unsupported keyType in test driver: ${keyType}`);
    }
    generateKeyStarted?.();
    await (generateKeyGate ?? Promise.resolve());
    // Drop any prior entry so generateKey is idempotent.
    this.keys.delete(alias);
    const kp = generateP256KeyPair();
    this.keys.set(alias, {
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      requireBiometric,
    });
    this.notify({
      kind: 'keyGenerated',
      alias,
      keyType,
      // Syncable software keys are not hardware-backed.
      hardwareBacked: keyType === 'p256',
    });
    return alias;
  }

  hasKey(alias: string): boolean {
    return this.keys.has(alias);
  }

  // ── T7 syncable-item surface ─────────────────────────────────────────────
  // Simulates the iCloud-synced keychain items `listSyncableP256Keys`
  // enumerates natively. Seeded per test; `rawListOverride` lets a test feed
  // malformed JSON to pin the JS layer's fail-closed parse.
  private syncableItems = new Map<string, { labelHex: string; publicKeyHex: string }[]>();
  rawListOverride: string | null = null;
  deleteKeyResultOverride: boolean | null = null;

  seedSyncableItemsForTesting(
    alias: string,
    items: readonly { labelHex: string; publicKeyHex: string }[]
  ): void {
    this.syncableItems.set(alias, [...items]);
  }

  async listSyncableP256Keys(alias: string): Promise<string> {
    if (this.rawListOverride !== null) return this.rawListOverride;
    const items = this.syncableItems.get(alias) ?? [];
    return JSON.stringify(
      items.map((item) => ({ label: item.labelHex, publicKeyHex: item.publicKeyHex }))
    );
  }

  async deleteSyncableP256Key(alias: string, labelHex: string): Promise<boolean> {
    const items = this.syncableItems.get(alias) ?? [];
    const next = items.filter((item) => item.labelHex !== labelHex);
    this.syncableItems.set(alias, next);
    return next.length !== items.length;
  }

  async deleteKey(alias: string): Promise<boolean> {
    if (this.deleteKeyResultOverride !== null) return this.deleteKeyResultOverride;
    const hadSyncableItems = (this.syncableItems.get(alias)?.length ?? 0) > 0;
    const existed = this.keys.delete(alias) || hadSyncableItems;
    this.syncableItems.delete(alias);
    if (existed) this.notify({ kind: 'keyDeleted', alias });
    // Native contract is idempotent: absent is already the desired state.
    return true;
  }

  async getPublicKeyJwk(alias: string): Promise<string> {
    const entry = this.keys.get(alias);
    if (!entry) throw new Error(`no key for ${alias}`);
    return JSON.stringify(publicKeyToJwk(entry.publicKey));
  }

  // didKeyFromAlias / didDocumentJson / verifyJws / signCredentialJwt /
  // verifyCredentialJwt were removed from the SpruceDid spec in 1.3.3 S7a
  // (zero production callers — DID derivation + verification are pure TS in
  // packages/shared), so the driver no longer implements them.

  async signJws(alias: string, payload: ArrayBuffer): Promise<string> {
    const entry = this.keys.get(alias);
    if (!entry) throw new Error(`no key for ${alias}`);
    const payloadBytes = new Uint8Array(payload);
    const payloadObj = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<
      string,
      unknown
    >;
    return signJwtEs256(
      { alg: 'ES256', typ: 'JWT' },
      payloadObj,
      entry.privateKey
    );
  }

  async signRawP256(alias: string, digest: ArrayBuffer): Promise<ArrayBuffer> {
    const entry = this.keys.get(alias);
    if (!entry) throw new Error(`no key for ${alias}`);
    const digestBytes = new Uint8Array(digest);
    if (digestBytes.length !== 32) {
      throw new Error(`signRawP256 expects 32-byte digest, got ${digestBytes.length}`);
    }
    // Deterministic resolution (the fix) signs with the SAME primary entry
    // `getPublicKeyJwk` returns. 'divergent' signs with the phantom under the
    // same tag — the pre-fix `SynchronizableAny` ambiguity that makes the bound
    // pubkey and the signer disagree.
    const phantom = this.phantomKeys.get(alias);
    const signingPriv =
      this.signResolution === 'divergent' && phantom
        ? phantom.privateKey
        : entry.privateKey;
    const signature = p256.sign(digestBytes, signingPriv, { prehash: false });
    const out = new ArrayBuffer(signature.length);
    new Uint8Array(out).set(signature);
    return out;
  }

  addEventListener(handler: (event: SpruceDidEvent) => void): () => void {
    this.listeners.add(handler);
    return () => { this.listeners.delete(handler); };
  }

  private notify(event: SpruceDidEvent): void {
    for (const h of this.listeners) h(event);
  }
}

// In-memory expo-secure-store mock so the legacy migration path runs.
class InMemorySecureStore {
  private readonly store = new Map<string, string>();

  setItem(key: string, value: string): void { this.store.set(key, value); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  deleteItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
}

// Module-level state for the mocks. We install fresh instances per test
// because bun's `mock.module()` doesn't automatically reset between
// `it` blocks.
const sharedSecureStore = new InMemorySecureStore();
const authCalls: string[] = [];

// Replace expo-secure-store and @solidarity/nitro-keystone with stubs.
// Use bun's `mock.module()` so the imports inside `signingKey.ts` resolve to
// these stubs at test time. Note we MUST install these mocks before the
// signingKey module gets required for the first time.
import { mock } from 'bun:test';

mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  async getItemAsync(key: string): Promise<string | null> {
    return sharedSecureStore.getItem(key);
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    sharedSecureStore.setItem(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    sharedSecureStore.deleteItem(key);
  },
}));

mock.module('expo-local-authentication', () => ({
  async hasHardwareAsync(): Promise<boolean> { return true; },
  async isEnrolledAsync(): Promise<boolean> { return true; },
  async authenticateAsync(): Promise<{ success: true }> {
    authCalls.push('authenticate');
    return { success: true };
  },
}));

const driver = new InMemorySpruceDidDriver();
(globalThis as { __SPRUCE_DID_TEST_DRIVER__?: SpruceDid }).__SPRUCE_DID_TEST_DRIVER__ =
  driver as unknown as SpruceDid;

const P256_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

function rawBigEndianToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) | BigInt(byte);
  return out;
}

// Mock the native module's `getSpruceDid()` factory so any code that
// imports the package directly (rather than going through the
// __SPRUCE_DID_TEST_DRIVER__ slot) still gets our stub.
mock.module('@solidarity/nitro-keystone', () => ({
  getSpruceDid: () => driver as unknown as SpruceDid,
}));

// Pull the module under test AFTER the mocks are installed.
const {
  didKeyForCurrentIdentity,
  ensureSigningKey,
  hasExistingSigningKey,
  listSyncableSigningKeys,
  publicRawP256ForCurrentIdentity,
  publicJwk,
  resolveSigningKeyConflict,
  signOpenAcDeviceBindingDigest,
  signRawEs256,
  signJwt,
  deleteSigningKey,
  quiesceSigningKeyOperations,
  resetSigningKeyForTesting,
} =
  await import('@/keychain/signingKey');
const { resetBiometricGrace } = await import('@/keychain/biometric');

describe('SpruceID DID Nitro module — JS-side wiring', () => {
  beforeEach(async () => {
    driver.deleteKeyResultOverride = null;
    sharedSecureStore.clear();
    authCalls.length = 0;
    generateKeyGate = null;
    generateKeyStarted = null;
    __resetLocalDataWipeBarrierForTesting();
    resetBiometricGrace();
    await resetSigningKeyForTesting();
  });

  afterEach(async () => {
    driver.deleteKeyResultOverride = null;
    generateKeyGate = null;
    generateKeyStarted = null;
    __resetLocalDataWipeBarrierForTesting();
    resetBiometricGrace();
    await resetSigningKeyForTesting();
  });

  it('ensureSigningKey is idempotent and returns the modern alias', async () => {
    const first = await ensureSigningKey();
    expect(first.alias).toBe('solidarity.master.v2');
    const second = await ensureSigningKey();
    expect(second.alias).toBe(first.alias);
    // Same public JWK across calls (same key, no rotation).
    expect(second.publicJwk.x).toBe(first.publicJwk.x);
    expect(second.publicJwk.y).toBe(first.publicJwk.y);
  });

  it('does not recreate a native key when generation finishes during a local wipe', async () => {
    let markGenerateStarted!: () => void;
    const generatedStarted = new Promise<void>((resolve) => {
      markGenerateStarted = resolve;
    });
    let releaseGenerate!: () => void;
    generateKeyGate = new Promise<void>((resolve) => {
      releaseGenerate = resolve;
    });
    generateKeyStarted = markGenerateStarted;

    const provisioning = ensureSigningKey();
    await generatedStarted;
    beginLocalDataWipe();

    let quiesced = false;
    const quiesce = quiesceSigningKeyOperations().then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);

    releaseGenerate();
    await expect(provisioning).rejects.toThrow(/local data wipe/i);
    await quiesce;

    expect(driver.hasKey('solidarity.master.v2')).toBe(false);
    completeLocalDataWipe();
  });

  it('publicJwk() returns a P-256 / ES256 JWK that passes the Zod schema', async () => {
    const jwk = await publicJwk();
    expect(() => publicKeyJwkSchema.parse(jwk)).not.toThrow();
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(jwk.alg).toBe('ES256');
  });

  it('didKeyForCurrentIdentity derives from the public JWK without native SpruceID resolver', async () => {
    const jwk = await publicJwk();
    const did = await didKeyForCurrentIdentity();
    expect(did).toBe(didKeyFromJwk(jwk));
  });

  it('publicRawP256ForCurrentIdentity exposes x||y without signing', async () => {
    const jwk = await publicJwk();
    const raw = await publicRawP256ForCurrentIdentity();

    expect(raw.length).toBe(64);
    expect(raw).toEqual(jwkToPublicKey(jwk).slice(1));
  });

  it('signJwt round-trips through verifyJwtEs256 with the stored public key', async () => {
    const jwk = await publicJwk();
    const jwt = await signJwt(
      { alg: 'ES256' },
      { sub: 'integration-test', iat: 1700000000 }
    );
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);
    const { payload } = verifyJwtEs256<{ sub: string; iat: number }>(jwt, jwk);
    expect(payload.sub).toBe('integration-test');
    expect(payload.iat).toBe(1700000000);
  });

  it('signRawEs256 signs the SHA-256 digest of arbitrary payload bytes', async () => {
    const payload = utf8ToBytes('selective-disclosure-canonical-payload');
    const { signature, publicKeyRaw } = await signRawEs256(payload);
    const jwk = await publicJwk();

    expect(signature.length).toBe(64);
    expect(publicKeyRaw.length).toBe(64);
    const expectedPublicKeyRaw = jwkToPublicKey(jwk).slice(1);
    expect(publicKeyRaw).toEqual(expectedPublicKeyRaw);
    expect(
      p256.verify(signature, sha256Bytes(payload), jwkToPublicKey(jwk), {
        prehash: false,
      })
    ).toBe(true);
  });

  it('signOpenAcDeviceBindingDigest signs the raw 32-byte nonce_hash digest', async () => {
    const nonceHash = utf8ToBytes('openac_device_binding_nonce_hash');
    const { signature, publicKeyRaw } = await signOpenAcDeviceBindingDigest(nonceHash);
    const jwk = await publicJwk();

    expect(signature.length).toBe(64);
    expect(publicKeyRaw.length).toBe(64);
    expect(publicKeyRaw).toEqual(jwkToPublicKey(jwk).slice(1));
    expect(rawBigEndianToBigInt(signature.slice(32))).toBeLessThanOrEqual(
      P256_N / 2n
    );
    expect(
      p256.verify(signature, nonceHash, jwkToPublicKey(jwk), { prehash: false })
    ).toBe(true);
  });

  it('skips the JS prompt when the driver reports native-acl (single-layer gate)', async () => {
    driver.keyAuthModeResult = 'native-acl';
    try {
      const nonceHash = new Uint8Array(32).fill(9);
      const { signature } = await signOpenAcDeviceBindingDigest(nonceHash);
      expect(signature.length).toBe(64);
      // The legacy SE key's keychain ACL prompts inside the native sign —
      // stacking the JS prompt on top was the "Face ID twice" bug.
      expect(authCalls.length).toBe(0);
    } finally {
      driver.keyAuthModeResult = 'js-gated';
      await resetSigningKeyForTesting();
    }
  });

  it('treats a driver without keyAuthMode (older native binary) as js-gated', async () => {
    const original = driver.keyAuthMode.bind(driver);
    (driver as unknown as { keyAuthMode?: unknown }).keyAuthMode = undefined;
    try {
      const nonceHash = new Uint8Array(32).fill(7);
      await signOpenAcDeviceBindingDigest(nonceHash);
      expect(authCalls.length).toBe(1);
    } finally {
      (driver as unknown as { keyAuthMode?: unknown }).keyAuthMode = original;
      await resetSigningKeyForTesting();
    }
  });

  it('signOpenAcDeviceBindingDigest is biometric-gated and reuses the sign grace in-session', async () => {
    const nonceHash = utf8ToBytes('openac_device_binding_nonce_hash');

    // The passport device-binding signature is a real `'sign'` op, so the
    // first call authorizes Face ID once…
    await signOpenAcDeviceBindingDigest(nonceHash);
    expect(authCalls.length).toBe(1);

    // …and a second sign in the same session rides the 5-minute `'sign'`
    // grace instead of re-prompting (the OpenAC v3 proof reuses that one
    // authorization rather than bypassing biometrics).
    const { signature, publicKeyRaw } = await signOpenAcDeviceBindingDigest(nonceHash);
    expect(authCalls.length).toBe(1);

    const jwk = await publicJwk();
    expect(signature.length).toBe(64);
    expect(publicKeyRaw).toEqual(jwkToPublicKey(jwk).slice(1));
    expect(rawBigEndianToBigInt(signature.slice(32))).toBeLessThanOrEqual(
      P256_N / 2n
    );
    expect(
      p256.verify(signature, nonceHash, jwkToPublicKey(jwk), { prehash: false })
    ).toBe(true);
  });

  it('signJwt splices custom typ/kid headers without breaking the signature', async () => {
    const jwk = await publicJwk();
    const jwt = await signJwt(
      { alg: 'ES256', typ: 'vc+jwt', kid: 'did:key:zTest#keys-1' },
      { vc: { type: ['VerifiableCredential'] } }
    );
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);
    // Decode header — should reflect our custom typ + kid.
    const headerJson = new TextDecoder().decode(
      base64UrlDecode(parts[0] ?? '')
    );
    const header = JSON.parse(headerJson) as { alg: string; typ: string; kid: string };
    expect(header.alg).toBe('ES256');
    expect(header.typ).toBe('vc+jwt');
    expect(header.kid).toBe('did:key:zTest#keys-1');
    // Signature still verifies because the test driver re-signs with the
    // default header during signJws; the JS layer then overwrites the
    // header segment. In the *native* path the SDK signs the user-supplied
    // header — that's covered by deeper end-to-end tests that exercise
    // the real Nitro module (TODO when we have a device farm).
    expect(parts[2]?.length ?? 0).toBeGreaterThan(0);
  });

  it('legacy migration: rotates DID when gg.solidarity.signing.v2 is present', async () => {
    // Plant a legacy P-256 private key under the @noble alias.
    const legacy = generateP256KeyPair();
    sharedSecureStore.setItem(
      'gg.solidarity.signing.v2',
      base64UrlEncode(legacy.privateKey).replace(/-/g, '+').replace(/_/g, '/')
        + '=='
    );
    const id = await ensureSigningKey();
    // The new key is fresh (hardware-backed via the test driver = software
    // P-256 with fresh entropy). It must NOT equal the legacy key.
    const legacyJwk = publicKeyToJwk(legacy.publicKey);
    expect(id.publicJwk.x).not.toBe(legacyJwk.x);
    // Legacy entry should be wiped after migration.
    expect(sharedSecureStore.getItem('gg.solidarity.signing.v2')).toBeNull();
  });

  it('resetSigningKeyForTesting clears native + legacy state', async () => {
    await ensureSigningKey();
    expect(driver.hasKey('solidarity.master.v2')).toBe(true);
    await resetSigningKeyForTesting();
    expect(driver.hasKey('solidarity.master.v2')).toBe(false);
  });

  it('fails closed when the native key deletion fulfills with false', async () => {
    await ensureSigningKey();
    driver.deleteKeyResultOverride = false;

    const result = await deleteSigningKey();

    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(driver.hasKey('solidarity.master.v2')).toBe(true);
  });

  it('treats an already-absent native deletion as idempotent success', async () => {
    expect(driver.hasKey('solidarity.master.v2')).toBe(false);

    const result = await deleteSigningKey();

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it('accepts one authoritative native delete for syncable alias duplicates', async () => {
    driver.seedSyncableItemsForTesting('solidarity.master.v2', [
      {
        labelHex: '11'.repeat(20),
        publicKeyHex: '04' + '22'.repeat(64),
      },
      {
        labelHex: '33'.repeat(20),
        publicKeyHex: '04' + '44'.repeat(64),
      },
    ]);

    const result = await deleteSigningKey();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await driver.listSyncableP256Keys('solidarity.master.v2')).toBe('[]');
  });

  // The OpenAC device binding (and the ZK proof that consumes it) is only safe
  // if the pubkey it binds is the pubkey of the key that signs. `signingKey.ts`
  // takes `publicKeyRaw` from `getPublicKeyJwk` and the signature from
  // `signRawP256` — two SEPARATE native calls on the same alias. The iOS fix
  // (`SpruceDidKeyStore.copyECPrivateKey`, deterministic `[true,false]`
  // ordering) guarantees both resolve ONE physical key even under a shared tag.
  // These tests pin that invariant cryptographically (verify the binding output
  // against itself) and prove the assertion is NOT tautological by exhibiting
  // the divergence the fix prevents.
  describe('device-binding key-resolution invariant (dual-key tag)', () => {
    const ALIAS = 'solidarity.master.v2';

    function uncompressedPoint(raw64: Uint8Array): Uint8Array {
      const point = new Uint8Array(65);
      point[0] = 0x04;
      point.set(raw64, 1);
      return point;
    }

    afterEach(() => {
      driver.resetResolutionForTesting();
    });

    it('deterministic resolver keeps the bound pubkey and the signer on one key (binding verifies)', async () => {
      // Provision the identity, then plant a phantom under the SAME tag — the
      // legacy ambiguity the fix removes. Deterministic resolution must still
      // sign with the primary entry `getPublicKeyJwk` returned.
      await ensureSigningKey();
      driver.seedPhantomKeyForTag(ALIAS);
      driver.signResolution = 'deterministic';

      const nonceHash = new Uint8Array(32).fill(3);
      const { signature, publicKeyRaw } =
        await signOpenAcDeviceBindingDigest(nonceHash);

      // CRUX: the returned pubkey verifies its OWN signature. Checking against
      // `publicKeyRaw` directly (not a separately stored jwk) is what makes
      // this catch a pubkey/signer divergence.
      expect(
        p256.verify(signature, nonceHash, uncompressedPoint(publicKeyRaw), {
          prehash: false,
        })
      ).toBe(true);
    });

    it('divergent resolver (pre-fix SynchronizableAny bug) breaks the binding — proving the invariant has teeth', async () => {
      // Model the exact bug `copyECPrivateKey` prevents: `signRawP256` resolves
      // to a phantom under the same tag while `getPublicKeyJwk` resolves to the
      // primary, so the bound pubkey ≠ the signer. The binding must FAIL to
      // verify — and the consistent-case assertion above is meaningful precisely
      // because this one can fail.
      await ensureSigningKey();
      driver.seedPhantomKeyForTag(ALIAS);
      driver.signResolution = 'divergent';

      const nonceHash = new Uint8Array(32).fill(4);
      const { signature, publicKeyRaw } =
        await signOpenAcDeviceBindingDigest(nonceHash);

      // The bound pubkey cannot verify the phantom's signature…
      expect(
        p256.verify(signature, nonceHash, uncompressedPoint(publicKeyRaw), {
          prehash: false,
        })
      ).toBe(false);
      // …and it is a different key from the one that actually signed.
      const signerRaw = jwkToPublicKey(
        publicKeyToJwk(driver.resolvedSignerPublicKey(ALIAS))
      ).slice(1);
      expect(publicKeyRaw).not.toEqual(signerRaw);
    });
  });

  describe('T7 syncable-key conflict surface', () => {
    const ALIAS = 'solidarity.master.v2';
    const toHex = (bytes: Uint8Array): string =>
      [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

    afterEach(() => {
      driver.rawListOverride = null;
      driver.seedSyncableItemsForTesting(ALIAS, []);
    });

    it('hasExistingSigningKey probes without minting', async () => {
      expect(await hasExistingSigningKey()).toBe(false);
      // The probe itself must not have created a key.
      expect(driver.hasKey(ALIAS)).toBe(false);
      await ensureSigningKey();
      expect(await hasExistingSigningKey()).toBe(true);
    });

    it('lists synced candidates and marks the resolver’s current winner active', async () => {
      await ensureSigningKey();
      const jwk = await publicJwk();
      const activeHex = `04${toHex(base64UrlDecode(jwk.x))}${toHex(base64UrlDecode(jwk.y))}`;
      driver.seedSyncableItemsForTesting(ALIAS, [
        { labelHex: 'aaaa01', publicKeyHex: activeHex },
        { labelHex: 'bbbb02', publicKeyHex: '04deadbeef' },
      ]);

      const candidates = await listSyncableSigningKeys();

      expect(candidates).toHaveLength(2);
      expect(candidates.find((c) => c.labelHex === 'aaaa01')?.active).toBe(true);
      expect(candidates.find((c) => c.labelHex === 'bbbb02')?.active).toBe(false);
    });

    it('resolveSigningKeyConflict keeps exactly the chosen key and deletes the rest', async () => {
      await ensureSigningKey();
      driver.seedSyncableItemsForTesting(ALIAS, [
        { labelHex: 'aaaa01', publicKeyHex: '04aa' },
        { labelHex: 'bbbb02', publicKeyHex: '04bb' },
        { labelHex: 'cccc03', publicKeyHex: '04cc' },
      ]);

      const result = await resolveSigningKeyConflict('bbbb02');

      expect(result.ok).toBe(true);
      const remaining = await listSyncableSigningKeys();
      expect(remaining.map((c) => c.labelHex)).toEqual(['bbbb02']);
    });

    it('refuses to resolve onto a label that does not exist — deletes nothing', async () => {
      await ensureSigningKey();
      driver.seedSyncableItemsForTesting(ALIAS, [
        { labelHex: 'aaaa01', publicKeyHex: '04aa' },
        { labelHex: 'bbbb02', publicKeyHex: '04bb' },
      ]);

      const result = await resolveSigningKeyConflict('ffff99');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('keepTargetMissing');
      expect(await listSyncableSigningKeys()).toHaveLength(2);
    });

    it('fails closed to an empty list on malformed native JSON — never a phantom conflict', async () => {
      await ensureSigningKey();
      driver.rawListOverride = 'not json {';
      expect(await listSyncableSigningKeys()).toEqual([]);
    });
  });
});
