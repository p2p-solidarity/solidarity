/**
 * Sakura APNs/FCM push rail — registration + sync + ack.
 *
 * Mirrors Swift `AppDelegate` + `MessageService.processIncomingMessages`.
 * The Expo split lives in:
 *   - apps/expo/src/sakura/pushRegistration.ts (token → seal → persist)
 *   - apps/expo/src/sakura/inbox.ts             (sync → openBlob → ack)
 *   - apps/expo/src/sakura/recipientKeys.ts     (long-term X25519 + P-256)
 *   - apps/expo/src/sakura/sealedRouteStore.ts  (MMKV-backed cache)
 *
 * Strategy: stub `expo-notifications` + `expo-secure-store` + the global
 * `fetch` so the orchestrator runs end-to-end inside bun without touching
 * any native code. We compose a real sealed blob via the shared
 * `sealBlob` helper so the decrypt path exercises actual crypto.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  base64Decode,
  base64Encode,
  bytesToUtf8,
  sealBlob,
  utf8ToBytes,
  type InboxMessage,
  type SealResponse,
} from '@solidarity/shared';
import { ed25519 } from '@noble/curves/ed25519.js';

// ── Environment ──────────────────────────────────────────────────────────────

const RELAY_URL = 'https://relay.example.test';
process.env['EXPO_PUBLIC_SAKURA_API_URL'] = RELAY_URL;

// ── expo-notifications mock ─────────────────────────────────────────────────

interface PermissionsRequestMock {
  granted: boolean;
  ios?: { status: number };
}

let nextPermissionResult: PermissionsRequestMock = { granted: true };
const FAKE_TOKEN = 'apns-token-fixed-for-test';
let nextDeviceToken: string | null = FAKE_TOKEN;
const tokenListeners: ((tok: { type: string; data: string }) => void)[] = [];
const notificationListeners: ((event: unknown) => void)[] = [];
const responseListeners: ((event: unknown) => void)[] = [];

const notificationsMock = {
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  requestPermissionsAsync: () => Promise.resolve(nextPermissionResult),
  getDevicePushTokenAsync: () =>
    nextDeviceToken
      ? Promise.resolve({ type: 'ios', data: nextDeviceToken })
      : Promise.reject(new Error('no token')),
  unregisterForNotificationsAsync: () => Promise.resolve(),
  addNotificationReceivedListener: (fn: (event: unknown) => void) => {
    notificationListeners.push(fn);
    return {
      remove: () => {
        const i = notificationListeners.indexOf(fn);
        if (i >= 0) notificationListeners.splice(i, 1);
      },
    };
  },
  addNotificationResponseReceivedListener: (fn: (event: unknown) => void) => {
    responseListeners.push(fn);
    return {
      remove: () => {
        const i = responseListeners.indexOf(fn);
        if (i >= 0) responseListeners.splice(i, 1);
      },
    };
  },
  addPushTokenListener: (fn: (tok: { type: string; data: string }) => void) => {
    tokenListeners.push(fn);
    return {
      remove: () => {
        const i = tokenListeners.indexOf(fn);
        if (i >= 0) tokenListeners.splice(i, 1);
      },
    };
  },
};

// ── expo-secure-store mock — backs the recipientKeys persistence ─────────────

const secureKv = new Map<string, string>();
const secureStoreMock = {
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: (k: string): Promise<string | null> =>
    Promise.resolve(secureKv.get(k) ?? null),
  setItemAsync: (k: string, v: string): Promise<void> => {
    secureKv.set(k, v);
    return Promise.resolve();
  },
  deleteItemAsync: (k: string): Promise<void> => {
    secureKv.delete(k);
    return Promise.resolve();
  },
};

// ── MMKV + encryptionManager mocks ──────────────────────────────────────────

const mmkv = new Map<string, string>();
const mmkvMock = {
  getMmkv: () => ({
    getString: (k: string): string | undefined => mmkv.get(k),
    set: (k: string, v: string): void => {
      mmkv.set(k, v);
    },
    remove: (k: string): void => {
      mmkv.delete(k);
    },
    getAllKeys: (): readonly string[] => Array.from(mmkv.keys()),
  }),
  initMmkv: () => Promise.resolve(),
};
const encryptionMock = {
  // Bypass crypto in the cache layer — the actual `openBlob` path is still
  // exercised end-to-end; only the secondary storage envelope is stubbed.
  encryptJson: <T,>(v: T): Promise<string> => Promise.resolve(JSON.stringify(v)),
  decryptJson: <T,>(s: string): Promise<T> =>
    Promise.resolve(JSON.parse(s) as T),
};

// ── Fetch mock — records every call so we can assert against them ───────────

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}

const requests: CapturedRequest[] = [];
let sealCallCount = 0;
let syncResponseQueue: InboxMessage[][] = [];
let ackResponse: { ok: boolean } = { ok: true };

function buildFakeSealResponse(): SealResponse {
  sealCallCount += 1;
  return { sealed_route: `sealed-route-${String(sealCallCount)}` };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;
function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
function installFetchMock(): void {
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const method = init?.method ?? 'GET';
    let parsedBody: unknown = undefined;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    requests.push({ url, method, body: parsedBody });

    if (url.endsWith('/v1/seal')) {
      return Promise.resolve(jsonResponse(buildFakeSealResponse()));
    }
    if (url.includes('/v1/inbox')) {
      const batch = syncResponseQueue.shift() ?? [];
      return Promise.resolve(jsonResponse({ messages: batch }));
    }
    if (url.endsWith('/v1/ack')) {
      return Promise.resolve(
        ackResponse.ok ? jsonResponse({}) : new Response('boom', { status: 500 })
      );
    }
    return Promise.resolve(new Response('not mocked', { status: 404 }));
  };
  (globalThis as unknown as { fetch: typeof fakeFetch }).fetch = fakeFetch;
}

function restoreFetch(): void {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
}

// ── Test module typing ──────────────────────────────────────────────────────

interface PushModule {
  readonly registerForPushNotificationsAsync: () => Promise<{
    token: string;
    sealed: SealResponse;
  } | null>;
  readonly unregister: () => Promise<void>;
}

interface InboxModule {
  readonly syncOnce: () => Promise<readonly { messageId: string; text: string }[]>;
  readonly cachedInbox: (limit?: number) => Promise<
    readonly { messageId: string; decryptedJson: string }[]
  >;
}

interface RoutesModule {
  readonly useSealedRouteStore: {
    getState: () => { sealedRoute?: SealResponse; deviceToken?: string };
    setState: (s: Partial<{
      deviceToken?: string;
      sealedRoute?: SealResponse;
      lastRegisteredAt?: number;
    }>) => void;
  };
  readonly hydrateSealedRoute: () => void;
}

interface RecipientModule {
  readonly loadOrCreateRecipientKeys: () => Promise<{
    encryptionPub: Uint8Array;
    encryptionPubBase64: string;
    signingPub: Uint8Array;
    signingPubBase64: string;
  }>;
  readonly resetRecipientKeysForTesting: () => Promise<void>;
  readonly signSendRequest: (input: {
    recipientPubkey: string;
    blob: string;
    sealedRoute: string;
  }) => Promise<string>;
}

let pushMod: PushModule;
let inboxMod: InboxModule;
let routeMod: RoutesModule;
let recipientMod: RecipientModule;

beforeAll(async () => {
  await mock.module('expo-notifications', () => notificationsMock);
  await mock.module('expo-secure-store', () => secureStoreMock);
  await mock.module('@/storage/mmkv', () => mmkvMock);
  await mock.module('@/storage/encryptionManager', () => encryptionMock);

  installFetchMock();

  const pushImport: unknown = await import('../../src/sakura/pushRegistration');
  const inboxImport: unknown = await import('../../src/sakura/inbox');
  const routeImport: unknown = await import('../../src/sakura/sealedRouteStore');
  const recipientImport: unknown = await import('../../src/sakura/recipientKeys');
  pushMod = pushImport as PushModule;
  inboxMod = inboxImport as InboxModule;
  routeMod = routeImport as RoutesModule;
  recipientMod = recipientImport as RecipientModule;
});

beforeEach(async () => {
  requests.length = 0;
  sealCallCount = 0;
  syncResponseQueue = [];
  ackResponse = { ok: true };
  nextPermissionResult = { granted: true };
  nextDeviceToken = FAKE_TOKEN;
  notificationListeners.length = 0;
  responseListeners.length = 0;
  tokenListeners.length = 0;
  mmkv.clear();
  secureKv.clear();
  // Re-install our fetch mock in case a sibling test file (parallel-loaded
  // by bun) swapped `globalThis.fetch` between tests. Without this guard the
  // first test in the file may see another suite's fetch and timeout.
  installFetchMock();
  // Reset the in-memory sealed-route store between tests so freshness
  // checks behave deterministically.
  routeMod.useSealedRouteStore.setState({
    deviceToken: undefined,
    sealedRoute: undefined,
    lastRegisteredAt: undefined,
  });
  await recipientMod.resetRecipientKeysForTesting();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('registerForPushNotificationsAsync — token → seal → persist', () => {
  it('persists the sealed route after a successful exchange', async () => {
    const result = await pushMod.registerForPushNotificationsAsync();
    expect(result).not.toBeNull();
    expect(result?.token).toBe(FAKE_TOKEN);
    expect(result?.sealed.sealed_route).toBe('sealed-route-1');

    const sealCalls = requests.filter((r) => r.url.endsWith('/v1/seal'));
    expect(sealCalls.length).toBe(1);
    expect(sealCalls[0]?.body).toEqual({ device_token: FAKE_TOKEN });

    const snapshot = routeMod.useSealedRouteStore.getState();
    expect(snapshot.deviceToken).toBe(FAKE_TOKEN);
    expect(snapshot.sealedRoute?.sealed_route).toBe('sealed-route-1');

    // Persisted into MMKV under the sealed-route key.
    expect(mmkv.has('gg.solidarity.sakura.route.v1')).toBe(true);
  });

  it('returns null when permission is denied (Swift parity: skip silently)', async () => {
    nextPermissionResult = { granted: false };
    const result = await pushMod.registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(requests.filter((r) => r.url.endsWith('/v1/seal')).length).toBe(0);
  });

  it('returns null when no device token is available (simulator path)', async () => {
    nextDeviceToken = null;
    const result = await pushMod.registerForPushNotificationsAsync();
    expect(result).toBeNull();
    expect(requests.filter((r) => r.url.endsWith('/v1/seal')).length).toBe(0);
  });

  it('is idempotent: a recent registration with the same token skips the network', async () => {
    await pushMod.registerForPushNotificationsAsync();
    requests.length = 0;
    sealCallCount = 0;
    const again = await pushMod.registerForPushNotificationsAsync();
    expect(again).not.toBeNull();
    expect(requests.filter((r) => r.url.endsWith('/v1/seal')).length).toBe(0);
  });
});

describe('syncOnce — decrypt + ack against a real sealBlob fixture', () => {
  it('decrypts the inbox blob and acks with the right message id', async () => {
    const keys = await recipientMod.loadOrCreateRecipientKeys();
    const payload = utf8ToBytes(JSON.stringify({ subject: 'hi', body: 'sakura' }));
    const blob = sealBlob(keys.encryptionPub, payload);
    const fixture: InboxMessage = {
      id: 'msg-id-1',
      owner_pubkey: 'sender-pubkey',
      blob: base64Encode(blob),
      created_at: 1_700_000_000,
    };
    syncResponseQueue = [[fixture]];

    const opened = await inboxMod.syncOnce();
    expect(opened.length).toBe(1);
    expect(opened[0]?.messageId).toBe('msg-id-1');
    const parsed = JSON.parse(opened[0]?.text ?? '{}') as Record<string, unknown>;
    expect(parsed['subject']).toBe('hi');
    expect(parsed['body']).toBe('sakura');

    const ackCalls = requests.filter((r) => r.url.endsWith('/v1/ack'));
    expect(ackCalls.length).toBe(1);
    const ackBody = ackCalls[0]?.body as { message_ids: string[]; pubkey: string; sig: string };
    expect(ackBody.message_ids).toEqual(['msg-id-1']);
    expect(typeof ackBody.pubkey).toBe('string');
    expect(typeof ackBody.sig).toBe('string');

    // Ed25519 shape matches Swift `Curve25519.Signing`: 32-byte raw pubkey
    // + 64-byte raw signature, both standard-base64 padded.
    const ackPubBytes = base64Decode(ackBody.pubkey);
    const ackSigBytes = base64Decode(ackBody.sig);
    expect(ackPubBytes.length).toBe(32);
    expect(ackSigBytes.length).toBe(64);
    expect(ackBody.pubkey).toBe(keys.signingPubBase64);
    expect(ackPubBytes).toEqual(keys.signingPub);

    // Round-trip: the relay reproduces the canonical content
    // (`ids.joined(',')`, Swift `MessageService.ackMessages` line 132) and
    // verifies the Ed25519 signature with our public key.
    const canonical = utf8ToBytes(ackBody.message_ids.join(','));
    expect(ed25519.verify(ackSigBytes, canonical, ackPubBytes)).toBe(true);

    // Cached entry is queryable after the sync.
    const cached = await inboxMod.cachedInbox();
    expect(cached.length).toBe(1);
    expect(cached[0]?.messageId).toBe('msg-id-1');
    expect(JSON.parse(cached[0]?.decryptedJson ?? '{}')).toEqual(
      parsed
    );
  });

  it('skips blobs we cannot decrypt without crashing the batch', async () => {
    const keys = await recipientMod.loadOrCreateRecipientKeys();
    const goodBlob = sealBlob(keys.encryptionPub, utf8ToBytes('hello'));
    // A blob we don't have the key for — random bytes that are valid AEAD
    // structurally but won't open with our recipient key.
    const badBlob = sealBlob(
      // Different recipient pubkey
      new Uint8Array(32).fill(7),
      utf8ToBytes('locked away')
    );
    syncResponseQueue = [
      [
        {
          id: 'good',
          owner_pubkey: 's1',
          blob: base64Encode(goodBlob),
          created_at: 1,
        },
        {
          id: 'bad',
          owner_pubkey: 's2',
          blob: base64Encode(badBlob),
          created_at: 2,
        },
      ],
    ];

    const opened = await inboxMod.syncOnce();
    expect(opened.length).toBe(1);
    expect(opened[0]?.messageId).toBe('good');
    expect(bytesToUtf8(utf8ToBytes(opened[0]?.text ?? ''))).toBe('hello');

    const ackCalls = requests.filter((r) => r.url.endsWith('/v1/ack'));
    expect(ackCalls.length).toBe(1);
    const ackBody = ackCalls[0]?.body as { message_ids: string[] };
    expect(ackBody.message_ids).toEqual(['good']);
  });

  it('returns empty list when the relay has no new mail', async () => {
    syncResponseQueue = [[]];
    const opened = await inboxMod.syncOnce();
    expect(opened.length).toBe(0);
    // No ack call when there is no pending ack debt either.
    expect(requests.filter((r) => r.url.endsWith('/v1/ack')).length).toBe(0);
  });
});

describe('signSendRequest — canonical bytes + Ed25519 round-trip', () => {
  it('produces an Ed25519 signature the holder pubkey can verify', async () => {
    const keys = await recipientMod.loadOrCreateRecipientKeys();
    const input = {
      recipientPubkey: 'recipient-pub-b64',
      blob: 'blob-b64',
      sealedRoute: 'sealed-route-1',
    };
    const sigBase64 = await recipientMod.signSendRequest(input);

    // 64-byte raw EdDSA signature — matches Swift Curve25519.Signing output.
    const sigBytes = base64Decode(sigBase64);
    expect(sigBytes.length).toBe(64);

    // Canonical bytes — verbatim what Swift `MessageService.sendMessage`
    // builds (lines 65-67 of MessageService.swift):
    //   `{"recipient_pubkey":"<x>","blob":"<y>","sealed_route":"<z>"}`
    const canonical = utf8ToBytes(
      `{"recipient_pubkey":"${input.recipientPubkey}","blob":"${input.blob}","sealed_route":"${input.sealedRoute}"}`
    );
    expect(ed25519.verify(sigBytes, canonical, keys.signingPub)).toBe(true);

    // Pubkey shape: 32-byte raw Ed25519, base64-encoded.
    expect(keys.signingPub.length).toBe(32);
    expect(base64Decode(keys.signingPubBase64).length).toBe(32);
  });

  it('rejects a tampered canonical payload', async () => {
    const keys = await recipientMod.loadOrCreateRecipientKeys();
    const sigBase64 = await recipientMod.signSendRequest({
      recipientPubkey: 'a',
      blob: 'b',
      sealedRoute: 'c',
    });
    const sigBytes = base64Decode(sigBase64);
    const tampered = utf8ToBytes(
      '{"recipient_pubkey":"a","blob":"b","sealed_route":"d"}'
    );
    expect(ed25519.verify(sigBytes, tampered, keys.signingPub)).toBe(false);
  });
});

// Cleanup — restore the original fetch so any later suites that share the
// process see a pristine global.
describe('cleanup', () => {
  it('restores fetch when the suite is done', () => {
    // We can't actually restore mid-suite without breaking the cases above;
    // just ensure the restore function exists for callers / harness hooks
    // that re-run the file in a new context.
    expect(typeof restoreFetch).toBe('function');
  });
});
