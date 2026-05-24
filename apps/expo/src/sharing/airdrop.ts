/**
 * airdrop — thin async wrapper around `@solidarity/nitro-airdrop`.
 *
 * iOS uses `UIActivityViewController` filtered so AirDrop is featured.
 * Android rejects with "iOS-only" — callers should check `isAirdropAvailable()`
 * first and fall back to `expo-sharing` (Intent.ACTION_SEND).
 *
 * Mirrors `solidarity/Services/Sharing/AirDropManager.swift::shareBusinessCard`
 * — vCard bytes + filename "<name>.vcf" + UTI `public.vcard`.
 */
import { Platform } from 'react-native';

import {
  getAirdrop,
  type AirdropResult,
} from '@solidarity/nitro-airdrop';
import type { BusinessCard } from '@solidarity/shared';

import { toVCard } from '@/cards/vCard';

/** UTI used by the iOS share sheet to route a vCard to the right receiver. */
const UTI_VCARD = 'public.vcard';
/** UTI used by the iOS share sheet to route an Apple Wallet pass. */
const UTI_PKPASS = 'com.apple.pkpass';

/**
 * `true` if AirDrop is reachable on the current platform. False on Android
 * (no AirDrop) and on any non-iOS platform.
 */
export function isAirdropAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return getAirdrop().isAvailable();
  } catch {
    return false;
  }
}

/**
 * Share a business card via AirDrop as a vCard. Returns the native result
 * (completed / cancelled / errorMessage). Throws on Android because the
 * Kotlin stub rejects — callers should branch on `isAirdropAvailable()`
 * first.
 */
export async function shareBusinessCardViaAirdrop(
  card: BusinessCard
): Promise<AirdropResult> {
  const vcard = toVCard(card);
  const data = stringToArrayBuffer(vcard);
  return getAirdrop().share({
    fileName: `${safeFileName(card.name)}.vcf`,
    utiType: UTI_VCARD,
    data,
  });
}

/**
 * Share an Apple Wallet pass via AirDrop. The bytes must already be a
 * fully-built `.pkpass` package (zip with signed manifest). The Expo
 * wallet-pass builder produces these — see
 * `apps/expo/src/components/walletpass/`.
 */
export async function shareWalletPassViaAirdrop(
  card: BusinessCard,
  passBytes: ArrayBuffer
): Promise<AirdropResult> {
  return getAirdrop().share({
    fileName: `${safeFileName(card.name)}.pkpass`,
    utiType: UTI_PKPASS,
    data: passBytes,
  });
}

/**
 * UTF-8 encode a string into an ArrayBuffer for the native side. Uses
 * `TextEncoder` (present in the Hermes/JSC runtime since RN 0.71) so we
 * don't drag in a polyfill just for this surface.
 */
function stringToArrayBuffer(input: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const view = encoder.encode(input);
  // `Uint8Array.buffer` may be a shared sub-view of a larger ArrayBuffer
  // (Hermes does this for short strings). Copy into a tight slab so the
  // bytes the native layer reads are exactly the encoded payload.
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

/**
 * Strip characters that confuse the iOS Document Picker / Finder reveal:
 * whitespace, path separators, shell metacharacters. Mirrors the Swift
 * AirDropManager pattern of using `card.name` verbatim, but with a safety
 * net for names imported from contacts with non-FS-safe chars.
 */
function safeFileName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Card';
  return trimmed.replace(/[\s/\\:*?"<>|-]/g, '_');
}
