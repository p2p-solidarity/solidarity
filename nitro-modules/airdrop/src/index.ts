/**
 * @solidarity/nitro-airdrop — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject adapter
 * is auto-registered. `getAirdrop()` returns the iOS Swift impl
 * (UIActivityViewController wrap) or the Android Kotlin stub (rejects with
 * "iOS-only" so callers know to branch on Platform.OS).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { Airdrop } from './specs/Airdrop.nitro';

export type {
  Airdrop,
  AirdropPayload,
  AirdropResult,
} from './specs/Airdrop.nitro';

let cached: Airdrop | null = null;

export function getAirdrop(): Airdrop {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<Airdrop>('Airdrop');
  return cached;
}
