/**
 * npub.ts — pure NIP-19 `npub1…` bech32 codec, shared by apps/expo AND the
 * future web viewer (04-plan Phase A4 task A4.3).
 *
 * `apps/expo/src/nostr/userKey.ts` has its own app-side `npubEncode`
 * (task A4.2) but it lives next to `expo-secure-store`/keychain imports
 * and is encode-only (nothing there needed decode until this task). The
 * badge verifier (`badges/nostr.ts`, this task) is a PURE module the web
 * viewer replays too, so it needs its own dependency-free encode/decode
 * pair here — no keychain, no app-only imports.
 *
 * `packages/shared/test/npub.test.ts` pins both functions against the
 * EXACT SAME reference vector `userKey.ts`'s own `npubEncode` suite uses
 * (`apps/expo/__tests__/unit/nostrUserKey.test.ts`'s `REFERENCE_PUBKEY_HEX`
 * / `REFERENCE_NPUB`) so the two encoders can never silently drift apart.
 */
import { bech32 } from '@scure/base';

import { bytesToHex, hexToBytes } from '../crypto/hex';
import { err, ok, type Result } from '../types/result';

const NPUB_HRP = 'npub';
/** BIP-340 x-only secp256k1 pubkey length. */
const PUBKEY_BYTE_LENGTH = 32;

/**
 * Bech32-encode an x-only pubkey hex (64 lowercase/uppercase hex chars)
 * into its NIP-19 `npub1…` form. Never throws — malformed input (wrong
 * length / non-hex) is `err(...)`.
 */
export function hexToNpub(pubkeyHex: string): Result<string, string> {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(pubkeyHex);
  } catch {
    return err('hexToNpub: pubkeyHex is not valid hex');
  }
  if (bytes.length !== PUBKEY_BYTE_LENGTH) {
    return err('hexToNpub: pubkey must be 32 bytes');
  }
  try {
    return ok(bech32.encodeFromBytes(NPUB_HRP, bytes));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Bech32-decode a NIP-19 `npub1…` string back to its x-only pubkey hex.
 * Never throws — every rejection (malformed bech32, wrong hrp, wrong
 * payload length) is `err(...)`.
 */
export function npubToHex(npub: string): Result<string, string> {
  let decoded: { readonly prefix: string; readonly bytes: Uint8Array };
  try {
    decoded = bech32.decodeToBytes(npub);
  } catch {
    return err('npubToHex: malformed bech32');
  }
  if (decoded.prefix.toLowerCase() !== NPUB_HRP) {
    return err('npubToHex: wrong hrp (expected npub)');
  }
  if (decoded.bytes.length !== PUBKEY_BYTE_LENGTH) {
    return err('npubToHex: payload must be 32 bytes');
  }
  return ok(bytesToHex(decoded.bytes));
}
