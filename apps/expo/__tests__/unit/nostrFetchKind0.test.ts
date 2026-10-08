/**
 * fetchKind0FromRelays / makeKind0Fetcher — 04-plan Phase A4 task A4.4.
 *
 * TS module under test: apps/expo/src/nostr/fetchKind0.ts
 *
 * What this suite pins:
 *   1. Resolves the newest kind-0 across relays (by `created_at`), JSON
 *      parsing its content, in the exact `{contentJson, created_at}` shape
 *      `verifyNostrBinding` (`@solidarity/shared`) expects as its
 *      `NostrKind0Fetcher` return value.
 *   2. `null` when no relay answers before EOSE (never fabricates a kind-0
 *      event) — this is what makes the badge verifier resolve `stale`
 *      instead of a guessed verdict.
 *   3. `makeKind0Fetcher(relays)` curries the relay list into the
 *      `(pubkeyHex) => Promise<...>` shape `verifyNostrBinding`'s second
 *      argument requires.
 *   4. Never opens a real WebSocket — every relay interaction goes through
 *      the injected `subscribeEventsFn` DI seam (same fake-relay pattern as
 *      `nostrPublish.test.ts`).
 */
import { describe, expect, it } from 'bun:test';

import type { NostrEvent, NostrFilter, SubscriptionHandle } from '@/dag/nostrAdapter';
import { fetchKind0FromRelays, makeKind0Fetcher } from '@/nostr/fetchKind0';

type SubscribeEventsFn = (
  relayUrl: string,
  filter: NostrFilter,
  onEvent: (event: NostrEvent) => void,
  onEose?: () => void,
  onError?: (message: string) => void
) => SubscriptionHandle;

function fakeEvent(pubkey: string, content: unknown, created_at: number): NostrEvent {
  return {
    id: `id-${String(created_at)}`,
    pubkey,
    created_at,
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
    sig: 'sig',
  };
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

const PUBKEY = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';

describe('fetchKind0FromRelays', () => {
  it('resolves null (no relay answered) — never fabricates a kind-0', async () => {
    const { fn } = makeFakeSubscribe({});
    const r = await fetchKind0FromRelays(PUBKEY, ['a', 'b'], { subscribeEventsFn: fn, timeoutMs: 50 });
    expect(r).toBeNull();
  });

  it('resolves null for an empty relay list', async () => {
    const { fn, calls } = makeFakeSubscribe({});
    const r = await fetchKind0FromRelays(PUBKEY, [], { subscribeEventsFn: fn });
    expect(r).toBeNull();
    expect(calls).toEqual([]);
  });

  it('parses the JSON content into `contentJson` and passes `created_at` through', async () => {
    const event = fakeEvent(PUBKEY, { name: 'alice', alsoKnownAs: ['did:key:zAbc'] }, 1_751_500_000);
    const { fn } = makeFakeSubscribe({ a: [event] });
    const r = await fetchKind0FromRelays(PUBKEY, ['a'], { subscribeEventsFn: fn });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.created_at).toBe(1_751_500_000);
    expect(r.contentJson).toEqual({ name: 'alice', alsoKnownAs: ['did:key:zAbc'] });
  });

  it('picks the newest event across relays by created_at', async () => {
    const older = fakeEvent(PUBKEY, { name: 'old' }, 100);
    const newer = fakeEvent(PUBKEY, { name: 'new' }, 200);
    const { fn, calls } = makeFakeSubscribe({ a: [older], b: [newer] });
    const r = await fetchKind0FromRelays(PUBKEY, ['a', 'b'], { subscribeEventsFn: fn });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.contentJson).toEqual({ name: 'new' });
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('rejects an event whose kind does not match the requested filter', async () => {
    const wrongKind = { ...fakeEvent(PUBKEY, { name: 'forged' }, 300), kind: 1 };
    const { fn } = makeFakeSubscribe({ a: [wrongKind] });

    const r = await fetchKind0FromRelays(PUBKEY, ['a'], { subscribeEventsFn: fn });

    expect(r).toBeNull();
  });

  it('rejects an event whose author does not match the requested filter', async () => {
    const wrongAuthor = fakeEvent('f'.repeat(64), { name: 'forged' }, 300);
    const { fn } = makeFakeSubscribe({ a: [wrongAuthor] });

    const r = await fetchKind0FromRelays(PUBKEY, ['a'], { subscribeEventsFn: fn });

    expect(r).toBeNull();
  });

  it('malformed JSON content resolves an empty-object contentJson, not a thrown error', async () => {
    const malformed: NostrEvent = { ...fakeEvent(PUBKEY, {}, 300), content: 'not json{' };
    const { fn } = makeFakeSubscribe({ a: [malformed] });
    const r = await fetchKind0FromRelays(PUBKEY, ['a'], { subscribeEventsFn: fn });
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.contentJson).toEqual({});
  });
});

describe('makeKind0Fetcher', () => {
  it('curries the relay list into a `(pubkeyHex) => Promise<...>` NostrKind0Fetcher', async () => {
    const event = fakeEvent(PUBKEY, { alsoKnownAs: ['did:key:zXyz'] }, 500);
    const { fn, calls } = makeFakeSubscribe({ a: [event], b: [event] });
    const fetcher = makeKind0Fetcher(['a', 'b'], { subscribeEventsFn: fn });

    const r = await fetcher(PUBKEY);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.created_at).toBe(500);
    expect(calls.sort()).toEqual(['a', 'b']);
  });

  it('a different curried relay list queries different relays', async () => {
    const { fn, calls } = makeFakeSubscribe({});
    const fetcher = makeKind0Fetcher(['only-this-one'], { subscribeEventsFn: fn, timeoutMs: 50 });
    await fetcher(PUBKEY);
    expect(calls).toEqual(['only-this-one']);
  });
});
