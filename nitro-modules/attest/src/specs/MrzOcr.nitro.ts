/**
 * Nitro spec — mrz-ocr (ICAO 9303 MRZ text recognition)
 *
 * The native side runs the text recogniser on a single VisionCamera Frame,
 * filters TD3-looking MRZ rows, and returns a draft only after validating
 * the BAC-critical ICAO 9303 check digits. JS only drives UI state.
 *
 *   iOS    : HybridMrzOcr.swift wraps VNRecognizeTextRequest.
 *   Android: HybridMrzOcr.kt wraps ML Kit Text Recognition (bundled model).
 *
 * Threading: `scanFrame` is synchronous and must be called from a
 * VisionCamera frame-processor worklet. Heavy lifting (text rec) blocks
 * inside the worklet; VisionCamera's frame output drops late frames while
 * this call is busy. The Frame must NOT be `.dispose()`d before this call
 * returns.
 */
import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

export interface PassportMrzDraft {
  readonly passportNumber: string;
  readonly nationalityCode: string;
  /** YYMMDD per ICAO 9303. */
  readonly dateOfBirth: string;
  /** YYMMDD per ICAO 9303. */
  readonly expiryDate: string;
}

export interface MrzScanResult {
  /** Present only when native OCR found and validated a TD3 MRZ pair. */
  readonly draft?: PassportMrzDraft;
  /** Number of OCR lines that look like MRZ rows; used only for scan UI. */
  readonly candidateCount: number;
  /** Minimum confidence across all returned lines (0..1). */
  readonly confidence: number;
  /** Frame dimensions at the time of recognition. */
  readonly frameWidth: number;
  readonly frameHeight: number;
}

export interface MrzOcr
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Run OCR on the given Frame. Returns a validated draft if a TD3 pair
   * passed native check-digit validation, otherwise progress metadata.
   *
   * Synchronous on both platforms; safe to call from a worklet.
   */
  scanFrame(frame: Frame): MrzScanResult;
}
