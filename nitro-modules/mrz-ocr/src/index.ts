/**
 * @solidarity/nitro-mrz-ocr — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject
 * adapter is auto-registered. `getMrzOcr()` returns the iOS Swift impl
 * (VNRecognizeTextRequest) or the Android Kotlin impl (ML Kit Text
 * Recognition).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { MrzOcr } from './specs/MrzOcr.nitro';

export type {
  MrzOcr,
  MrzScanResult,
  PassportMrzDraft,
} from './specs/MrzOcr.nitro';

let cached: MrzOcr | null = null;

export function getMrzOcr(): MrzOcr {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<MrzOcr>('MrzOcr');
  return cached;
}
