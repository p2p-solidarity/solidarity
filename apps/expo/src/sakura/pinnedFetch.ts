/**
 * Sakura relay TLS-pinned fetch.
 *
 * Wraps `react-native-ssl-pinning`'s native `fetch` (OkHttp on Android,
 * AFNetworking on iOS) so callers can use a standard fetch-like API. The
 * trust policy mirrors Swift `PinnedSessionDelegate` in
 * `solidarity/Services/Sharing/MessageService.swift`:
 *
 *   - Non-pinned host          → standard fetch (system trust).
 *   - Pinned host + matches    → accept.
 *   - Pinned host + no match   → throw `TlsPinError` (fail closed).
 *   - Pinned host + empty pins → fall back to system trust in DEV;
 *                                throw `TlsPinError` in release.
 *
 * The pin set lives in `pinnedHashes.ts`; staging can override via
 * `EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES`. The native module is loaded
 * lazily so unit tests can stub it via `bun:test`'s `mock.module`. If
 * the native module fails to load on a pinned-host request, we throw —
 * NEVER silently downgrade to raw fetch.
 */
import {
  SAKURA_PINNED_HOST,
  allowsUnpinnedFallback,
  resolvePinnedHashes,
} from './pinnedHashes';

/** Surfaces a TLS pin failure to the UI. */
export class TlsPinError extends Error {
  constructor(message: string, readonly host: string) {
    super(message);
    this.name = 'TlsPinError';
  }
}

interface SslPinningFetchOptions {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  timeoutInterval?: number;
  pkPinning?: boolean;
  sslPinning?: { certs: string[] };
}

interface SslPinningResponse {
  status: number;
  url?: string;
  headers?: Record<string, string>;
  bodyString?: string;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

interface SslPinningModule {
  fetch: (url: string, opts: SslPinningFetchOptions) => Promise<SslPinningResponse>;
}

let pinningModuleCache: SslPinningModule | null | undefined;

function loadPinningModule(): SslPinningModule | null {
  if (pinningModuleCache !== undefined) return pinningModuleCache;
  try {
    const mod = require('react-native-ssl-pinning') as SslPinningModule;
    pinningModuleCache = mod;
  } catch {
    pinningModuleCache = null;
  }
  return pinningModuleCache;
}

/** Test-only — drops the cached module so a fresh `require` runs. */
export function __resetPinnedFetchModuleCache(): void {
  pinningModuleCache = undefined;
}

/** Test-only — force the wrapper to treat the native module as unavailable. */
export function __setPinningModuleUnavailableForTesting(): void {
  pinningModuleCache = null;
}

function hostOf(url: string): string {
  // Lightweight host extraction — avoids URL parser differences between
  // Hermes / JSC. Matches the regex used by the Swift host check.
  const match = /^https?:\/\/([^/:?#]+)/iu.exec(url);
  return match?.[1] ?? '';
}

function headersToRecord(input: HeadersInit | undefined): Record<string, string> {
  if (!input) return {};
  if (Array.isArray(input)) {
    const out: Record<string, string> = {};
    for (const [k, v] of input) out[k] = v;
    return out;
  }
  if (typeof Headers !== 'undefined' && input instanceof Headers) {
    const out: Record<string, string> = {};
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  return { ...(input as Record<string, string>) };
}

function bodyToString(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  // URLSearchParams exposes a deterministic toString; anything else
  // (FormData / Blob / ReadableStream) is rejected so callers don't
  // silently send `[object Object]` over the wire.
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return body.toString();
  }
  throw new Error('pinnedFetch: unsupported body type');
}

function buildResponse(raw: SslPinningResponse): Response {
  const body = raw.bodyString ?? '';
  const headers = new Headers(raw.headers ?? {});
  return new Response(body, {
    status: raw.status,
    headers,
  });
}

/**
 * Fetch with TLS pinning for the Sakura relay. Falls through to the
 * platform `fetch` for non-pinned hosts. Throws `TlsPinError` when the
 * pin set rejects the server.
 */
export async function pinnedFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const host = hostOf(input);

  // Non-pinned host → standard fetch (Swift delegate does the same).
  if (host !== SAKURA_PINNED_HOST) {
    return fetch(input, init);
  }

  const pins = resolvePinnedHashes();

  // Empty pin set: DEV falls back to system trust; release fails closed.
  if (pins.length === 0) {
    if (allowsUnpinnedFallback()) {
      console.warn(
        `[Sakura][TLS][WARNING] No pins configured for ${host}. ` +
          'Falling back to system trust (DEV only). Configure SAKURA_PINNED_HASHES before shipping.'
      );
      return fetch(input, init);
    }
    throw new TlsPinError(
      `No TLS pins configured for ${host}; refusing to send (release builds require explicit pinning).`,
      host
    );
  }

  const mod = loadPinningModule();
  if (!mod) {
    // Per task constraint: no silent fallback — throw so callers surface.
    throw new TlsPinError(
      `react-native-ssl-pinning native module unavailable; cannot establish pinned connection to ${host}.`,
      host
    );
  }

  const certs = pins.map((h) => (h.startsWith('sha256/') ? h : `sha256/${h}`));

  try {
    const opts: SslPinningFetchOptions = {
      method: init.method ?? 'GET',
      headers: headersToRecord(init.headers),
      pkPinning: true,
      sslPinning: { certs },
      timeoutInterval: 30_000,
    };
    const body = bodyToString(init.body);
    if (body !== undefined) opts.body = body;
    const raw = await mod.fetch(input, opts);
    return buildResponse(raw);
  } catch (err) {
    // The library throws strings / objects with a `status: 'cancelled'`
    // payload on pin mismatch. Normalise to TlsPinError so callers can
    // distinguish from generic network errors.
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : JSON.stringify(err);
    throw new TlsPinError(
      `TLS pin verification failed for ${host}: ${message}`,
      host
    );
  }
}
