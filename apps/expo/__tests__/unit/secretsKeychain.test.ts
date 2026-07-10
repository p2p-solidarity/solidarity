/**
 * Vault root secret — hardware-backed wrap / unwrap round trip.
 *
 * Swift reference:
 *   solidarity/Services/Vault/VaultSecretsKeychain.swift
 *     - loads the AES-256 vault key out of Keychain
 *     - the SwiftUI app stores the key as raw bytes; the Expo client
 *       upgrades that to "wrapped by a Secure Enclave / StrongBox key"
 *       via `@solidarity/nitro-secrets-vault`.
 *
 * TS port under test:
 *   apps/expo/src/vault/secretsKeychain.ts
 *
 * What this suite pins (mirrors the Swift integration tests):
 *   1. Hardware-backed path:
 *      a. `getOrCreateRootSecret('biometric')` provisions a fresh root,
 *         calls `ensureWrappingKey` + `wrap` on the Nitro driver, and
 *         persists the JSON envelope (not the raw 32 bytes) into
 *         expo-secure-store.
 *      b. A second call (after `evictCachedRootSecret`) loads the
 *         envelope, calls `unwrap`, and returns the SAME 32 bytes.
 *      c. The bytes on disk are NOT the plaintext — confidentiality
 *         check against a trivial regression where we accidentally
 *         persist the plaintext.
 *   2. Fallback path (`isHardwareAvailable=false`):
 *      a. The root is stored as a v0 raw-base64 string, restored
 *         losslessly, and `console.warn` is emitted (defence in depth).
 *   3. The biometric gate is honoured: a denied prompt returns
 *      `{ kind: 'err', reason: 'biometricDenied' }` and never calls
 *      into the Nitro driver.
 *   4. `resetRootSecretForTesting` deletes the wrapping key.
 *   5. Discriminator check — `getOrCreateRootSecret('biometric')` calls
 *      `wrap` with `requireBiometric=true` so the SE / StrongBox key is
 *      provisioned with the right access control.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { aesGcmOpen, aesGcmSeal, base64Decode, base64Encode } from '@solidarity/shared';

// ── Fake Nitro driver ──────────────────────────────────────────────────────

interface NitroState {
  hardware: boolean;
  ensureCalls: { alias: string; requireBiometric: boolean }[];
  wrapCalls: { alias: string }[];
  unwrapCalls: { alias: string }[];
  deleteCalls: string[];
  /** Optional fault injection. */
  failWrap?: boolean;
  failUnwrap?: boolean;
}

const nitro: NitroState = {
  hardware: true,
  ensureCalls: [],
  wrapCalls: [],
  unwrapCalls: [],
  deleteCalls: [],
};

const driverKeys = new Map<string, Uint8Array>();

function freshXorKey(alias: string): Uint8Array {
  // Deterministic 32-byte wrap key per alias so a wrap/unwrap pair under
  // the same alias is reversible. Real implementation uses
  // ECIES / AES-GCM with a hardware-resident key; the test only cares
  // that wrap(unwrap(x)) === x and that the bytes on disk are NOT x.
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = (alias.charCodeAt(i % alias.length) + i * 7) & 0xff;
  }
  return out;
}

const fakeSecretsVault = {
  isHardwareAvailable: (): boolean => nitro.hardware,
  ensureWrappingKey: (alias: string, requireBiometric: boolean) => {
    nitro.ensureCalls.push({ alias, requireBiometric });
    if (!driverKeys.has(alias)) driverKeys.set(alias, freshXorKey(alias));
    return Promise.resolve({ hardwareBacked: nitro.hardware });
  },
  wrap: (alias: string, plaintext: ArrayBuffer) => {
    nitro.wrapCalls.push({ alias });
    if (nitro.failWrap) return Promise.reject(new Error('mock wrap fail'));
    const key = driverKeys.get(alias) ?? freshXorKey(alias);
    driverKeys.set(alias, key);
    const sealed = aesGcmSeal(key, new Uint8Array(plaintext));
    const buf = new ArrayBuffer(sealed.length);
    new Uint8Array(buf).set(sealed);
    return Promise.resolve({
      algorithm: 'aes-gcm-secure-enclave-ecies',
      keyAlias: alias,
      wrapped: buf,
      hardwareBacked: nitro.hardware,
    });
  },
  unwrap: (wrapped: {
    algorithm: string;
    keyAlias: string;
    wrapped: ArrayBuffer;
    hardwareBacked: boolean;
  }) => {
    nitro.unwrapCalls.push({ alias: wrapped.keyAlias });
    if (nitro.failUnwrap) return Promise.reject(new Error('mock unwrap fail'));
    const key = driverKeys.get(wrapped.keyAlias);
    if (!key) return Promise.reject(new Error('no key'));
    const out = aesGcmOpen(key, new Uint8Array(wrapped.wrapped));
    const buf = new ArrayBuffer(out.length);
    new Uint8Array(buf).set(out);
    return Promise.resolve(buf);
  },
  deleteKey: (alias: string) => {
    nitro.deleteCalls.push(alias);
    driverKeys.delete(alias);
    return Promise.resolve(undefined);
  },
};

// ── In-memory expo-secure-store + biometric mocks ─────────────────────────

const secureStore = new Map<string, string>();
let nextBiometricSuccess = true;

void mock.module('@solidarity/nitro-secrets-vault', () => ({
  getSecretsVault: () => fakeSecretsVault,
}));

void mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: (alias: string): Promise<string | null> =>
    Promise.resolve(secureStore.get(alias) ?? null),
  setItemAsync: (alias: string, value: string): Promise<void> => {
    secureStore.set(alias, value);
    return Promise.resolve();
  },
  deleteItemAsync: (alias: string): Promise<void> => {
    secureStore.delete(alias);
    return Promise.resolve();
  },
}));

void mock.module('@/keychain/biometric', () => ({
  requireBiometric: (): Promise<boolean> => Promise.resolve(nextBiometricSuccess),
  isBiometricAvailable: (): Promise<boolean> => Promise.resolve(true),
}));

void mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: (): Promise<string> => Promise.resolve(''),
  writeAsStringAsync: (): Promise<undefined> => Promise.resolve(undefined),
}));

// React Native's index.js uses Flow syntax that Bun's parser can't load.
// We never touch the real RN API in this suite — the keychain module
// transitively imports it via `@/keychain` → expo bindings.
void mock.module('react-native', () => ({
  ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
    .__AIRMEISHI_RN_MOCK__),
  Platform: { OS: 'ios' },
  TurboModuleRegistry: {
    get: (): null => null,
    getEnforcing: (): { addListener: () => void; removeListeners: () => void } => ({
      addListener: () => undefined,
      removeListeners: () => undefined,
    }),
  },
  NativeModules: {},
  NativeEventEmitter: class {
    addListener(): void { return undefined; }
    removeAllListeners(): void { return undefined; }
  },
}));

// expo-local-authentication is the underlying biometric driver behind
// `requireSensitiveAction`. We control the prompt result via
// `nextBiometricSuccess` above; this mock keeps the module loadable in
// bun even though the @/keychain mock already intercepts the call site.
void mock.module('expo-local-authentication', () => ({
  hasHardwareAsync: (): Promise<boolean> => Promise.resolve(true),
  isEnrolledAsync: (): Promise<boolean> => Promise.resolve(true),
  authenticateAsync: (): Promise<{ success: boolean }> =>
    Promise.resolve({ success: nextBiometricSuccess }),
}));

interface SecretsKeychainMod {
  readonly getOrCreateRootSecret: (
    mode?: 'biometric' | 'silent'
  ) => Promise<
    | { readonly kind: 'ok'; readonly bytes: Uint8Array }
    | { readonly kind: 'err'; readonly reason: 'biometricDenied' | 'storageFailed' }
  >;
  readonly evictCachedRootSecret: () => void;
  readonly resetRootSecretForTesting: () => Promise<void>;
}

const ROOT_ALIAS = 'gg.solidarity.vault.rootSecret.v1';
const WRAP_ALIAS = 'gg.solidarity.vault.rootSecret.wrapping.v1';
const WRAP_ALIAS_V2 = 'gg.solidarity.vault.rootSecret.wrapping.v2';

let mod: SecretsKeychainMod;

beforeAll(async () => {
  const imported: unknown = await import('../../src/vault/secretsKeychain');
  mod = imported as SecretsKeychainMod;
});

beforeEach(async () => {
  secureStore.clear();
  driverKeys.clear();
  nitro.hardware = true;
  nitro.ensureCalls.length = 0;
  nitro.wrapCalls.length = 0;
  nitro.unwrapCalls.length = 0;
  nitro.deleteCalls.length = 0;
  nitro.failWrap = false;
  nitro.failUnwrap = false;
  nextBiometricSuccess = true;
  await mod.resetRootSecretForTesting();
  mod.evictCachedRootSecret();
});

afterEach(() => {
  mod.evictCachedRootSecret();
});

// ── 1. Hardware-backed path: provision + round trip ───────────────────────

describe('hardware-backed root secret (Secure Enclave / StrongBox)', () => {
  it('first call provisions wrapping key, wraps the fresh root, and persists the envelope', async () => {
    const a = await mod.getOrCreateRootSecret('biometric');
    expect(a.kind).toBe('ok');
    if (a.kind !== 'ok') return;
    expect(a.bytes.length).toBe(32);

    // The wrapping key is provisioned ACL-FREE on the v2 alias: the JS
    // 'exchange' gate (biometric.ts) is the canonical prompt — graced like
    // sign/export/present/passportSave, so repeat vault unlocks within the
    // 5-minute window don't re-prompt — the SE key only provides
    // non-extractability. A `.userPresence` ACL here stacked a second (and
    // third, via the envelope item ACL) OS prompt on every vault unlock.
    // (task A5.2 round 1 briefly moved 'exchange' into biometric.ts's
    // ALWAYS_PROMPT to harden the unrelated Pear card-release path, which
    // regressed this grace by accident since both features shared the
    // 'exchange' reason string; round 2 introduced a dedicated
    // 'cardRelease' reason for Pear and restored 'exchange' to the graced
    // family, so this comment's original "canonical prompt" claim holds
    // again.)
    expect(nitro.ensureCalls.length).toBe(1);
    expect(nitro.ensureCalls[0]?.alias).toBe(WRAP_ALIAS_V2);
    expect(nitro.ensureCalls[0]?.requireBiometric).toBe(false);
    expect(nitro.wrapCalls.length).toBe(1);
    expect(nitro.wrapCalls[0]?.alias).toBe(WRAP_ALIAS_V2);

    // The persisted blob is a JSON envelope, NOT the raw 32 bytes.
    const stored = secureStore.get(ROOT_ALIAS);
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored ?? '{}') as Record<string, unknown>;
    expect(parsed['kind']).toBe('v1.hw');
    expect(parsed['algorithm']).toBe('aes-gcm-secure-enclave-ecies');
    expect(parsed['keyAlias']).toBe(WRAP_ALIAS_V2);
    expect(parsed['hardwareBacked']).toBe(true);
    expect(typeof parsed['wrappedB64']).toBe('string');

    // Sanity: the wrapped bytes are NOT the plaintext (basic
    // confidentiality regression check).
    const wrappedBytes = base64Decode(parsed['wrappedB64'] as string);
    expect(Buffer.from(wrappedBytes).toString('hex')).not.toBe(
      Buffer.from(a.bytes).toString('hex')
    );
  });

  it('second call (after evict) loads the envelope, calls unwrap, returns same bytes', async () => {
    const first = await mod.getOrCreateRootSecret('biometric');
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;

    mod.evictCachedRootSecret();
    nitro.wrapCalls.length = 0;
    nitro.unwrapCalls.length = 0;

    const second = await mod.getOrCreateRootSecret('biometric');
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') return;

    expect(nitro.unwrapCalls.length).toBe(1);
    expect(nitro.wrapCalls.length).toBe(0);  // no re-wrap on read
    expect(Buffer.from(second.bytes).toString('hex')).toBe(
      Buffer.from(first.bytes).toString('hex')
    );
  });

  it('silent mode returns the cached secret without re-prompting / re-unwrapping', async () => {
    const first = await mod.getOrCreateRootSecret('biometric');
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    nitro.unwrapCalls.length = 0;
    const cached = await mod.getOrCreateRootSecret('silent');
    expect(cached.kind).toBe('ok');
    if (cached.kind !== 'ok') return;
    expect(nitro.unwrapCalls.length).toBe(0);
    expect(Buffer.from(cached.bytes).toString('hex')).toBe(
      Buffer.from(first.bytes).toString('hex')
    );
  });

  it('biometric denial returns err and does NOT call into the Nitro driver', async () => {
    nextBiometricSuccess = false;
    const r = await mod.getOrCreateRootSecret('biometric');
    expect(r.kind).toBe('err');
    if (r.kind !== 'err') return;
    expect(r.reason).toBe('biometricDenied');
    expect(nitro.wrapCalls.length).toBe(0);
    expect(nitro.ensureCalls.length).toBe(0);
    expect(nitro.unwrapCalls.length).toBe(0);
  });

  it('resetRootSecretForTesting calls deleteKey on both wrapping aliases', async () => {
    await mod.getOrCreateRootSecret('biometric');
    nitro.deleteCalls.length = 0;
    await mod.resetRootSecretForTesting();
    expect(nitro.deleteCalls).toContain(WRAP_ALIAS);
    expect(nitro.deleteCalls).toContain(WRAP_ALIAS_V2);
    expect(secureStore.get(ROOT_ALIAS)).toBeUndefined();
  });
});

// ── ACL-free v2 wrapping-key migration ─────────────────────────────────────

function seedV1Envelope(root: Uint8Array): void {
  // A pre-phase-4 envelope: wrapped under the v1 alias whose SE key was
  // provisioned with `.userPresence` (prompting natively on every unwrap).
  const key = freshXorKey(WRAP_ALIAS);
  driverKeys.set(WRAP_ALIAS, key);
  const sealed = aesGcmSeal(key, root);
  secureStore.set(
    ROOT_ALIAS,
    JSON.stringify({
      kind: 'v1.hw',
      algorithm: 'aes-gcm-secure-enclave-ecies',
      keyAlias: WRAP_ALIAS,
      wrappedB64: base64Encode(sealed),
      hardwareBacked: true,
    })
  );
}

describe('wrapping-key v2 migration (drops the native ACL double prompt)', () => {
  const ROOT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

  it('a biometric read of a v1-alias envelope rewraps under v2 and deletes v1', async () => {
    seedV1Envelope(ROOT);
    nitro.deleteCalls.length = 0; // reset helper deletes both aliases in beforeEach
    const r = await mod.getOrCreateRootSecret('biometric');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(Buffer.from(r.bytes).toString('hex')).toBe(Buffer.from(ROOT).toString('hex'));

    // Re-provisioned ACL-free on v2, old SE key dropped.
    expect(nitro.ensureCalls).toContainEqual({ alias: WRAP_ALIAS_V2, requireBiometric: false });
    expect(nitro.wrapCalls.map((c) => c.alias)).toContain(WRAP_ALIAS_V2);
    expect(nitro.deleteCalls).toContain(WRAP_ALIAS);

    const parsed = JSON.parse(secureStore.get(ROOT_ALIAS) ?? '{}') as Record<string, unknown>;
    expect(parsed['keyAlias']).toBe(WRAP_ALIAS_V2);

    // And the migrated envelope still round-trips to the same root.
    mod.evictCachedRootSecret();
    const again = await mod.getOrCreateRootSecret('biometric');
    expect(again.kind).toBe('ok');
    if (again.kind !== 'ok') return;
    expect(Buffer.from(again.bytes).toString('hex')).toBe(Buffer.from(ROOT).toString('hex'));
  });

  it('silent mode does NOT migrate (no user present for the unwrap prompt)', async () => {
    seedV1Envelope(ROOT);
    nitro.deleteCalls.length = 0; // reset helper deletes both aliases in beforeEach
    const r = await mod.getOrCreateRootSecret('silent');
    expect(r.kind).toBe('ok');
    const parsed = JSON.parse(secureStore.get(ROOT_ALIAS) ?? '{}') as Record<string, unknown>;
    expect(parsed['keyAlias']).toBe(WRAP_ALIAS);
    expect(nitro.deleteCalls).not.toContain(WRAP_ALIAS);
  });

  it('migration failure keeps the v1 envelope intact and still returns the root', async () => {
    seedV1Envelope(ROOT);
    nitro.deleteCalls.length = 0; // reset helper deletes both aliases in beforeEach
    nitro.failWrap = true; // the v2 rewrap will throw
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    };
    let r: Awaited<ReturnType<typeof mod.getOrCreateRootSecret>>;
    try {
      r = await mod.getOrCreateRootSecret('biometric');
    } finally {
      console.warn = originalWarn;
    }
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(Buffer.from(r.bytes).toString('hex')).toBe(Buffer.from(ROOT).toString('hex'));
    // Old envelope untouched — NEVER downgraded to a v0 plaintext root.
    const parsed = JSON.parse(secureStore.get(ROOT_ALIAS) ?? '{}') as Record<string, unknown>;
    expect(parsed['kind']).toBe('v1.hw');
    expect(parsed['keyAlias']).toBe(WRAP_ALIAS);
    expect(nitro.deleteCalls).not.toContain(WRAP_ALIAS);
    expect(warnings.join('\n')).toMatch(/migration/i);
  });
});

// ── 2. Software fallback path (no hardware available) ─────────────────────

describe('software fallback (isHardwareAvailable=false)', () => {
  it('writes a v0 raw envelope and never calls wrap / ensureWrappingKey', async () => {
    nitro.hardware = false;
    await mod.resetRootSecretForTesting();  // reset cached `hardwareAvailability`
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    };
    let r: Awaited<ReturnType<typeof mod.getOrCreateRootSecret>>;
    try {
      r = await mod.getOrCreateRootSecret('biometric');
    } finally {
      console.warn = originalWarn;
    }
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(nitro.wrapCalls.length).toBe(0);
    expect(nitro.ensureCalls.length).toBe(0);
    const stored = secureStore.get(ROOT_ALIAS) ?? '';
    // Legacy v0 layout is raw base64; new code stores the bytes
    // directly (no JSON envelope) when hardware is unavailable.
    const decoded = base64Decode(stored);
    expect(decoded.length).toBe(32);
    expect(Buffer.from(decoded).toString('hex')).toBe(
      Buffer.from(r.bytes).toString('hex')
    );
    // The warning surface fires so we can spot the downgrade in Sentry.
    expect(warnings.some((w) => /hardware-backed wrapping unavailable/i.test(w))).toBe(true);
  });

  it('round trip via SecureStore preserves the same 32 bytes', async () => {
    nitro.hardware = false;
    await mod.resetRootSecretForTesting();
    const first = await mod.getOrCreateRootSecret('biometric');
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    mod.evictCachedRootSecret();
    const second = await mod.getOrCreateRootSecret('biometric');
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') return;
    expect(Buffer.from(second.bytes).toString('hex')).toBe(
      Buffer.from(first.bytes).toString('hex')
    );
  });

  it('opportunistic upgrade: v0 on disk + hardware online → re-seal under v1.hw on next read', async () => {
    // Seed the secure-store with a v0 raw envelope under simulated
    // hardware-online conditions (mirrors a real upgrade scenario where
    // the user installed a hardware-less build and is now on a build
    // with hardware enabled).
    nitro.hardware = true;
    await mod.resetRootSecretForTesting();
    const knownBytes = new Uint8Array(32).fill(0x42);
    secureStore.set(ROOT_ALIAS, base64Encode(knownBytes));

    nitro.wrapCalls.length = 0;
    const re = await mod.getOrCreateRootSecret('biometric');
    expect(re.kind).toBe('ok');
    if (re.kind !== 'ok') return;
    // Same bytes returned (we just re-sealed, not regenerated).
    expect(Buffer.from(re.bytes).toString('hex')).toBe(
      Buffer.from(knownBytes).toString('hex')
    );
    // wrap() was invoked to re-seal under the hardware key.
    expect(nitro.wrapCalls.length).toBeGreaterThanOrEqual(1);
    // The persisted blob is now the v1.hw envelope.
    const stored = secureStore.get(ROOT_ALIAS) ?? '';
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    expect(parsed['kind']).toBe('v1.hw');
  });
});

// ── 3. Wrap failure → fallback to v0 raw ─────────────────────────────────

describe('failure modes', () => {
  it('hardware wrap failure falls back to v0 raw storage and emits a warning', async () => {
    nitro.hardware = true;
    await mod.resetRootSecretForTesting();
    nitro.failWrap = true;
    nitro.wrapCalls.length = 0;
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    };
    try {
      const r = await mod.getOrCreateRootSecret('biometric');
      expect(r.kind).toBe('ok');
      if (r.kind !== 'ok') return;
      // wrap was attempted once; the fallback path stored raw bytes.
      expect(nitro.wrapCalls.length).toBe(1);
      const stored = secureStore.get(ROOT_ALIAS) ?? '';
      // The v0 raw layout is plain base64 (32 bytes after decode).
      expect(base64Decode(stored).length).toBe(32);
      expect(warnings.some((w) => /hardware wrap failed/i.test(w))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('unwrap failure → generate a fresh root rather than locking the user out', async () => {
    nitro.hardware = true;
    await mod.resetRootSecretForTesting();
    // First call provisions a v1.hw envelope.
    const seed = await mod.getOrCreateRootSecret('biometric');
    expect(seed.kind).toBe('ok');
    if (seed.kind !== 'ok') return;

    // Simulate the wrapping key going away under us (e.g. user wiped
    // their biometric enrolment + Android auto-invalidated the key).
    mod.evictCachedRootSecret();
    nitro.failUnwrap = true;
    const r = await mod.getOrCreateRootSecret('biometric');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // A new 32-byte root was generated. Same length, different bytes
    // (probabilistic — collisions on 256 bits are vanishingly small).
    expect(r.bytes.length).toBe(32);
    expect(Buffer.from(r.bytes).toString('hex')).not.toBe(
      Buffer.from(seed.bytes).toString('hex')
    );
  });
});
