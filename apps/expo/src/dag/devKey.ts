/**
 * Sandbox-only secp256k1 dev-key — the ONLY key allowed to sign DAG
 * nodes today.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §7 + §8. Never linked to the
 * production Spruce ed25519 DID; never exported through the public
 * backup flow; UI labels MUST call it "Sandbox key", never "Your key"
 * — see §8 naming convention.
 *
 * Storage: MMKV key `dev:secp256k1:v1` holding 64-char lowercase hex.
 * If MMKV is unavailable (tests / cold start before init), the key is
 * generated in-memory and lost on next launch — sandbox-acceptable
 * because no production data depends on it.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { getMmkv } from '@/storage/mmkv';

import { hexDecode, hexEncode } from './node';

export const DEV_KEY_MMKV = 'dev:secp256k1:v1';

export interface DevKey {
  readonly privkey: Uint8Array;
  readonly pubkeyHex: string;
}

let cached: DevKey | null = null;

/** Load the sandbox dev-key, generating + persisting one on first call. */
export function loadOrCreateDevKey(): DevKey {
  if (cached) return cached;
  const persisted = tryLoad();
  cached = persisted ?? generateAndPersist();
  return cached;
}

/** Wipe the cached key + persisted bytes. Lab "Reset sandbox identity" calls this. */
export function resetDevKey(): void {
  cached = null;
  try {
    getMmkv().remove(DEV_KEY_MMKV);
  } catch {
    // MMKV not ready — the in-memory cache was already cleared above,
    // which is the entire reset for a not-yet-persisted key.
  }
}

/** Convenience — pubkey only (no need to pull privkey into UI scopes). */
export function getDevPubkeyHex(): string {
  return loadOrCreateDevKey().pubkeyHex;
}

function tryLoad(): DevKey | null {
  let stored: string | undefined;
  try {
    stored = getMmkv().getString(DEV_KEY_MMKV);
  } catch {
    return null;
  }
  if (!stored || stored.length !== 64) return null;
  try {
    const privkey = hexDecode(stored);
    if (privkey.length !== 32) return null;
    const pubkey = schnorr.getPublicKey(privkey);
    return { privkey, pubkeyHex: hexEncode(pubkey) };
  } catch {
    return null;
  }
}

function generateAndPersist(): DevKey {
  // schnorr requires a valid scalar in (0, n). randomBytes(32) almost
  // always satisfies this — the rejection-sample loop is here for the
  // ~2⁻¹²⁸ edge case so a cold start never crashes.
  for (let attempt = 0; attempt < 10; attempt++) {
    const privkey = randomBytes(32);
    try {
      const pubkey = schnorr.getPublicKey(privkey);
      const pubkeyHex = hexEncode(pubkey);
      try {
        getMmkv().set(DEV_KEY_MMKV, hexEncode(privkey));
      } catch {
        // MMKV not ready; key works for this session only.
      }
      return { privkey, pubkeyHex };
    } catch {
      // invalid scalar — try again
    }
  }
  throw new Error('Failed to generate a valid schnorr dev-key after 10 attempts');
}
