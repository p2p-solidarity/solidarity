/**
 * Nostr profile publish (NIP-78 kind 30078) + kind-0 `alsoKnownAs`
 * did:key binding — 04-plan Phase A4 task A4.2.
 *
 * TS module under test: apps/expo/src/nostr/publish.ts
 *
 * What this suite pins:
 *   1. `publishProfile` builds a kind-30078 event (`d=solidarity.profile`,
 *      content = the caller's JWS verbatim), signs it via the REAL
 *      `userKey.ts` signing path (provisioned through userKey.ts's own DI
 *      seams, same as `nostrUserKey.test.ts`), and the result verifies
 *      under `dag/nostrAdapter.ts`'s `verifyNostrEvent`.
 *   2. Quorum: >=2 of 3 relays accepting -> `report.success === true`;
 *      only 1 of 3 accepting -> `report.success === false`, with the
 *      full per-relay report still returned (never collapsed to a bare
 *      error string).
 *   3. `updateKind0AlsoKnownAs` fetches the newest existing kind-0 across
 *      the given relays (per-relay races decided by `created_at`),
 *      PRESERVES every existing content field/entry, and adds the did
 *      into `content.alsoKnownAs` (deduped).
 *   4. Neither function ever opens a real WebSocket: every relay
 *      interaction goes through the `publishEventFn`/`subscribeEventsFn`
 *      DI seams with an in-memory fake relay.
 *
 * Isolation: uses ONLY `userKey.ts`'s own DI hooks
 * (`__setNostrKeyStorageForTesting` / `__setNostrMnemonicRevealerForTesting`)
 * — same pattern as `nostrUserKey.test.ts` — never `mock.module`.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import derivedVectors from '../../../../packages/shared/vectors/derive.json';
import { verifyNostrEvent, type NostrEvent, type NostrFilter, type SubscriptionHandle } from '@/dag/nostrAdapter';

type Res<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

interface RelayPublishResult {
  readonly relay: string;
  readonly accepted: boolean;
  readonly message: string;
  readonly elapsedMs: number;
}

interface PublishReport {
  readonly event: NostrEvent;
  readonly results: readonly RelayPublishResult[];
  readonly acceptedCount: number;
  readonly requiredCount: number;
  readonly success: boolean;
}

type PublishEventFn = (relayUrl: string, event: NostrEvent, timeoutMs?: number) => Promise<{
  readonly accepted: boolean;
  readonly message: string;
  readonly elapsedMs: number;
}>;

type SubscribeEventsFn = (
  relayUrl: string,
  filter: NostrFilter,
  onEvent: (event: NostrEvent) => void,
  onEose?: () => void,
  onError?: (message: string) => void
) => SubscriptionHandle;

interface PublishMod {
  readonly DEFAULT_RELAYS: readonly string[];
  readonly PROFILE_D_TAG: string;
  readonly KIND_PROFILE_POINTER: number;
  readonly KIND_METADATA: number;
  readonly publishProfile: (opts: {
    readonly jws: string;
    readonly relays: readonly string[];
    readonly timeoutMs?: number;
    readonly createdAt?: number;
    readonly publishEventFn?: PublishEventFn;
  }) => Promise<Res<PublishReport>>;
  readonly updateKind0AlsoKnownAs: (opts: {
    readonly did: string;
    readonly relays: readonly string[];
    readonly timeoutMs?: number;
    readonly fetchTimeoutMs?: number;
    readonly createdAt?: number;
    readonly publishEventFn?: PublishEventFn;
    readonly subscribeEventsFn?: SubscribeEventsFn;
  }) => Promise<Res<PublishReport>>;
}

interface UserKeyMod {
  readonly __setNostrKeyStorageForTesting: (storage: typeof fakeStorage | null) => void;
  readonly __setNostrMnemonicRevealerForTesting: (
    revealer: (() => Promise<Res<string>>) | null
  ) => void;
  readonly deleteNostrKey: () => Promise<void>;
  readonly provisionFromRootMnemonic: () => Promise<Res<string>>;
  readonly signNostrEvent: (unsigned: {
    readonly kind: number;
    readonly tags: readonly (readonly string[])[];
    readonly content: string;
    readonly created_at?: number;
  }) => Promise<Res<NostrEvent>>;
}

// ── In-memory Nostr key storage, provisioned via userKey.ts's own DI
//    (never `mock.module`) — see nostrUserKey.test.ts's isolation note. ──

const scalarStore = new Map<string, string>();

const fakeStorage = {
  getScalarHex: (): Promise<string | null> => Promise.resolve(scalarStore.get('scalar') ?? null),
  setScalarHex: (hex: string): Promise<void> => {
    scalarStore.set('scalar', hex);
    return Promise.resolve();
  },
  deleteScalarHex: (): Promise<void> => {
    scalarStore.delete('scalar');
    return Promise.resolve();
  },
};

const fakeRevealer = (): Promise<Res<string>> =>
  Promise.resolve({ ok: true, value: derivedVectors.valid[0]!.mnemonic });

let mod: PublishMod;
let userKeyMod: UserKeyMod;

beforeAll(async () => {
  const importedUserKey: unknown = await import('../../src/nostr/userKey');
  userKeyMod = importedUserKey as UserKeyMod;
  userKeyMod.__setNostrKeyStorageForTesting(fakeStorage);
  userKeyMod.__setNostrMnemonicRevealerForTesting(fakeRevealer);

  const importedPublish: unknown = await import('../../src/nostr/publish');
  mod = importedPublish as PublishMod;
});

beforeEach(async () => {
  scalarStore.clear();
  await userKeyMod.deleteNostrKey();
});

// ── Fake relay helpers — never touch a real WebSocket ──────────────────

function makeFakePublish(outcomes: Readonly<Record<string, boolean>>): {
  readonly fn: PublishEventFn;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fn: PublishEventFn = (relayUrl, _event, _timeoutMs) => {
    calls.push(relayUrl);
    const accepted = outcomes[relayUrl] ?? false;
    return Promise.resolve({
      accepted,
      message: accepted ? 'ok' : 'rejected: test',
      elapsedMs: 1,
    });
  };
  return { fn, calls };
}

function makeFakeSubscribe(eventsByRelay: Readonly<Record<string, readonly NostrEvent[]>>): {
  readonly fn: SubscribeEventsFn;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const fn: SubscribeEventsFn = (relayUrl, _filter, onEvent, onEose) => {
    calls.push(relayUrl);
    const events = eventsByRelay[relayUrl] ?? [];
    setTimeout(() => {
      for (const e of events) onEvent(e);
      onEose?.();
    }, 0);
    return { subscriptionId: `fake-${relayUrl}`, close: () => undefined };
  };
  return { fn, calls };
}

// ── 1. publishProfile ────────────────────────────────────────────────────

describe('publishProfile', () => {
  it('returns err before any relay call when no Nostr key is provisioned', async () => {
    const { fn, calls } = makeFakePublish({ a: true });
    const r = await mod.publishProfile({ jws: 'header.payload.sig', relays: ['a'], publishEventFn: fn });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('notProvisioned');
    expect(calls).toEqual([]);
  });

  it('rejects an empty relay list', async () => {
    const r = await mod.publishProfile({ jws: 'header.payload.sig', relays: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('relays list is empty');
  });

  it('builds a NIP-78 kind-30078 event carrying the JWS verbatim, and it verifies', async () => {
    await userKeyMod.provisionFromRootMnemonic();
    const { fn } = makeFakePublish({ a: true, b: true, c: true });
    const jws = 'eyHeader.eyPayload.sigValue';
    const r = await mod.publishProfile({
      jws,
      relays: ['a', 'b', 'c'],
      createdAt: 1_800_000_000,
      publishEventFn: fn,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { event } = r.value;
    expect(event.kind).toBe(mod.KIND_PROFILE_POINTER);
    expect(event.kind).toBe(30078);
    expect(event.tags).toEqual([['d', mod.PROFILE_D_TAG]]);
    expect(event.content).toBe(jws);
    expect(event.created_at).toBe(1_800_000_000);
    expect(verifyNostrEvent(event)).toBe(true);
  });

  it('2 of 3 relays accepting is a success, with the full per-relay report', async () => {
    await userKeyMod.provisionFromRootMnemonic();
    const { fn, calls } = makeFakePublish({ a: true, b: true, c: false });
    const r = await mod.publishProfile({ jws: 'j.w.s', relays: ['a', 'b', 'c'], publishEventFn: fn });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.success).toBe(true);
    expect(r.value.acceptedCount).toBe(2);
    expect(r.value.requiredCount).toBe(2);
    expect(r.value.results).toHaveLength(3);
    expect(r.value.results.find((x) => x.relay === 'c')?.accepted).toBe(false);
    expect(r.value.results.find((x) => x.relay === 'c')?.message).toBe('rejected: test');
    expect(calls.sort()).toEqual(['a', 'b', 'c']);
  });

  it('1 of 3 relays accepting is a failure, but still returns the full per-relay report', async () => {
    await userKeyMod.provisionFromRootMnemonic();
    const { fn } = makeFakePublish({ a: true, b: false, c: false });
    const r = await mod.publishProfile({ jws: 'j.w.s', relays: ['a', 'b', 'c'], publishEventFn: fn });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.success).toBe(false);
    expect(r.value.acceptedCount).toBe(1);
    expect(r.value.requiredCount).toBe(2);
    expect(r.value.results).toHaveLength(3);
  });
});

// ── 2. updateKind0AlsoKnownAs ────────────────────────────────────────────

describe('updateKind0AlsoKnownAs', () => {
  const DID = 'did:key:zDnaeuWWicWzERW6dWsH22yauktgJWq16TEV9dNtxAgaJ5X3Z';

  it('returns err before any relay call when no Nostr key is provisioned', async () => {
    const { fn: pubFn } = makeFakePublish({});
    const { fn: subFn, calls } = makeFakeSubscribe({});
    const r = await mod.updateKind0AlsoKnownAs({
      did: DID,
      relays: ['a'],
      publishEventFn: pubFn,
      subscribeEventsFn: subFn,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('notProvisioned');
    expect(calls).toEqual([]);
  });

  it('rejects an empty relay list', async () => {
    const r = await mod.updateKind0AlsoKnownAs({ did: DID, relays: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('relays list is empty');
  });

  it('with no existing kind-0 on any relay, publishes a fresh {alsoKnownAs: [did]}', async () => {
    await userKeyMod.provisionFromRootMnemonic();

    const { fn: subFn } = makeFakeSubscribe({}); // no events anywhere -> immediate EOSE
    const { fn: pubFn } = makeFakePublish({ a: true, b: true, c: true });

    const r = await mod.updateKind0AlsoKnownAs({
      did: DID,
      relays: ['a', 'b', 'c'],
      subscribeEventsFn: subFn,
      publishEventFn: pubFn,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.success).toBe(true);
    const content = JSON.parse(r.value.event.content) as { alsoKnownAs: string[] };
    expect(content.alsoKnownAs).toEqual([DID]);
    expect(r.value.event.kind).toBe(mod.KIND_METADATA);
    expect(r.value.event.kind).toBe(0);
    expect(verifyNostrEvent(r.value.event)).toBe(true);
  });

  it('preserves existing kind-0 fields (name/about) and existing alsoKnownAs entries, adding the did', async () => {
    const provisioned = await userKeyMod.provisionFromRootMnemonic();
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;

    // A prior kind-0 already exists on relay "a", with an unrelated
    // alsoKnownAs entry and normal profile fields.
    const priorContentSigned = await userKeyMod.signNostrEvent({
      kind: 0,
      tags: [],
      content: JSON.stringify({ name: 'Alice', about: 'hi', alsoKnownAs: ['at://alice.bsky.social'] }),
      created_at: 1_000,
    });
    expect(priorContentSigned.ok).toBe(true);
    if (!priorContentSigned.ok) return;

    const { fn: subFn, calls: subCalls } = makeFakeSubscribe({ a: [priorContentSigned.value] });
    const { fn: pubFn } = makeFakePublish({ a: true, b: true, c: true });

    const r = await mod.updateKind0AlsoKnownAs({
      did: DID,
      relays: ['a', 'b', 'c'],
      subscribeEventsFn: subFn,
      publishEventFn: pubFn,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(subCalls.sort()).toEqual(['a', 'b', 'c']);

    const content = JSON.parse(r.value.event.content) as {
      name: string;
      about: string;
      alsoKnownAs: string[];
    };
    expect(content.name).toBe('Alice');
    expect(content.about).toBe('hi');
    expect(content.alsoKnownAs.sort()).toEqual(['at://alice.bsky.social', DID].sort());
  });

  it('picks the newest kind-0 across relays by created_at', async () => {
    await userKeyMod.provisionFromRootMnemonic();

    const older = await userKeyMod.signNostrEvent({ kind: 0, tags: [], content: JSON.stringify({ name: 'Old' }), created_at: 100 });
    const newer = await userKeyMod.signNostrEvent({ kind: 0, tags: [], content: JSON.stringify({ name: 'New' }), created_at: 200 });
    expect(older.ok && newer.ok).toBe(true);
    if (!older.ok || !newer.ok) return;

    const { fn: subFn } = makeFakeSubscribe({ a: [older.value], b: [newer.value] });
    const { fn: pubFn } = makeFakePublish({ a: true, b: true });

    const r = await mod.updateKind0AlsoKnownAs({
      did: DID,
      relays: ['a', 'b'],
      subscribeEventsFn: subFn,
      publishEventFn: pubFn,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const content = JSON.parse(r.value.event.content) as { name: string; alsoKnownAs: string[] };
    expect(content.name).toBe('New');
    expect(content.alsoKnownAs).toEqual([DID]);
  });

  it('is idempotent — re-running with an already-bound did does not duplicate the entry', async () => {
    await userKeyMod.provisionFromRootMnemonic();

    const already = await userKeyMod.signNostrEvent({
      kind: 0,
      tags: [],
      content: JSON.stringify({ alsoKnownAs: [DID] }),
      created_at: 100,
    });
    expect(already.ok).toBe(true);
    if (!already.ok) return;

    const { fn: subFn } = makeFakeSubscribe({ a: [already.value] });
    const { fn: pubFn } = makeFakePublish({ a: true, b: true, c: true });

    const r = await mod.updateKind0AlsoKnownAs({
      did: DID,
      relays: ['a', 'b', 'c'],
      subscribeEventsFn: subFn,
      publishEventFn: pubFn,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const content = JSON.parse(r.value.event.content) as { alsoKnownAs: string[] };
    expect(content.alsoKnownAs).toEqual([DID]);
  });
});

// ── 3. DEFAULT_RELAYS — exposed, never used implicitly ──────────────────

describe('DEFAULT_RELAYS', () => {
  it('is a non-empty constant of wss:// relay URLs', () => {
    expect(mod.DEFAULT_RELAYS.length).toBeGreaterThanOrEqual(3);
    for (const r of mod.DEFAULT_RELAYS) {
      expect(r.startsWith('wss://')).toBe(true);
    }
  });

  it('publishProfile never publishes to DEFAULT_RELAYS unless the caller passes them explicitly', async () => {
    await userKeyMod.provisionFromRootMnemonic();
    const { fn, calls } = makeFakePublish({ 'wss://only-this-one': true });
    const r = await mod.publishProfile({ jws: 'j.w.s', relays: ['wss://only-this-one'], publishEventFn: fn });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['wss://only-this-one']);
    for (const defaultRelay of mod.DEFAULT_RELAYS) {
      expect(calls).not.toContain(defaultRelay);
    }
  });
});
