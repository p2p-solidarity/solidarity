/**
 * QR code facade — TS port of solidarity/Services/Card/QRCodeManager.swift.
 *
 * Two responsibilities, matching the Swift surface:
 *   - generate : turn an arbitrary string into a renderable image source
 *                (data: URL carrying an SVG). The Swift version returns
 *                a UIImage; on RN a data URL is the closest cross-
 *                platform equivalent — drop it into `<Image source={{ uri }} />`
 *                or write it out with `expo-file-system`.
 *   - parse    : classify an arbitrary scanned string into the same
 *                buckets `QRCodeScanService.handleScannedString` routes
 *                into (card / vp / group / oidc / unknown).
 *
 * Don't break existing `<QRCode value={…} />` call sites — this facade
 * is additive. Generation goes through `react-native-qrcode-svg`'s
 * underlying `qrcode` core (already a transitive dep), so we don't pull
 * a new package in.
 */
import { decodeJwtUnsafe } from '@solidarity/shared';

import { base64Encode, utf8ToBytes } from '@solidarity/shared';

export type QrPayloadKind = 'card' | 'vp' | 'group' | 'oidc' | 'unknown';

export interface ParsedQrPayload {
  readonly kind: QrPayloadKind;
  readonly raw: string;
}

type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

interface GenerateOptions {
  readonly size?: number;
  /**
   * Starting error-correction level for the cascade. Mirrors Swift's
   * `QRCodeGenerationService.generateImageCascading`:
   *   - `'H'` for plaintext envelopes (default — densest error correction
   *     when the payload fits, gracefully degrades for large payloads).
   *   - `'M'` for compressed ZK proofs.
   *   - `'L'` for didSigned JWTs (already long; aim for capacity headroom).
   * On exception, falls through `H → Q → M → L` until a level encodes.
   */
  readonly startingLevel?: ErrorCorrectionLevel;
}

interface QrCodeModule {
  toString(text: string, opts: { type: 'svg'; width?: number; margin?: number; errorCorrectionLevel?: ErrorCorrectionLevel }): Promise<string>;
}

let qrModuleCache: QrCodeModule | null = null;
let qrModuleFailed = false;

async function loadQrModule(): Promise<QrCodeModule | null> {
  if (qrModuleCache) return qrModuleCache;
  if (qrModuleFailed) return null;
  try {
    // `qrcode` ships no .d.ts in this version; cast through unknown so
    // the type system doesn't complain. Behaviour is verified at runtime
    // via the `toString` typeof guard below.
    const dynamicImport = (id: string): Promise<unknown> =>
      (import(/* @vite-ignore */ id) as Promise<unknown>);
    const raw = (await dynamicImport('qrcode')) as { default?: QrCodeModule } & Partial<QrCodeModule>;
    const candidate = raw.default ?? (raw as QrCodeModule);
    if (typeof candidate.toString === 'function') {
      qrModuleCache = candidate;
      return qrModuleCache;
    }
    qrModuleFailed = true;
    return null;
  } catch {
    qrModuleFailed = true;
    return null;
  }
}

const CASCADE_LEVELS: readonly ErrorCorrectionLevel[] = ['H', 'Q', 'M', 'L'] as const;

/**
 * Render `value` as a QR code and return a `data:image/svg+xml;base64,…`
 * URL. Mirrors Swift's `QRCodeGenerationService.generateImageCascading`:
 * tries `opts.startingLevel` (default `'H'` — Swift's plaintext default)
 * then progressively lower error-correction levels in the order
 * `H → Q → M → L` until the payload fits. The underlying `qrcode` engine
 * throws `'The amount of data is too big to be stored in a QR Code'` when
 * capacity is exceeded; we catch that and step down one level.
 *
 * Caller hints (match Swift `encodeEnvelopeToImage`):
 *   - plaintext envelopes → `startingLevel: 'H'` (default)
 *   - compressed zkProof  → `startingLevel: 'M'`
 *   - didSigned JWT       → `startingLevel: 'L'`
 */
export async function generateQrPng(value: string, opts: GenerateOptions = {}): Promise<string> {
  const size = opts.size ?? 256;
  const startingLevel = opts.startingLevel ?? 'H';
  const mod = await loadQrModule();
  if (mod) {
    const startIndex = Math.max(0, CASCADE_LEVELS.indexOf(startingLevel));
    let lastError: unknown = null;
    for (let i = startIndex; i < CASCADE_LEVELS.length; i += 1) {
      const level = CASCADE_LEVELS[i];
      try {
        const svg = await mod.toString(value, {
          type: 'svg',
          width: size,
          margin: 1,
          errorCorrectionLevel: level,
        });
        return `data:image/svg+xml;base64,${base64Encode(utf8ToBytes(svg))}`;
      } catch (err) {
        lastError = err;
        // Try the next (lower) correction level. `qrcode` throws
        // 'The amount of data is too big to be stored in a QR Code'
        // when the payload exceeds the chosen level's capacity.
      }
    }
    // Engine present but every level rejected the payload — fall through
    // to the safety-net SVG below so the caller still renders *something*
    // rather than propagating the throw.
    void lastError;
  }

  // Fallback — never expected in production builds (the engine is a
  // transitive dep of `react-native-qrcode-svg`). Keep the surface
  // contract intact so the caller can still render *something*.
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#FFFFFF"/><text x="8" y="20" font-size="10">${escapeXml(value)}</text></svg>`;
  return `data:image/svg+xml;base64,${base64Encode(utf8ToBytes(fallbackSvg))}`;
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isJwt(text: string): boolean {
  const parts = text.split('.');
  if (parts.length !== 3) return false;
  try {
    decodeJwtUnsafe(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a scanned QR payload. Mirrors the buckets the Swift scan
 * service routes into.
 */
export function parseQrPayload(text: string): ParsedQrPayload {
  if (!text) return { kind: 'unknown', raw: text };

  if (text.startsWith('openid4vp://') || text.startsWith('openid-vp://')) {
    return { kind: 'oidc', raw: text };
  }
  if (text.startsWith('openid-credential-offer://')) {
    return { kind: 'oidc', raw: text };
  }

  if (text.startsWith('solidarity://') || text.startsWith('airmeishi://')) {
    if (text.includes('/group')) return { kind: 'group', raw: text };
    if (text.includes('/card')) return { kind: 'card', raw: text };
    return { kind: 'unknown', raw: text };
  }

  if (text.startsWith('BEGIN:VCARD')) {
    return { kind: 'card', raw: text };
  }

  if (text.startsWith('SOLIDARITY_VC::') || text.startsWith('AIRMEISHI_VC::')) {
    return { kind: 'vp', raw: text };
  }

  if (isJwt(text)) {
    return { kind: 'vp', raw: text };
  }

  return { kind: 'unknown', raw: text };
}
