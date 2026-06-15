/**
 * presentationQrPages — port of solidarity/Views/MeViews/PresentationQRPageBuilder.swift.
 *
 * Splits a presentation payload (VP JSON or `sce1:` compressed envelope) into
 * the same `sqc1.<session>.<index>.<total>.<digest>.<base64url>` frames Swift
 * already emits, so a scanner built against either side reassembles correctly.
 *
 * Wire format and chunk math live in `@solidarity/shared` (`qr/chunking.ts`).
 * This module is a thin adapter that picks a chunk size and exposes 1-based
 * page indices for UI. The shared wire cap is level-L sized; Expo renders with
 * react-native-qrcode-svg at ecl:M, so the default chunk is intentionally lower
 * to keep every frame renderable on device.
 *
 * Integration point: a future Expo `PresentationSheet` mirroring Swift's
 * `PresentationSheet` in CredentialDetailView.swift; pair these pages with
 * `PresentationChunkPlaybackControls` when `pages.length > 1`.
 */
import {
  QR_MIN_CHUNK_BYTES,
  QrChunkError,
  makeFrames,
} from '@solidarity/shared';

export const PRESENTATION_QR_RENDER_SAFE_CHUNK_BYTES = 1500;

export interface PresentationQRPage {
  readonly index: number;
  readonly total: number;
  readonly payload: string;
}

export interface BuildPresentationQrPagesOptions {
  readonly maxBytesPerChunk?: number;
}

export function buildPresentationQrPages(
  vpJson: string,
  options?: BuildPresentationQrPagesOptions,
): readonly PresentationQRPage[] {
  const byteCount = new TextEncoder().encode(vpJson).length;
  const requestedMax = Math.min(
    options?.maxBytesPerChunk ?? PRESENTATION_QR_RENDER_SAFE_CHUNK_BYTES,
    PRESENTATION_QR_RENDER_SAFE_CHUNK_BYTES,
  );
  const upperBound = Math.min(
    requestedMax,
    Math.max(byteCount, QR_MIN_CHUNK_BYTES),
  );

  const frames = makeFramesWithFallback(vpJson, upperBound);
  const total = frames.length;
  return frames.map((payload, i) => ({ index: i + 1, total, payload }));
}

/**
 * Mirrors Swift's binary search in PresentationQRPageBuilder: try the upper
 * bound first; if a frame overflows `maxFramePayloadBytes`, halve until the
 * largest working chunk size is found.
 */
function makeFramesWithFallback(
  payload: string,
  upperBound: number,
): readonly string[] {
  try {
    return makeFrames(payload, upperBound);
  } catch (error) {
    if (!isFrameTooLarge(error)) throw error;
    return findLargestWorkingFrames(payload, upperBound - 1, error);
  }
}

function findLargestWorkingFrames(
  payload: string,
  highWatermark: number,
  initialError: unknown,
): readonly string[] {
  let low = QR_MIN_CHUNK_BYTES;
  let high = highWatermark;
  let best: readonly string[] | null = null;
  let lastError: unknown = initialError;

  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2);
    try {
      best = makeFrames(payload, mid);
      low = mid + 1;
    } catch (error) {
      if (!isFrameTooLarge(error)) throw error;
      lastError = error;
      high = mid - 1;
    }
  }

  if (best) return best;
  throw lastError;
}

function isFrameTooLarge(error: unknown): boolean {
  return error instanceof QrChunkError && error.code === 'frameTooLarge';
}
