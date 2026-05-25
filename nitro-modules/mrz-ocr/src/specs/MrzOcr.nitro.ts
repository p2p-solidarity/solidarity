/**
 * Nitro spec — mrz-ocr (ICAO 9303 MRZ text recognition)
 *
 * Intentionally minimal: the native side runs the text recogniser on a
 * single VisionCamera Frame and returns *every* OCR'd line. Filtering to
 * "looks like MRZ" + check-digit validation lives in JS (`mrz` npm
 * package), so we can iterate on the parser without rebuilding native.
 *
 *   iOS    : HybridMrzOcr.swift wraps VNRecognizeTextRequest.
 *   Android: HybridMrzOcr.kt wraps ML Kit Text Recognition (bundled model).
 *
 * Threading: `scanFrame` is synchronous and must be called from a
 * VisionCamera frame-processor worklet. Heavy lifting (text rec) blocks
 * inside the worklet; the consumer should throttle (e.g. every N frames)
 * and offload via `useAsyncRunner` if needed. The Frame must NOT be
 * `.dispose()`d before this call returns.
 */
import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

export interface RecognizedLines {
  /** Each recognised line, ordered top-to-bottom in Frame coordinates. */
  readonly lines: readonly string[];
  /** Minimum confidence across all returned lines (0..1). */
  readonly confidence: number;
  /** Frame dimensions at the time of recognition — JS uses these to scope ROI. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export interface MrzOcr
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Run OCR on the given Frame. Returns every recognised line; the JS
   * parser layer picks out the two MRZ rows by check-digit validation.
   *
   * Synchronous on both platforms; safe to call from a worklet.
   */
  scanFrame(frame: Frame): RecognizedLines;
}
