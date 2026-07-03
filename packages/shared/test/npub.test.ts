/**
 * npub.ts — pure NIP-19 `npub1…` bech32 codec for `packages/shared`.
 *
 * `apps/expo/src/nostr/userKey.ts` already has an app-side `npubEncode`
 * (task A4.2), but that lives behind `expo-secure-store`/keychain imports
 * and is encode-only. The badge verifier (`badges/nostr.ts`, task A4.3) is
 * a PURE module shared by the app AND the future web viewer, so it needs
 * its own dependency-free `npubToHex`/`hexToNpub` here — this suite pins
 * them against the EXACT SAME reference vector `userKey.ts`'s own
 * `npubEncode` suite uses (`nostrUserKey.test.ts`'s `REFERENCE_PUBKEY_HEX`/
 * `REFERENCE_NPUB`), so the app-side and shared-side encoders can never
 * silently drift apart.
 */
import { describe, expect, it } from 'bun:test';
import { bech32 } from '@scure/base';

import { hexToNpub, npubToHex } from '../src/nostr/npub';

// Same reference vector as apps/expo/__tests__/unit/nostrUserKey.test.ts's
// `npubEncode` suite (nostr-tools NIP-19 reference secret key's derived
// x-only pubkey) — reused verbatim so the two encoders can't drift.
const REFERENCE_PUBKEY_HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
const REFERENCE_NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';

describe('hexToNpub', () => {
  it('encodes the reference pubkey hex to the pinned npub vector', () => {
    const r = hexToNpub(REFERENCE_PUBKEY_HEX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(REFERENCE_NPUB);
  });

  it('rejects a wrong-length hex string without throwing', () => {
    const r = hexToNpub('deadbeef');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('32 bytes');
  });

  it('rejects non-hex input without throwing', () => {
    const r = hexToNpub('not-hex-zz');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('hex');
  });
});

describe('npubToHex', () => {
  it('decodes the reference npub back to the pinned pubkey hex', () => {
    const r = npubToHex(REFERENCE_NPUB);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(REFERENCE_PUBKEY_HEX);
  });

  it('round-trips hexToNpub -> npubToHex', () => {
    const encoded = hexToNpub(REFERENCE_PUBKEY_HEX);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = npubToHex(encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toBe(REFERENCE_PUBKEY_HEX);
  });

  it('rejects malformed bech32 without throwing', () => {
    const r = npubToHex('not-a-bech32-string-at-all');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('bech32');
  });

  it('rejects a bech32 string with the wrong hrp (e.g. nsec)', () => {
    // Genuinely re-encoded with hrp 'nsec' over the same 32-byte payload
    // (not string substitution) so this exercises the hrp check, not a
    // checksum failure.
    const pubkeyBytes = Uint8Array.from(REFERENCE_PUBKEY_HEX.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    const nsecShaped = bech32.encodeFromBytes('nsec', pubkeyBytes);
    const r = npubToHex(nsecShaped);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('hrp');
  });

  it('rejects a wrong-byte-length npub (valid bech32 + correct hrp, 16-byte payload)', () => {
    // Genuinely bech32-encode a 16-byte payload with hrp 'npub' so the
    // string is valid bech32 with the correct hrp, isolating the length
    // check from the hrp/checksum checks above.
    const shortPayload = new Uint8Array(16).fill(0xab);
    const shortNpub = bech32.encodeFromBytes('npub', shortPayload);
    const r = npubToHex(shortNpub);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('32 bytes');
  });
});
