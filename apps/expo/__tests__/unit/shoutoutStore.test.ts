/**
 * Shoutout store — local Sakura inbox + outbox.
 *
 * Mirrors apps/expo/src/shoutouts/store.ts (in-memory + encrypted MMKV blobs).
 * Swift reference: solidarity/Services/Sharing/MessageService.swift +
 * solidarity/Views/ShoutoutViews/CreateShoutoutView.swift (UI 200-byte cap).
 *
 * Tests cover:
 *   - add() (the wire for both "send outgoing" and "receive incoming" — they
 *     share the same add() path with different `direction`)
 *   - remove() drops the item from memory + MMKV
 *   - hydrate() rehydrates from MMKV ordered newest-first
 *   - SHOUTOUT_MAX_PAYLOAD_BYTES parity with Swift's `.prefix(200)` cap
 *   - per-counterpart filter (UI-level — store keeps full list, callers filter)
 *
 * We stub `@/storage/mmkv` + `@/storage/encryptionManager` so the store talks
 * to an in-memory KV map; the encryption layer is exercised by the dedicated
 * vault/encryption tests.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type {
  Shoutout,
  useShoutoutStore as UseShoutoutStore,
} from '../../src/shoutouts/store';

interface ShoutoutModule {
  readonly SHOUTOUT_MAX_PAYLOAD_BYTES: number;
  readonly useShoutoutStore: typeof UseShoutoutStore;
}

const kv = new Map<string, string>();

function resetKv(): void {
  kv.clear();
}

let mod: ShoutoutModule;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (k: string): string | undefined => kv.get(k),
      set: (k: string, v: string): void => {
        kv.set(k, v);
      },
      remove: (k: string): void => {
        kv.delete(k);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
    }),
    initMmkv: async () => undefined,
  }));
  await mock.module('@/storage/encryptionManager', () => ({
    // Bypass crypto — store the JSON directly. Encryption parity lives in
    // the encryption.parity.test + vaultEncryption.test files.
    encryptJson: async (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64'),
    decryptJson: async <T,>(s: string): Promise<T> => {
      const raw = s.startsWith('{') ? s : Buffer.from(s, 'base64').toString('utf8');
      return JSON.parse(raw) as T;
    },
  }));
  const imported = (await import('../../src/shoutouts/store')) as unknown as ShoutoutModule;
  mod = imported;
});

beforeEach(() => {
  resetKv();
  // Reset store between tests so add/remove/hydrate stay deterministic.
  // `items` is derived from `details` post-manifest-refactor — must clear
  // both, plus the manifest mirror, or earlier-test residue keeps leaking
  // into the derived array.
  mod.useShoutoutStore.setState({
    items: [],
    hydrated: false,
    details: new Map(),
    detailsHydrated: false,
    manifest: [],
  });
});

const out: Shoutout = {
  id: 'out-1',
  direction: 'outgoing',
  counterpartName: 'Bob',
  subject: 'hi',
  body: 'see you tonight',
  createdAt: new Date('2025-05-20T12:00:00Z'),
};

const inc: Shoutout = {
  id: 'in-1',
  direction: 'incoming',
  counterpartName: 'Alice',
  subject: 'sakura',
  body: 'arrived safely',
  createdAt: new Date('2025-05-21T08:00:00Z'),
};

describe('SHOUTOUT_MAX_PAYLOAD_BYTES', () => {
  it('matches Swift CreateShoutoutView.swift (.prefix(200)) ', () => {
    expect(mod.SHOUTOUT_MAX_PAYLOAD_BYTES).toBe(200);
  });
});

describe('useShoutoutStore.add', () => {
  it('add() inserts an outgoing message at the head', async () => {
    await mod.useShoutoutStore.getState().add(out);
    const items = mod.useShoutoutStore.getState().items;
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe('out-1');
    expect(items[0]?.direction).toBe('outgoing');
    expect(items[0]?.counterpartName).toBe('Bob');
  });

  it('add() persists to MMKV under the shoutout: prefix', async () => {
    await mod.useShoutoutStore.getState().add(out);
    expect(kv.has('shoutout:out-1')).toBe(true);
  });

  it('add() inserts an incoming message (from sakura inbox openInboxMessage path)', async () => {
    await mod.useShoutoutStore.getState().add(inc);
    const items = mod.useShoutoutStore.getState().items;
    expect(items[0]?.direction).toBe('incoming');
    expect(items[0]?.counterpartName).toBe('Alice');
  });

  it('add() with the same id replaces the existing item (no duplicates)', async () => {
    await mod.useShoutoutStore.getState().add(out);
    const updated: Shoutout = { ...out, body: 'edited' };
    await mod.useShoutoutStore.getState().add(updated);
    const items = mod.useShoutoutStore.getState().items;
    expect(items.length).toBe(1);
    expect(items[0]?.body).toBe('edited');
  });
});

describe('useShoutoutStore.remove', () => {
  it('removes the item from memory + MMKV', async () => {
    await mod.useShoutoutStore.getState().add(out);
    await mod.useShoutoutStore.getState().remove('out-1');
    expect(mod.useShoutoutStore.getState().items.length).toBe(0);
    expect(kv.has('shoutout:out-1')).toBe(false);
  });

  it('remove() on missing id is a no-op (does not throw)', async () => {
    await expect(mod.useShoutoutStore.getState().remove('does-not-exist')).resolves.toBeUndefined();
  });
});

describe('useShoutoutStore.hydrate', () => {
  it('loads previously-persisted items, sorted newest first (Date revived from JSON)', async () => {
    // Seed via add() so the values are JSON-stringified into KV the same
    // way encryptJson would. Reset the in-memory store to force hydrate()
    // to actually walk the KV (instead of short-circuiting on hydrated).
    await mod.useShoutoutStore.getState().add(out);
    await mod.useShoutoutStore.getState().add(inc);
    mod.useShoutoutStore.setState({
      items: [],
      hydrated: false,
      details: new Map(),
      detailsHydrated: false,
    });
    await mod.useShoutoutStore.getState().hydrate();
    const items = mod.useShoutoutStore.getState().items;
    expect(items.length).toBe(2);
    // inc is newer (2025-05-21 > 2025-05-20); sort puts newer first.
    expect(items[0]?.id).toBe('in-1');
    expect(items[1]?.id).toBe('out-1');
    // The createdAt MUST be a Date instance — Swift Codable rehydrates Date.
    expect(items[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('only loads keys with the shoutout: prefix (ignores other namespaces)', async () => {
    await mod.useShoutoutStore.getState().add(out);
    kv.set('vault:item-x', JSON.stringify({ id: 'item-x' }));
    kv.set('group:g1', JSON.stringify({ id: 'g1' }));
    mod.useShoutoutStore.setState({
      items: [],
      hydrated: false,
      details: new Map(),
      detailsHydrated: false,
    });
    await mod.useShoutoutStore.getState().hydrate();
    const items = mod.useShoutoutStore.getState().items;
    expect(items.length).toBe(1);
    expect(items[0]?.id).toBe('out-1');
  });

  it('is idempotent: a second hydrate() call is a no-op', async () => {
    mod.useShoutoutStore.setState({
      items: [],
      hydrated: true,
      details: new Map(),
      detailsHydrated: true,
    });
    // hydrated=true short-circuits — even if we seed kv now, hydrate skips.
    kv.set('shoutout:in-1', JSON.stringify(inc));
    await mod.useShoutoutStore.getState().hydrate();
    expect(mod.useShoutoutStore.getState().items.length).toBe(0);
  });
});

describe('counterpart filter (caller-side)', () => {
  it('callers can filter the items list by counterpartName', async () => {
    await mod.useShoutoutStore.getState().add(out);
    await mod.useShoutoutStore.getState().add(inc);
    const items = mod.useShoutoutStore.getState().items;
    const bobOnly = items.filter((m) => m.counterpartName === 'Bob');
    expect(bobOnly.length).toBe(1);
    expect(bobOnly[0]?.id).toBe('out-1');
    const aliceOnly = items.filter((m) => m.counterpartName === 'Alice');
    expect(aliceOnly[0]?.id).toBe('in-1');
  });

  it('returns empty list for an unknown counterpart', async () => {
    await mod.useShoutoutStore.getState().add(out);
    const items = mod.useShoutoutStore.getState().items;
    expect(items.filter((m) => m.counterpartName === 'Mallory').length).toBe(0);
  });
});
