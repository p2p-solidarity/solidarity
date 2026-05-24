/**
 * Nitro spec — airdrop (Apple AirDrop activity wrapper).
 *
 * Wraps `UIActivityViewController` filtered so AirDrop is the headline
 * action. Mirrors `solidarity/Services/Sharing/AirDropManager.swift` so the
 * Expo client can share business cards (`.vcf`), wallet passes (`.pkpass`),
 * or any other UTI-tagged blob via the iOS share sheet.
 *
 *   iOS    : HybridAirdrop.swift presents UIActivityViewController from the
 *            topmost view controller of the foreground window scene.
 *   Android: HybridAirdrop.kt is a clean stub — isAvailable() = false,
 *            share() rejects with an "iOS-only" error so callers can fall
 *            back to platform-appropriate sharing (e.g. Intent.ACTION_SEND).
 *
 * Nested object types are extracted to top-level interfaces because
 * Nitrogen rejects anonymous inline structs (it can't codegen the C++).
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface AirdropPayload {
  /** Filename to show in AirDrop UI (e.g. "Alice.vcf" or "Alice.pkpass"). */
  readonly fileName: string;
  /** UTI string ("public.vcard", "com.apple.pkpass", "public.json"). */
  readonly utiType: string;
  /** Raw bytes to share. */
  readonly data: ArrayBuffer;
}

export interface AirdropResult {
  /** true if the user completed the share (activity returned completed=true). */
  readonly completed: boolean;
  /** true if the user cancelled the activity sheet. */
  readonly cancelled: boolean;
  /** Optional error message if presentation failed. */
  readonly errorMessage?: string;
}

export interface Airdrop
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  isAvailable(): boolean;
  share(payload: AirdropPayload): Promise<AirdropResult>;
}
