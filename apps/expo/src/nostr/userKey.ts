/**
 * userKey.ts — production Nostr identity (secp256k1), 04-plan Phase A4
 * task A4.1. Publishes/signs the profile-record projection onto Nostr
 * relays (A4.2+); completely separate from the sandbox dev-key
 * (`src/dag/devKey.ts`, MMKV `dev:secp256k1:v1`, never linked to any
 * production identity) — different storage, different namespace, never
 * cross-read.
 *
 * ── Two provisioning paths ──────────────────────────────────────────────
 *
 * (a) `provisionFromRootMnemonic()` — derive from the user's root
 *     mnemonic (`src/identity/rootKey.ts`) via `@solidarity/shared`'s
 *     `deriveSecp256k1Scalar(mnemonic, HKDF_INFO_NOSTR)`. Same mnemonic
 *     ⇒ same npub on the Expo app AND the future web viewer — this is
 *     the App<->Web portability contract (`packages/shared/vectors
 *     /derive.json`'s `nostrPubkeyHex` field pins the exact vector).
 * (b) `importNsec(nsec)` — bech32-decode an externally-generated NIP-19
 *     `nsec1…` string into its 32-byte scalar. Validated (hrp === 'nsec',
 *     32-byte payload, in-range for secp256k1) but the raw string is
 *     NEVER logged and never echoed back in an error message — the
 *     bech32 decoder's own errors interpolate the offending input
 *     (`Invalid checksum in ${str}`), so every decode failure is
 *     collapsed to a fixed `'invalidNsec: …'` reason instead of
 *     forwarding the library's message verbatim.
 *
 * ── Custody model — READ BEFORE CHANGING `getNostrPubkey`/`signNostrEvent`
 *
 * The root mnemonic is only retrievable through `revealMnemonicForExport
 * ()` (Face-ID gated — see `identity/rootKey.ts`'s doc). Re-deriving the
 * Nostr scalar from the mnemonic on every sign/publish call would mean
 * re-prompting Face ID every time the app wants to publish a profile
 * pointer or kind-0 event — unacceptable UX for what is a comparatively
 * low-stakes "publish" key (unlike the root did:key signer, Nostr event
 * signing is not gated in CLAUDE.md's Face-ID list). So provisioning
 * gates ONCE: `provisionFromRootMnemonic()` reveals the mnemonic exactly
 * one time, derives the scalar, and persists ONLY the derived scalar
 * (never the mnemonic) into this module's own `expo-secure-store` alias
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no biometry ACL — same rationale as
 * `rootKey.ts`: Face ID gating belongs at the call-site layer, not a
 * Keychain ACL). Every subsequent `getNostrPubkey()` / `signNostrEvent()`
 * call reads the persisted scalar directly — no re-derivation, no repeat
 * Face-ID prompt.
 *
 * `getNostrPubkey()` deliberately does NOT lazily provision on a miss —
 * it returns `err('notProvisioned')` so the UI can show an explicit
 * consent step (04-plan task A4.4's binding wizard) before either
 * provisioning path runs. `provisionFromRootMnemonic()` / `importNsec()`
 * are the only two ways a key gets written, and both are meant to be
 * invoked from a screen the user has already consented on.
 *
 * ── NIP-01 signing — no duplicated serialization ────────────────────────
 *
 * `signNostrEvent` computes the event id via `dag/node.ts`'s
 * `computeNip01EventId` — the SAME implementation `dag/nostrAdapter.ts`'s
 * `verifyNostrEvent`/`buildHeadPointerEvent` use, so an event this module
 * signs is bit-for-bit verifiable by `verifyNostrEvent` (pinned by this
 * task's TDD suite).
 */
import { bech32 } from '@scure/base';
import { schnorr } from '@noble/curves/secp256k1.js';
// Type-only — avoids pulling `expo-secure-store` (and, transitively,
// React Native's Flow-syntax entry point, which bun's test parser can't
// load) in at module-load time. See `loadSecureStore` below, same
// reasoning as `identity/rootKey.ts`.
import type * as SecureStoreNS from 'expo-secure-store';

import { computeNip01EventId, hexDecode, hexEncode, type Nip01UnsignedEvent } from '@/dag/node';
import type { NostrEvent } from '@/dag/nostrAdapter';

import { HKDF_INFO_NOSTR, deriveSecp256k1Scalar, err, ok, type Result } from '@solidarity/shared';

const SCALAR_ALIAS = 'gg.solidarity.nostrkey.scalar.v1';
const NSEC_HRP = 'nsec';
const SCALAR_BYTE_LENGTH = 32;

// ── Storage — own alias, own namespace (never shares state with
//    `identity/rootKey.ts`'s mnemonic alias or `dag/devKey.ts`'s MMKV
//    key) ───────────────────────────────────────────────────────────────

export interface NostrKeyStorage {
  readonly getScalarHex: () => Promise<string | null>;
  readonly setScalarHex: (hex: string) => Promise<void>;
  readonly deleteScalarHex: () => Promise<void>;
}

async function loadSecureStore(): Promise<typeof SecureStoreNS> {
  return import('expo-secure-store');
}

function secureOpts(SecureStore: typeof SecureStoreNS): SecureStoreNS.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
}

const defaultStorage: NostrKeyStorage = {
  getScalarHex: async () => {
    const SecureStore = await loadSecureStore();
    return SecureStore.getItemAsync(SCALAR_ALIAS, secureOpts(SecureStore));
  },
  setScalarHex: async (hex) => {
    const SecureStore = await loadSecureStore();
    await SecureStore.setItemAsync(SCALAR_ALIAS, hex, secureOpts(SecureStore));
  },
  deleteScalarHex: async () => {
    const SecureStore = await loadSecureStore();
    await SecureStore.deleteItemAsync(SCALAR_ALIAS, secureOpts(SecureStore));
  },
};

let activeStorage: NostrKeyStorage = defaultStorage;

/** Test-only override. Pass `null` to restore the real SecureStore-backed implementation. */
export function __setNostrKeyStorageForTesting(storage: NostrKeyStorage | null): void {
  activeStorage = storage ?? defaultStorage;
}

// ── Root-mnemonic reveal seam — lazy-loaded so importing this module
//    never eagerly pulls in `identity/rootKey.ts` (and, transitively,
//    Face-ID / SecureStore natives) at module-load time. Tests inject a
//    fake revealer instead of mocking `identity/rootKey.ts` globally. ───

export type MnemonicRevealer = () => Promise<Result<string, string>>;

async function defaultMnemonicRevealer(): Promise<Result<string, string>> {
  const { revealMnemonicForExport } = await import('@/identity/rootKey');
  const revealed = await revealMnemonicForExport();
  if (!revealed.ok) return err(revealed.error.kind);
  return ok(revealed.value);
}

let activeMnemonicRevealer: MnemonicRevealer = defaultMnemonicRevealer;

/** Test-only override. Pass `null` to restore the real (Face-ID-gated) revealer. */
export function __setNostrMnemonicRevealerForTesting(revealer: MnemonicRevealer | null): void {
  activeMnemonicRevealer = revealer ?? defaultMnemonicRevealer;
}

function storageErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Provisioning ─────────────────────────────────────────────────────────

/**
 * Path (a): derive from the root mnemonic. Triggers exactly ONE Face-ID
 * gate (via `revealMnemonicForExport`), then persists only the derived
 * scalar — never the mnemonic itself. Idempotent: re-running with the
 * same root mnemonic re-derives and overwrites with the identical
 * scalar. Caller (A4.4 wizard) is responsible for consenting the user
 * before invoking this — see module doc.
 */
export async function provisionFromRootMnemonic(): Promise<Result<string, string>> {
  const revealed = await activeMnemonicRevealer();
  if (!revealed.ok) return revealed;

  let scalar: Uint8Array;
  try {
    scalar = deriveSecp256k1Scalar(revealed.value, HKDF_INFO_NOSTR);
  } catch (e) {
    return err(storageErrorMessage(e));
  }

  let pubkeyHex: string;
  try {
    pubkeyHex = hexEncode(schnorr.getPublicKey(scalar));
  } catch (e) {
    return err(storageErrorMessage(e));
  }

  try {
    await activeStorage.setScalarHex(hexEncode(scalar));
  } catch (e) {
    return err(storageErrorMessage(e));
  }
  return ok(pubkeyHex);
}

/**
 * Path (b): import an externally-generated NIP-19 `nsec1…` string.
 * Decodes + validates (hrp, length, in-range scalar) without ever
 * forwarding the bech32 decoder's own error text (which echoes the raw
 * input) back to the caller — see module doc. Never throws; every
 * failure is `err('invalidNsec: …')`.
 */
export async function importNsec(nsec: string): Promise<Result<string, string>> {
  let scalar: Uint8Array;
  try {
    const decoded = bech32.decodeToBytes(nsec);
    if (decoded.prefix.toLowerCase() !== NSEC_HRP) {
      return err('invalidNsec: wrong hrp (expected nsec)');
    }
    if (decoded.bytes.length !== SCALAR_BYTE_LENGTH) {
      return err('invalidNsec: payload must be 32 bytes');
    }
    scalar = decoded.bytes;
  } catch {
    return err('invalidNsec: malformed bech32');
  }

  let pubkeyHex: string;
  try {
    pubkeyHex = hexEncode(schnorr.getPublicKey(scalar));
  } catch {
    return err('invalidNsec: scalar out of range for secp256k1');
  }

  try {
    await activeStorage.setScalarHex(hexEncode(scalar));
  } catch (e) {
    return err(storageErrorMessage(e));
  }
  return ok(pubkeyHex);
}

/** Whether a production Nostr key has been provisioned on this device. */
export async function hasNostrKey(): Promise<boolean> {
  try {
    return (await activeStorage.getScalarHex()) !== null;
  } catch {
    return false;
  }
}

/** Delete the persisted key. Used by tests and a future rotate/reset flow. */
export async function deleteNostrKey(): Promise<void> {
  await activeStorage.deleteScalarHex();
}

// ── Read + sign ──────────────────────────────────────────────────────────

async function loadScalar(): Promise<Result<Uint8Array, string>> {
  let scalarHex: string | null;
  try {
    scalarHex = await activeStorage.getScalarHex();
  } catch (e) {
    return err(storageErrorMessage(e));
  }
  if (!scalarHex) return err('notProvisioned');
  try {
    return ok(hexDecode(scalarHex));
  } catch (e) {
    return err(storageErrorMessage(e));
  }
}

/**
 * Resolve the currently-provisioned Nostr pubkey (x-only, 64-char lowercase
 * hex — NOT npub-encoded). Returns `err('notProvisioned')` rather than
 * lazily provisioning — see module doc for the consent-gate rationale.
 */
export async function getNostrPubkey(): Promise<Result<string, string>> {
  const scalarResult = await loadScalar();
  if (!scalarResult.ok) return scalarResult;
  try {
    return ok(hexEncode(schnorr.getPublicKey(scalarResult.value)));
  } catch (e) {
    return err(storageErrorMessage(e));
  }
}

/** A caller-assembled Nostr event, missing only `pubkey`/`id`/`sig`. */
export interface UnsignedNostrEvent {
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  /** Unix seconds. Defaults to `Math.floor(Date.now() / 1000)`. */
  readonly created_at?: number;
}

/**
 * Sign a Nostr event (BIP-340 schnorr per NIP-01) with the provisioned
 * key. Returns `err('notProvisioned')` if no key exists yet — never
 * auto-provisions (see module doc).
 */
export async function signNostrEvent(unsigned: UnsignedNostrEvent): Promise<Result<NostrEvent, string>> {
  const scalarResult = await loadScalar();
  if (!scalarResult.ok) return scalarResult;
  const scalar = scalarResult.value;

  let pubkey: string;
  try {
    pubkey = hexEncode(schnorr.getPublicKey(scalar));
  } catch (e) {
    return err(storageErrorMessage(e));
  }

  const created_at = unsigned.created_at ?? Math.floor(Date.now() / 1000);
  const event: Nip01UnsignedEvent = {
    pubkey,
    created_at,
    kind: unsigned.kind,
    tags: unsigned.tags,
    content: unsigned.content,
  };
  const id = computeNip01EventId(event);

  let sig: string;
  try {
    sig = hexEncode(schnorr.sign(hexDecode(id), scalar));
  } catch (e) {
    return err(storageErrorMessage(e));
  }

  return ok({ ...event, id, sig });
}
