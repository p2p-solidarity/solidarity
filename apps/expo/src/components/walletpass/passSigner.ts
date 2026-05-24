/**
 * passSigner — 1:1 port of Swift `PassKitManager.createSignature(for:)`
 * (solidarity/Services/Sharing/PassKitManager+Generation.swift).
 *
 * Server-side PKCS#7 detached signing — the production Apple Wallet pass
 * certificate is held by a Cloudflare Worker at
 * `https://bussiness-card.kidneyweakx.com/sign-pass`. We POST the raw
 * `manifest.json` bytes with `Content-Type: text/plain` (matches Swift)
 * and the server replies with the binary PKCS#7 signature as the response
 * body (NOT a JSON envelope — the Swift code reads `data` directly).
 *
 * Override via `EXPO_PUBLIC_WALLET_SIGN_URL` if pointing at a staging
 * worker. Errors include the HTTP status + any `message` field from a
 * JSON error body so client-side logs aren't opaque.
 */

/** Production signing endpoint — keep byte-equal to the Swift constant. */
export const DEFAULT_SIGN_ENDPOINT =
  'https://bussiness-card.kidneyweakx.com/sign-pass';

/** Resolved endpoint — env override applied at module load. */
export const SIGN_ENDPOINT: string =
  resolveSignEndpoint() ?? DEFAULT_SIGN_ENDPOINT;

function resolveSignEndpoint(): string | undefined {
  if (typeof process === 'undefined') return undefined;
  const override = process.env['EXPO_PUBLIC_WALLET_SIGN_URL'];
  return override && override.length > 0 ? override : undefined;
}

/** Network timeout (matches Swift `request.timeoutInterval = 30`). */
const SIGN_TIMEOUT_MS = 30_000;

export class PassSigningError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'PassSigningError';
    this.status = status;
    this.body = body;
  }
}

/**
 * POST `manifestJsonBytes` to the signing endpoint and return the raw
 * PKCS#7 detached signature bytes. Throws `PassSigningError` on any
 * non-2xx, network failure, or empty body.
 */
export async function signManifest(
  manifestJsonBytes: Uint8Array,
  options?: { readonly endpoint?: string; readonly signal?: AbortSignal }
): Promise<Uint8Array> {
  const endpoint = options?.endpoint ?? SIGN_ENDPOINT;

  // Caller-supplied signal wins; otherwise apply our 30s timeout.
  const controller = options?.signal ? undefined : new AbortController();
  const timer =
    controller != null
      ? setTimeout(() => {
          controller.abort();
        }, SIGN_TIMEOUT_MS)
      : undefined;
  const signal = options?.signal ?? controller?.signal;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      // RN-safe: pass the underlying ArrayBuffer (avoids Uint8Array typing
      // mismatch between TS's BodyInit and React Native's stricter union).
      body: manifestJsonBytes.buffer.slice(
        manifestJsonBytes.byteOffset,
        manifestJsonBytes.byteOffset + manifestJsonBytes.byteLength
      ) as ArrayBuffer,
      signal,
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new PassSigningError(
      `Pass signing request failed: ${reason}`,
      0,
      reason
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await safeReadText(response);
    const detail = extractMessage(body);
    throw new PassSigningError(
      `Pass signing rejected (HTTP ${String(response.status)}): ${detail ?? (body || 'no body')}`,
      response.status,
      body
    );
  }

  const buf = await response.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new PassSigningError(
      'Pass signing returned an empty signature body',
      response.status,
      ''
    );
  }
  return new Uint8Array(buf);
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function extractMessage(body: string): string | undefined {
  if (body.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed
    ) {
      const { message } = parsed;
      if (typeof message === 'string') return message;
    }
  } catch {
    // Not JSON — fall through.
  }
  return undefined;
}
