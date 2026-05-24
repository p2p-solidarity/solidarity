/**
 * pinnedFetch — TLS pinning wrapper that mirrors Swift
 * `MessageServerPinning.swift` / `PinnedSessionDelegate`.
 *
 * We stub `react-native-ssl-pinning` so the suite runs in `bun test`
 * without touching native code, and assert:
 *
 *   1. Calls to the pinned host route through the pinning library
 *      (not the global `fetch`) when pins are configured.
 *   2. Pin mismatches throw `TlsPinError`.
 *   3. Calls to a non-pinned host bypass the pinning library and use
 *      the standard `fetch`.
 *   4. The `EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES` env var feeds the
 *      pinning library when set.
 *   5. The wrapper refuses to ship the request when the native module
 *      is unavailable (no silent fallback to raw fetch).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { SAKURA_PINNED_HOST } from '../../src/sakura/pinnedHashes';
import type * as PinnedFetchModuleType from '../../src/sakura/pinnedFetch';

// ── react-native-ssl-pinning mock ──────────────────────────────────────────

interface PinningCall {
  url: string;
  method?: string;
  body?: unknown;
  pkPinning?: boolean;
  certs?: string[];
  headers?: Record<string, string>;
}

const pinningCalls: PinningCall[] = [];
let pinningResult:
  | { ok: true; status: number; body: string }
  | { ok: false; error: Error } = {
  ok: true,
  status: 200,
  body: '{"sealed_route":"sealed-route-pinned"}',
};

const sslPinningMock = {
  fetch: (
    url: string,
    opts: {
      method?: string;
      body?: unknown;
      pkPinning?: boolean;
      sslPinning?: { certs: string[] };
      headers?: Record<string, string>;
    }
  ): Promise<{ status: number; bodyString: string; headers: Record<string, string> }> => {
    pinningCalls.push({
      url,
      method: opts.method,
      body: opts.body,
      pkPinning: opts.pkPinning,
      certs: opts.sslPinning?.certs,
      headers: opts.headers,
    });
    if (!pinningResult.ok) {
      return Promise.reject(pinningResult.error);
    }
    return Promise.resolve({
      status: pinningResult.status,
      bodyString: pinningResult.body,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

// ── globalThis.fetch capture (for the non-pinned-host bypass case) ─────────

interface FetchCall {
  url: string;
  method?: string;
}
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function installFetchMock(): void {
  (globalThis as { fetch: typeof fetch }).fetch = ((
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchCalls.push({ url, method: init?.method });
    return Promise.resolve(
      new Response('{"ok":true}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }) as typeof fetch;
}

function restoreFetch(): void {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
}

// ── Module under test ──────────────────────────────────────────────────────

type PinnedFetchModule = typeof PinnedFetchModuleType;
let pinnedFetchMod: PinnedFetchModule;

beforeAll(async () => {
  await mock.module('react-native-ssl-pinning', () => sslPinningMock);
  installFetchMock();
  const imported: unknown = await import('../../src/sakura/pinnedFetch');
  pinnedFetchMod = imported as PinnedFetchModule;
});

beforeEach(() => {
  pinningCalls.length = 0;
  fetchCalls.length = 0;
  pinningResult = {
    ok: true,
    status: 200,
    body: '{"sealed_route":"sealed-route-pinned"}',
  };
  delete process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'];
  // Re-install in case a sibling suite swapped fetch.
  installFetchMock();
  pinnedFetchMod.__resetPinnedFetchModuleCache();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('pinnedFetch — pinned host routing', () => {
  it('routes pinned-host requests through react-native-ssl-pinning when pins are configured', async () => {
    process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'] =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    const res = await pinnedFetchMod.pinnedFetch(
      `https://${SAKURA_PINNED_HOST}/v1/seal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_token: 'tok' }),
      }
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { sealed_route: string };
    expect(json.sealed_route).toBe('sealed-route-pinned');

    // The pinning library was hit — NOT the raw fetch.
    expect(pinningCalls.length).toBe(1);
    expect(fetchCalls.length).toBe(0);

    const call = pinningCalls[0];
    expect(call?.url).toBe(`https://${SAKURA_PINNED_HOST}/v1/seal`);
    expect(call?.method).toBe('POST');
    expect(call?.pkPinning).toBe(true);
    expect(call?.certs).toEqual([
      'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ]);
    expect(call?.body).toBe(JSON.stringify({ device_token: 'tok' }));
  });

  it('surfaces a TlsPinError when the pinning library rejects the leaf', async () => {
    process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'] = 'ZZZ=';
    pinningResult = { ok: false, error: new Error('certificate pinning failed') };

    let thrown: unknown;
    try {
      await pinnedFetchMod.pinnedFetch(`https://${SAKURA_PINNED_HOST}/v1/inbox?pubkey=x`);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(pinnedFetchMod.TlsPinError);
    const err = thrown as InstanceType<typeof pinnedFetchMod.TlsPinError>;
    expect(err.host).toBe(SAKURA_PINNED_HOST);
    expect(err.message).toContain('TLS pin verification failed');
    expect(err.message).toContain('certificate pinning failed');

    // The raw fetch was NOT used as a silent fallback.
    expect(fetchCalls.length).toBe(0);
  });

  it('respects EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES with multiple comma-separated hashes', async () => {
    process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'] = 'one=, two=, three=';

    await pinnedFetchMod.pinnedFetch(`https://${SAKURA_PINNED_HOST}/v1/ack`, {
      method: 'POST',
      body: '{}',
    });

    expect(pinningCalls[0]?.certs).toEqual([
      'sha256/one=',
      'sha256/two=',
      'sha256/three=',
    ]);
  });
});

describe('pinnedFetch — non-pinned host bypass', () => {
  it('uses the standard fetch for hosts outside the pinned set', async () => {
    process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'] = 'overridehash=';
    await pinnedFetchMod.pinnedFetch('https://relay.example.test/v1/seal', {
      method: 'POST',
      body: JSON.stringify({ device_token: 'tok' }),
    });

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]?.url).toBe('https://relay.example.test/v1/seal');
    expect(pinningCalls.length).toBe(0);
  });
});

describe('pinnedFetch — native module unavailable', () => {
  it('throws TlsPinError instead of silently falling back to raw fetch', async () => {
    process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'] = 'present=';

    // Force the wrapper to act as if `require('react-native-ssl-pinning')`
    // threw — i.e. the native module is missing on this platform.
    pinnedFetchMod.__setPinningModuleUnavailableForTesting();

    let thrown: unknown;
    try {
      await pinnedFetchMod.pinnedFetch(`https://${SAKURA_PINNED_HOST}/v1/seal`, {
        method: 'POST',
        body: '{}',
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(pinnedFetchMod.TlsPinError);
    expect((thrown as Error).message).toContain(
      'react-native-ssl-pinning native module unavailable'
    );
    expect(fetchCalls.length).toBe(0);

    // Reset for later tests / parallel suites.
    pinnedFetchMod.__resetPinnedFetchModuleCache();
  });
});

describe('cleanup', () => {
  it('exposes restoreFetch for harness reuse', () => {
    expect(typeof restoreFetch).toBe('function');
  });
});
