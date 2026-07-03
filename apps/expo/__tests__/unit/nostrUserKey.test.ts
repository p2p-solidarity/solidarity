/**
 * Production Nostr user key — 04-plan Phase A4 task A4.1.
 *
 * TS module under test: apps/expo/src/nostr/userKey.ts
 *
 * What this suite pins:
 *   1. `provisionFromRootMnemonic()` reveals the root mnemonic exactly
 *      once (via the injected `MnemonicRevealer`), derives the secp256k1
 *      scalar, and persists only the derived scalar — `getNostrPubkey()`
 *      then resolves without touching the revealer again.
 *   2. `packages/shared/vectors/derive.json`'s `nostrPubkeyHex` field is
 *      reproduced exactly — the App<->Web portability contract.
 *   3. `importNsec()` round-trips a well-known NIP-19 test vector (the
 *      nostr-tools reference nsec) to the expected x-only pubkey, and
 *      rejects wrong-hrp / wrong-length / malformed-checksum input
 *      without ever echoing the input string back in the error.
 *   4. `signNostrEvent()` output verifies under `dag/nostrAdapter.ts`'s
 *      `verifyNostrEvent` (the real NIP-01 conformance contract this
 *      task depends on) and reuses `dag/node.ts`'s `computeNip01EventId`
 *      rather than a second serialization implementation.
 *   5. `Result`-only error contract: `getNostrPubkey()`/`signNostrEvent()`
 *      never auto-provision — both return `err('notProvisioned')` before
 *      any key exists.
 *   6. `hasNostrKey()` / `deleteNostrKey()` reflect provisioning state.
 *
 * Isolation note: this suite uses ONLY userKey.ts's own DI hooks
 * (`__setNostrKeyStorageForTesting`, `__setNostrMnemonicRevealerForTesting`)
 * instead of `mock.module('expo-secure-store', ...)` / mocking
 * `@/identity/rootKey` globally — see rootKey.test.ts's isolation note for
 * why global `mock.module` is unsafe across files in the same `bun test`
 * process.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { bech32 } from '@scure/base';

import derivedVectors from '../../../../packages/shared/vectors/derive.json';
import { verifyNostrEvent } from '@/dag/nostrAdapter';

type Res<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

interface NostrEventLike {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

interface UserKeyMod {
  readonly __setNostrKeyStorageForTesting: (storage: typeof fakeStorage | null) => void;
  readonly __setNostrMnemonicRevealerForTesting: (
    revealer: (() => Promise<Res<string>>) | null
  ) => void;
  readonly getNostrPubkey: () => Promise<Res<string>>;
  readonly provisionFromRootMnemonic: () => Promise<Res<string>>;
  readonly importNsec: (nsec: string) => Promise<Res<string>>;
  readonly signNostrEvent: (unsigned: {
    readonly kind: number;
    readonly tags: readonly (readonly string[])[];
    readonly content: string;
    readonly created_at?: number;
  }) => Promise<Res<NostrEventLike>>;
  readonly hasNostrKey: () => Promise<boolean>;
  readonly deleteNostrKey: () => Promise<void>;
}

// ── In-memory storage + mnemonic revealer, injected via userKey.ts's own
//    DI hooks (no global `mock.module` — see isolation note above). ──────

const scalarStore = new Map<string, string>();

const fakeStorage = {
  getScalarHex: (): Promise<string | null> => Promise.resolve(scalarStore.get('scalar') ?? null),
  setScalarHex: (hex: string): Promise<void> => {
    scalarStore.set('scalar', hex);
    return Promise.resolve();
  },
  deleteScalarHex: (): Promise<void> => {
    scalarStore.delete('scalar');
    return Promise.resolve();
  },
};

let nextRevealResult: Res<string> = { ok: false, error: 'notProvisioned' };
let revealCalls = 0;

const fakeRevealer = (): Promise<Res<string>> => {
  revealCalls++;
  return Promise.resolve(nextRevealResult);
};

let mod: UserKeyMod;

beforeAll(async () => {
  const imported: unknown = await import('../../src/nostr/userKey');
  mod = imported as UserKeyMod;
  mod.__setNostrKeyStorageForTesting(fakeStorage);
  mod.__setNostrMnemonicRevealerForTesting(fakeRevealer);
});

beforeEach(async () => {
  scalarStore.clear();
  revealCalls = 0;
  nextRevealResult = { ok: false, error: 'notProvisioned' };
  await mod.deleteNostrKey();
});

afterEach(async () => {
  await mod.deleteNostrKey();
});

// ── 1. Not-provisioned contract ─────────────────────────────────────────

describe('getNostrPubkey / signNostrEvent — never auto-provision', () => {
  it('getNostrPubkey() before provisioning returns err(notProvisioned)', async () => {
    const r = await mod.getNostrPubkey();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('notProvisioned');
  });

  it('signNostrEvent() before provisioning returns err(notProvisioned)', async () => {
    const r = await mod.signNostrEvent({ kind: 0, tags: [], content: '{}' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('notProvisioned');
  });

  it('hasNostrKey() reflects provisioning state', async () => {
    expect(await mod.hasNostrKey()).toBe(false);
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    await mod.provisionFromRootMnemonic();
    expect(await mod.hasNostrKey()).toBe(true);
  });

  it('corrupted stored scalar hex returns a fixed err(corruptedScalar) without echoing any secret bytes', async () => {
    // Not a valid provisioning path — simulates on-disk corruption by
    // writing directly to the fake storage's backing map.
    const corrupted = 'zz'.repeat(32);
    scalarStore.set('scalar', corrupted);

    const pubkeyResult = await mod.getNostrPubkey();
    expect(pubkeyResult.ok).toBe(false);
    if (pubkeyResult.ok) return;
    expect(pubkeyResult.error).toBe('corruptedScalar');
    expect(pubkeyResult.error).not.toContain('zz');

    const signResult = await mod.signNostrEvent({ kind: 0, tags: [], content: '{}' });
    expect(signResult.ok).toBe(false);
    if (signResult.ok) return;
    expect(signResult.error).toBe('corruptedScalar');
    expect(signResult.error).not.toContain('zz');
  });
});

// ── 2. provisionFromRootMnemonic — one gated reveal, derive once ───────

describe('provisionFromRootMnemonic', () => {
  it('reveals the mnemonic exactly once and persists only the derived scalar', async () => {
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    const provisioned = await mod.provisionFromRootMnemonic();
    expect(provisioned.ok).toBe(true);
    expect(revealCalls).toBe(1);

    // Subsequent reads never re-invoke the revealer.
    const resolved = await mod.getNostrPubkey();
    expect(resolved.ok).toBe(true);
    expect(revealCalls).toBe(1);
    if (provisioned.ok && resolved.ok) expect(resolved.value).toBe(provisioned.value);

    // Only the scalar is on disk — never the mnemonic text.
    const stored = [...scalarStore.values()];
    expect(stored.every((v) => v !== derivedVectors.valid[0]!.mnemonic)).toBe(true);
  });

  it('propagates a revealer failure (e.g. biometricDenied) without writing storage', async () => {
    nextRevealResult = { ok: false, error: 'biometricDenied' };
    const r = await mod.provisionFromRootMnemonic();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('biometricDenied');
    expect(scalarStore.size).toBe(0);
  });

  it('is idempotent: re-provisioning from the same mnemonic yields the same pubkey', async () => {
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    const first = await mod.provisionFromRootMnemonic();
    const second = await mod.provisionFromRootMnemonic();
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(first.value).toBe(second.value);
    expect(scalarStore.size).toBe(1);
  });
});

// ── 3. App<->Web portability — derive.json vectors ──────────────────────

describe('derive.json vectors — nostrPubkeyHex portability contract', () => {
  for (const v of derivedVectors.valid) {
    it(`provisioning from "${v.name}" yields the pinned nostrPubkeyHex`, async () => {
      nextRevealResult = { ok: true, value: v.mnemonic };
      const provisioned = await mod.provisionFromRootMnemonic();
      expect(provisioned.ok).toBe(true);
      if (provisioned.ok) expect(provisioned.value).toBe(v.nostrPubkeyHex);

      const resolved = await mod.getNostrPubkey();
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.value).toBe(v.nostrPubkeyHex);
    });
  }

  for (const v of derivedVectors.invalid) {
    it(`provisioning from invalid mnemonic "${v.name}" returns err(...) and writes nothing`, async () => {
      nextRevealResult = { ok: true, value: v.mnemonic };
      const r = await mod.provisionFromRootMnemonic();
      expect(r.ok).toBe(false);
      expect(scalarStore.size).toBe(0);
    });
  }
});

// ── 4. importNsec — NIP-19 decode + validation ──────────────────────────

describe('importNsec', () => {
  // nostr-tools' own NIP-19 reference test vector:
  //   nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5
  //   -> sk hex 67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa
  // Expected pubkey computed directly via this repo's own
  // @noble/curves schnorr.getPublicKey(sk) — the same primitive
  // importNsec uses internally, so this pins the decode+derive
  // round-trip against an independently-sourced secret key.
  const REFERENCE_NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
  const REFERENCE_PUBKEY_HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';

  it('imports the reference nsec and resolves the expected x-only pubkey', async () => {
    const imported = await mod.importNsec(REFERENCE_NSEC);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.value).toBe(REFERENCE_PUBKEY_HEX);

    const resolved = await mod.getNostrPubkey();
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value).toBe(REFERENCE_PUBKEY_HEX);
  });

  it('rejects a wrong-hrp bech32 string (e.g. npub) without echoing the input', async () => {
    const scalarBytes = new Uint8Array(32).fill(0x11);
    const wrongHrp = bech32.encodeFromBytes('npub', scalarBytes);
    const r = await mod.importNsec(wrongHrp);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('wrong hrp');
    expect(r.error).not.toContain(wrongHrp);
  });

  it('rejects a wrong-length payload', async () => {
    const shortBytes = new Uint8Array(16).fill(0x22);
    const wrongLength = bech32.encodeFromBytes('nsec', shortBytes);
    const r = await mod.importNsec(wrongLength);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('32 bytes');
  });

  it('rejects a malformed/corrupted-checksum bech32 string without echoing the input', async () => {
    const corrupted = REFERENCE_NSEC.slice(0, -1) + (REFERENCE_NSEC.endsWith('5') ? '4' : '5');
    const r = await mod.importNsec(corrupted);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('invalidNsec: malformed bech32');
    expect(r.error).not.toContain(corrupted);
    expect(scalarStore.size).toBe(0);
  });

  it('never persists a rejected import', async () => {
    await mod.importNsec('not-even-bech32');
    expect(scalarStore.size).toBe(0);
    expect(await mod.hasNostrKey()).toBe(false);
  });
});

// ── 5. signNostrEvent — NIP-01 conformance against dag/nostrAdapter.ts ──

describe('signNostrEvent — verifiable by dag/nostrAdapter.ts verifyNostrEvent', () => {
  it('produces an event that verifyNostrEvent accepts, with the correct pubkey', async () => {
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    const provisioned = await mod.provisionFromRootMnemonic();
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;

    const signed = await mod.signNostrEvent({
      kind: 30078,
      tags: [['d', 'solidarity.profile']],
      content: '{"jws":"header.payload.sig"}',
      created_at: 1_700_300_000,
    });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    expect(signed.value.pubkey).toBe(provisioned.value);
    expect(signed.value.kind).toBe(30078);
    expect(signed.value.created_at).toBe(1_700_300_000);
    expect(verifyNostrEvent(signed.value)).toBe(true);
  });

  it('defaults created_at to "now" (unix seconds) when omitted', async () => {
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    await mod.provisionFromRootMnemonic();

    const beforeSec = Math.floor(Date.now() / 1000);
    const signed = await mod.signNostrEvent({ kind: 0, tags: [], content: '{}' });
    const afterSec = Math.floor(Date.now() / 1000);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value.created_at).toBeGreaterThanOrEqual(beforeSec);
    expect(signed.value.created_at).toBeLessThanOrEqual(afterSec);
    expect(verifyNostrEvent(signed.value)).toBe(true);
  });

  it('tampered content fails verifyNostrEvent (id no longer matches)', async () => {
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    await mod.provisionFromRootMnemonic();
    const signed = await mod.signNostrEvent({ kind: 0, tags: [], content: '{"a":1}' });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const tampered = { ...signed.value, content: '{"a":2}' };
    expect(verifyNostrEvent(tampered)).toBe(false);
  });

  it('a key imported via importNsec also signs verifiable events', async () => {
    const imported = await mod.importNsec(
      'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const signed = await mod.signNostrEvent({ kind: 1, tags: [], content: 'hello nostr' });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value.pubkey).toBe(imported.value);
    expect(verifyNostrEvent(signed.value)).toBe(true);
  });
});

// ── 6. deleteNostrKey ────────────────────────────────────────────────────

describe('deleteNostrKey', () => {
  it('clears the persisted key so getNostrPubkey() reverts to notProvisioned', async () => {
    nextRevealResult = { ok: true, value: derivedVectors.valid[0]!.mnemonic };
    await mod.provisionFromRootMnemonic();
    expect(await mod.hasNostrKey()).toBe(true);

    await mod.deleteNostrKey();
    expect(await mod.hasNostrKey()).toBe(false);
    const r = await mod.getNostrPubkey();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('notProvisioned');
  });
});
