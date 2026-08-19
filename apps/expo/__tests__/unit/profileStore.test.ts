/**
 * Profile store — local Profile Record persistence + append-only save flow
 * (1.3.3 Task A2.2, apps/expo/src/profile/store.ts) + Nostr publish wiring
 * (1.3.3 Task A4.2's `publishToNostr`).
 *
 * What this suite pins:
 *   1. `saveProfile` constructs a record that `verifyCompact` accepts as
 *      signed by the active root did — the actual conformance contract.
 *   2. Invalid fields (bad link URL) return `err(...)` BEFORE
 *      `getRootSigner()` is ever called — no Face ID prompt on a doomed
 *      save — and nothing is written to MMKV.
 *   3. No provisioned root key → `err(...)`, no Face ID prompt either.
 *   4. `updatedAt` is strictly monotonic across successive saves, and each
 *      save replaces the stored record wholesale (a fresh object, never a
 *      mutation of the previous one) — the append-only contract.
 *   5. Fields not exposed by the editor (`avatar`/`alsoKnownAs`/`badges`/
 *      `supersededBy`) carry forward as real empties, never fabricated.
 *   6. `hydrateProfile()` round-trips a save through the MMKV mock after an
 *      in-memory reset (simulated app restart), and fails closed to
 *      `'empty'` on missing/corrupt persisted data.
 *   7. `publishToNostr`: guards (empty relays / no profile / no Nostr key)
 *      return `err(...)` before touching signing or any relay; the happy
 *      path adds `nostr:npub…` to `alsoKnownAs`, RE-SIGNS the profile
 *      (verifiable by `verifyCompact`), persists it, THEN calls the
 *      injected `publishProfile`/`updateKind0AlsoKnownAs` fakes (task
 *      A4.2's own DI seam — never a real relay); re-running once the
 *      claim already exists skips the re-sign (jws unchanged) but still
 *      republishes.
 *
 * Isolation: mocks ONLY `@/storage/mmkv` (this store's own persistence
 * layer — same pattern as `groupStore.test.ts`) and drives the REAL
 * root-key signing path through `rootKey.ts`'s own DI seams
 * (`__setRootKeyStorageForTesting` / `__setRootKeyBiometricGateForTesting`),
 * the REAL Nostr-key path through `userKey.ts`'s own DI seams
 * (`__setNostrKeyStorageForTesting` / `__setNostrMnemonicRevealerForTesting`),
 * and fakes ONLY the relay-facing functions via `store.ts`'s own
 * `__setNostrPublishForTesting` seam — never `mock.module('@/identity', ...)`
 * or `mock.module('@/nostr/publish', ...)` — see `rootKey.test.ts`'s
 * isolation note and `store.ts`'s own seam doc for why a global
 * `mock.module` on a specifier another file imports for real is avoided.
 */
import { beforeAll, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';

import { decodeFragment, parseProfile, verifyCompact, type ProfileRecord } from '@solidarity/shared';

import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';
import { buildProfileShareModel } from '../../src/components/me/meProfileModel';

interface PublishReportShape {
  readonly event: { readonly kind: number; readonly content: string };
  readonly results: readonly unknown[];
  readonly acceptedCount: number;
  readonly requiredCount: number;
  readonly success: boolean;
}

type NostrRes<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

type LinkVisibilityShape = 'public' | 'link-only' | 'private';

interface ProfileFieldsShape {
  readonly displayName: string;
  readonly bio: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
  readonly linkVisibility?: readonly LinkVisibilityShape[];
}

interface SignedProjectionShape {
  readonly record: ProfileRecord;
  readonly jws: string;
}

type SaveResult =
  | {
      readonly ok: true;
      readonly value: { readonly record: ProfileRecord; readonly jws: string };
    }
  | { readonly ok: false; readonly error: string };

interface ProfileModuleSurface {
  readonly useProfileStore: {
    getState: () => {
      readonly record: ProfileRecord | null;
      readonly jws: string | null;
      readonly status: 'empty' | 'ready';
      readonly linkVisibility: readonly LinkVisibilityShape[];
      readonly shared: SignedProjectionShape | null;
      readonly published: SignedProjectionShape | null;
      readonly nostrPublishedJws: string | null;
      readonly saveProfile: (
        fields: ProfileFieldsShape,
        options?: {
          readonly alsoKnownAs?: readonly string[];
          readonly avatar?: string | null;
          readonly badges?: ProfileRecord['badges'];
          readonly page?: ProfileRecord['page'];
        }
      ) => Promise<SaveResult>;
      readonly publishToNostr: (
        confirmedRelays: readonly string[]
      ) => Promise<
        | { readonly ok: true; readonly value: { readonly profile: PublishReportShape; readonly kind0: PublishReportShape } }
        | { readonly ok: false; readonly error: string }
      >;
      readonly resetForLocalWipe: () => void;
    };
    setState: (
      s: Partial<{
        record: ProfileRecord | null;
        jws: string | null;
        status: 'empty' | 'ready';
        nostrPublishedJws: string | null;
      }>
    ) => void;
  };
  readonly hydrateProfile: () => void;
  readonly __setNostrPublishForTesting: (
    overrides: {
      readonly publishProfile?: (opts: {
        readonly jws: string;
        readonly relays: readonly string[];
      }) => Promise<NostrRes<PublishReportShape>>;
      readonly updateKind0AlsoKnownAs?: (opts: {
        readonly did: string;
        readonly relays: readonly string[];
      }) => Promise<NostrRes<PublishReportShape>>;
    } | null
  ) => void;
}

interface RootKeyModuleSurface {
  readonly __setRootKeyStorageForTesting: (storage: unknown) => void;
  readonly __setRootKeyBiometricGateForTesting: (gate: unknown) => void;
  readonly createFromFreshMnemonic: () => Promise<
    | { readonly ok: true; readonly value: { readonly mnemonic: string; readonly did: string } }
    | { readonly ok: false; readonly error: { readonly kind: string } }
  >;
  readonly deleteRootKey: () => Promise<void>;
}

interface NostrUserKeyModuleSurface {
  readonly __setNostrKeyStorageForTesting: (storage: unknown) => void;
  readonly __setNostrMnemonicRevealerForTesting: (
    revealer: (() => Promise<NostrRes<string>>) | null
  ) => void;
  readonly provisionFromRootMnemonic: () => Promise<NostrRes<string>>;
  readonly npubEncode: (pubkey: string) => NostrRes<string>;
  readonly deleteNostrKey: () => Promise<void>;
}

const kv = new Map<string, string>();
const secureStore = new Map<string, string>();
const nostrScalarStore = new Map<string, string>();
let failProfileWrites = false;
let nextBiometricSuccess = true;
const biometricCalls: string[] = [];
// A fixed, independently-valid BIP-39 mnemonic (Trezor test-vector "abandon
// x11 about") used ONLY to provision the Nostr key in these tests — does
// NOT need to match whatever mnemonic `rootKeyMod.createFromFreshMnemonic()`
// generates for the root did; `userKey.ts`'s revealer seam is independent.
const NOSTR_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

let mod: ProfileModuleSurface;
let rootKeyMod: RootKeyModuleSurface;
let nostrUserKeyMod: NostrUserKeyModuleSurface;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (k: string): string | undefined => kv.get(k),
      set: (k: string, v: string): void => {
        if (failProfileWrites) throw new Error('disk full');
        kv.set(k, v);
      },
      remove: (k: string): void => {
        kv.delete(k);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
    }),
    initMmkv: async (): Promise<undefined> => undefined,
  }));

  rootKeyMod = (await import('../../src/identity/rootKey')) as unknown as RootKeyModuleSurface;
  rootKeyMod.__setRootKeyStorageForTesting({
    getMnemonic: (): Promise<string | null> => Promise.resolve(secureStore.get('mnemonic') ?? null),
    setMnemonic: (mnemonic: string): Promise<void> => {
      secureStore.set('mnemonic', mnemonic);
      return Promise.resolve();
    },
    deleteMnemonic: (): Promise<void> => {
      secureStore.delete('mnemonic');
      return Promise.resolve();
    },
  });
  rootKeyMod.__setRootKeyBiometricGateForTesting((reason: 'sign' | 'export'): Promise<boolean> => {
    biometricCalls.push(reason);
    return Promise.resolve(nextBiometricSuccess);
  });

  nostrUserKeyMod = (await import('../../src/nostr/userKey')) as unknown as NostrUserKeyModuleSurface;
  nostrUserKeyMod.__setNostrKeyStorageForTesting({
    getScalarHex: (): Promise<string | null> => Promise.resolve(nostrScalarStore.get('scalar') ?? null),
    setScalarHex: (hex: string): Promise<void> => {
      nostrScalarStore.set('scalar', hex);
      return Promise.resolve();
    },
    deleteScalarHex: (): Promise<void> => {
      nostrScalarStore.delete('scalar');
      return Promise.resolve();
    },
  });
  nostrUserKeyMod.__setNostrMnemonicRevealerForTesting(() =>
    Promise.resolve({ ok: true, value: NOSTR_TEST_MNEMONIC })
  );

  mod = (await import('../../src/profile/store')) as unknown as ProfileModuleSurface;
});

beforeEach(async () => {
  __resetLocalDataWipeBarrierForTesting();
  kv.clear();
  failProfileWrites = false;
  secureStore.clear();
  nostrScalarStore.clear();
  nextBiometricSuccess = true;
  biometricCalls.length = 0;
  mod.useProfileStore.setState({
    record: null,
    jws: null,
    status: 'empty',
    nostrPublishedJws: null,
  });
  await rootKeyMod.deleteRootKey();
  await nostrUserKeyMod.deleteNostrKey();
  mod.__setNostrPublishForTesting(null);
});

describe('saveProfile — signed, verifiable record', () => {
  it('rejects a new save while the production local-data wipe is quiescing writers', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    beginLocalDataWipe();

    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('profile save cancelled by local wipe');
    expect(biometricCalls).toEqual([]);
    expect(kv.has('profile:v1')).toBe(false);
    expect(mod.useProfileStore.getState().record).toBeNull();
  });

  it('constructs a valid signed record verifiable by verifyCompact, and persists it to MMKV', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: 'hello world',
      links: [{ label: 'Site', url: 'https://alice.example' }],
    });
    expect(result.ok).toBe(true);

    const state = mod.useProfileStore.getState();
    expect(state.status).toBe('ready');
    expect(state.record).not.toBeNull();
    expect(state.jws).not.toBeNull();
    if (!state.record || !state.jws) return;
    expect(state.record.v).toBe(1);
    expect(state.record.did).toBe(created.value.did);
    expect(state.record.displayName).toBe('Alice');
    expect(state.record.links).toEqual([{ label: 'Site', url: 'https://alice.example' }]);

    const verified = verifyCompact(state.jws, created.value.did);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value).toEqual(state.record);

    const raw = kv.get('profile:v1');
    expect(raw).toBeDefined();
    if (!raw) return;
    const persisted = JSON.parse(raw) as { record: ProfileRecord; jws: string };
    expect(persisted.record.displayName).toBe('Alice');
    expect(persisted.jws).toBe(state.jws);
  });

  it('fails the save instead of reporting an unpublished Page/Profile as durable when MMKV rejects the write', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    failProfileWrites = true;

    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: [],
    });

    expect(result).toEqual({ ok: false, error: 'profile save failed: local storage could not be updated' });
    expect(mod.useProfileStore.getState().status).toBe('empty');
    expect(kv.has('profile:v1')).toBe(false);
  });

  it('invalid fields (non-http link URL) return err before signing — no Face ID prompt, nothing persisted', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Bob',
      bio: '',
      links: [{ label: 'Bad', url: 'javascript:alert(1)' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('links');
    expect(biometricCalls).toEqual([]);
    expect(mod.useProfileStore.getState().status).toBe('empty');
    expect(kv.has('profile:v1')).toBe(false);
  });

  it('returns err without a provisioned root key, and never prompts Face ID', async () => {
    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Nobody',
      bio: '',
      links: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('root identity');
    expect(biometricCalls).toEqual([]);
    expect(kv.has('profile:v1')).toBe(false);
  });

  it('propagates a Face ID denial as err(...) without corrupting stored state', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    nextBiometricSuccess = false;
    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Denied',
      bio: '',
      links: [],
    });
    expect(result.ok).toBe(false);
    expect(mod.useProfileStore.getState().status).toBe('empty');
    expect(kv.has('profile:v1')).toBe(false);
  });
});

describe('saveProfile — append-only replacement semantics', () => {
  it('applies an avatar override before signing and carries it forward on later saves', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await mod.useProfileStore
      .getState()
      .saveProfile(
        { displayName: 'Alice', bio: '', links: [] },
        { avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/example@jpeg' }
      );

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.record.avatar).toBe(
      'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/example@jpeg'
    );
    expect(verifyCompact(first.value.jws, created.value.did)).toEqual({
      ok: true,
      value: first.value.record,
    });

    const second = await mod.useProfileStore
      .getState()
      .saveProfile({ displayName: 'Alice Updated', bio: '', links: [] });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.record.avatar).toBe(first.value.record.avatar);

    const removed = await mod.useProfileStore
      .getState()
      .saveProfile(
        { displayName: 'Alice Updated', bio: '', links: [] },
        { avatar: null }
      );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.record.avatar).toBeNull();
  });

  it('applies an alsoKnownAs override before signing and returns that exact signed snapshot', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await mod.useProfileStore
      .getState()
      .saveProfile(
        { displayName: 'Alice', bio: '', links: [] },
        { alsoKnownAs: ['nostr:npub1alice', 'at://alice.example.social'] }
      );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.record.alsoKnownAs).toEqual([
      'nostr:npub1alice',
      'at://alice.example.social',
    ]);
    const stored = mod.useProfileStore.getState();
    expect(stored.record).not.toBeNull();
    expect(stored.jws).not.toBeNull();
    if (!stored.record || !stored.jws) return;
    expect(result.value).toEqual({ record: stored.record, jws: stored.jws });
    const verified = verifyCompact(result.value.jws, created.value.did);
    expect(verified).toEqual({ ok: true, value: result.value.record });
  });

  it('updatedAt is strictly monotonic across successive saves', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await mod.useProfileStore.getState().saveProfile({ displayName: 'One', bio: '', links: [] });
    expect(first.ok).toBe(true);
    const firstRecord = mod.useProfileStore.getState().record;

    const second = await mod.useProfileStore.getState().saveProfile({ displayName: 'Two', bio: '', links: [] });
    expect(second.ok).toBe(true);
    const secondRecord = mod.useProfileStore.getState().record;

    expect(firstRecord).not.toBeNull();
    expect(secondRecord).not.toBeNull();
    if (!firstRecord || !secondRecord) return;

    expect(secondRecord).not.toBe(firstRecord); // fresh object — never mutated in place
    expect(secondRecord.displayName).toBe('Two');
    expect(secondRecord.did).toBe(firstRecord.did);
    expect(Date.parse(secondRecord.updatedAt)).toBeGreaterThan(Date.parse(firstRecord.updatedAt));
  });

  it('updatedAt still strictly advances when the system clock skews backward between saves', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    try {
      setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const first = await mod.useProfileStore.getState().saveProfile({ displayName: 'One', bio: '', links: [] });
      expect(first.ok).toBe(true);
      const firstRecord = mod.useProfileStore.getState().record;
      expect(firstRecord).not.toBeNull();
      if (!firstRecord) return;
      const previousMs = Date.parse(firstRecord.updatedAt);

      // Backward clock skew (e.g. an NTP correction) before the next save —
      // Date.now() at save #2 is at or before the first record's updatedAt.
      setSystemTime(new Date('2025-12-31T23:59:00.000Z'));
      const second = await mod.useProfileStore.getState().saveProfile({ displayName: 'Two', bio: '', links: [] });
      expect(second.ok).toBe(true);
      const secondRecord = mod.useProfileStore.getState().record;
      expect(secondRecord).not.toBeNull();
      if (!secondRecord) return;

      const nextMs = Date.parse(secondRecord.updatedAt);
      expect(nextMs).toBeGreaterThan(previousMs);
      expect(nextMs).toBe(previousMs + 1);
    } finally {
      setSystemTime(); // restore the real clock for subsequent tests
    }
  });

  it('carries forward avatar/alsoKnownAs/badges/supersededBy as real empties across saves (never fabricated)', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'A', bio: '', links: [] });
    const r1 = mod.useProfileStore.getState().record;
    await mod.useProfileStore.getState().saveProfile({ displayName: 'B', bio: '', links: [] });
    const r2 = mod.useProfileStore.getState().record;

    expect(r1?.avatar).toBeNull();
    expect(r2?.avatar).toBeNull();
    expect(r2?.alsoKnownAs).toEqual([]);
    expect(r2?.badges).toEqual([]);
    expect(r2?.supersededBy).toBeNull();
  });

  it('root-signs an explicit badge update into full, shared, and public projections', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: [],
    });
    const badge = {
      type: 'solidarity.publicDisclosure.v1',
      subject: 'age_over_18',
      attestation:
        'nostr:30078:abababababababababababababababababababababababababababababababab:solidarity.disclosure.public.v1:0198a6e4-0c3d-7a21-9657-54a6b6b20275',
    };

    const updated = await mod.useProfileStore.getState().saveProfile(
      { displayName: 'Alice', bio: '', links: [] },
      { badges: [badge] }
    );

    expect(updated.ok).toBe(true);
    const state = mod.useProfileStore.getState();
    expect(state.record?.badges).toEqual([badge]);
    expect(state.shared?.record.badges).toEqual([badge]);
    expect(state.published?.record.badges).toEqual([badge]);
    expect(verifyCompact(state.published!.jws, created.value.did).ok).toBe(true);
  });

  it('root-signs a public Page layout into full, shared, and public projections', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const page: NonNullable<ProfileRecord['page']> = {
      blocks: [
        {
          id: 'links',
          type: 'links',
          title: 'Links',
          items: [],
          style: 'list',
          visible: true,
          order: 0,
        },
        {
          id: 'portfolio-1',
          type: 'portfolio',
          title: 'Selected work',
          items: [{ id: 'work-1', title: 'Cover', url: 'https://example.com/cover' }],
          style: 'grid',
          visible: true,
          order: 1,
        },
      ],
      appearance: {
        template: 'mint',
        font: 'serif',
        background: 'mint',
        customBackground: null,
        showBrand: true,
        footerText: '',
      },
    };

    const saved = await mod.useProfileStore.getState().saveProfile(
      { displayName: 'Alice', bio: '', links: [] },
      { page }
    );

    expect(saved.ok).toBe(true);
    const state = mod.useProfileStore.getState();
    expect(state.record?.page).toEqual(page);
    expect(state.shared?.record.page).toEqual(page);
    expect(state.published?.record.page).toEqual(page);
    expect(verifyCompact(state.shared!.jws, created.value.did).ok).toBe(true);

    const carried = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice updated',
      bio: '',
      links: [],
    });
    expect(carried.ok).toBe(true);
    expect(mod.useProfileStore.getState().record?.page).toEqual(page);
  });
});

describe('hydrateProfile — MMKV round-trip', () => {
  it('restores record/jws/status after an in-memory reset (simulated app restart)', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Carol', bio: 'hi', links: [] });
    const saved = mod.useProfileStore.getState();

    mod.useProfileStore.setState({ record: null, jws: null, status: 'empty' });
    expect(mod.useProfileStore.getState().status).toBe('empty');

    mod.hydrateProfile();
    const restored = mod.useProfileStore.getState();
    expect(restored.status).toBe('ready');
    expect(restored.record).toEqual(saved.record);
    expect(restored.jws).toBe(saved.jws);
  });

  it('leaves status empty when nothing has ever been saved', () => {
    mod.hydrateProfile();
    expect(mod.useProfileStore.getState().status).toBe('empty');
  });

  it('does not revive a persisted profile while a local wipe is active', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Carol', bio: 'hi', links: [] });
    mod.useProfileStore.setState({ record: null, jws: null, status: 'empty' });

    beginLocalDataWipe();
    mod.hydrateProfile();

    expect(mod.useProfileStore.getState().status).toBe('empty');
    expect(mod.useProfileStore.getState().record).toBeNull();
  });

  it('fails closed to empty on a corrupt persisted blob', () => {
    kv.set('profile:v1', '{not json');
    mod.hydrateProfile();
    expect(mod.useProfileStore.getState().status).toBe('empty');
  });

  it('fails closed to empty when the persisted record fails schema validation', () => {
    kv.set('profile:v1', JSON.stringify({ record: { v: 1, did: 'did:key:zBad' }, jws: 'a.b.c' }));
    mod.hydrateProfile();
    expect(mod.useProfileStore.getState().status).toBe('empty');
  });
});

// ── publishToNostr (task A4.2) ──────────────────────────────────────────

function fakeReport(kind: number, content: string): PublishReportShape {
  return {
    event: { kind, content },
    results: [
      { relay: 'a', accepted: true, message: 'ok', elapsedMs: 1 },
      { relay: 'b', accepted: true, message: 'ok', elapsedMs: 1 },
    ],
    acceptedCount: 2,
    requiredCount: 2,
    success: true,
  };
}

describe('publishToNostr', () => {
  it('rejects an empty relay list before touching anything', async () => {
    const r = await mod.useProfileStore.getState().publishToNostr([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('relays list is empty');
    expect(biometricCalls).toEqual([]);
  });

  it('returns err when no profile has been saved yet', async () => {
    const r = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('no profile has been saved');
    expect(biometricCalls).toEqual([]);
  });

  it('returns err when no Nostr key is provisioned — no biometric prompt, no MMKV mutation, no relay calls', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Alice', bio: '', links: [] });
    biometricCalls.length = 0;
    const jwsBefore = mod.useProfileStore.getState().jws;

    let publishProfileCalls = 0;
    mod.__setNostrPublishForTesting({
      publishProfile: () => {
        publishProfileCalls++;
        return Promise.resolve({ ok: true, value: fakeReport(30078, 'x') });
      },
    });

    const r = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('no Nostr key is provisioned');
    expect(biometricCalls).toEqual([]);
    expect(publishProfileCalls).toBe(0);
    expect(mod.useProfileStore.getState().jws).toBe(jwsBefore);
  });

  it('adds nostr:npub… to alsoKnownAs, re-signs (verifiable), persists, then publishes both directions', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Alice', bio: '', links: [] });
    const beforeRecord = mod.useProfileStore.getState().record;
    expect(beforeRecord?.alsoKnownAs).toEqual([]);

    const provisioned = await nostrUserKeyMod.provisionFromRootMnemonic();
    expect(provisioned.ok).toBe(true);

    const profileCalls: { readonly jws: string; readonly relays: readonly string[] }[] = [];
    const kind0Calls: { readonly did: string; readonly relays: readonly string[] }[] = [];
    mod.__setNostrPublishForTesting({
      publishProfile: (opts) => {
        profileCalls.push({ jws: opts.jws, relays: opts.relays });
        return Promise.resolve({ ok: true, value: fakeReport(30078, opts.jws) });
      },
      updateKind0AlsoKnownAs: (opts) => {
        kind0Calls.push({ did: opts.did, relays: opts.relays });
        return Promise.resolve({ ok: true, value: fakeReport(0, JSON.stringify({ alsoKnownAs: [opts.did] })) });
      },
    });

    const relays = ['wss://relay-one', 'wss://relay-two'];
    const r = await mod.useProfileStore.getState().publishToNostr(relays);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.profile.event.kind).toBe(30078);
    expect(r.value.kind0.event.kind).toBe(0);

    const state = mod.useProfileStore.getState();
    expect(state.record).not.toBeNull();
    expect(state.jws).not.toBeNull();
    if (!state.record || !state.jws) return;

    // alsoKnownAs now carries exactly one nostr:npub… entry.
    expect(state.record.alsoKnownAs).toHaveLength(1);
    expect(state.record.alsoKnownAs[0]).toMatch(/^nostr:npub1/);

    // Re-signed record verifies under the same did.
    const verified = verifyCompact(state.jws, state.record.did);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value).toEqual(state.record);

    // Persisted to MMKV wholesale (same append-only contract as saveProfile).
    const raw = kv.get('profile:v1');
    expect(raw).toBeDefined();
    if (raw) {
      const persisted = JSON.parse(raw) as { jws: string };
      expect(persisted.jws).toBe(state.jws);
    }

    // Both directions were published with the caller-confirmed relays.
    expect(profileCalls).toHaveLength(1);
    expect(profileCalls[0]?.relays).toEqual(relays);
    // T7: the PUBLIC projection (scope:'public') is published — NEVER the full
    // record's jws. With no non-public links here the two differ only by the
    // `scope` stamp, so the published jws is distinct from `state.jws`.
    expect(profileCalls[0]?.jws).not.toBe(state.jws);
    const publishedVerified = verifyCompact(profileCalls[0]!.jws, state.record.did);
    expect(publishedVerified.ok).toBe(true);
    if (publishedVerified.ok) {
      const publishedRecord = publishedVerified.value as ProfileRecord;
      expect(publishedRecord.scope).toBe('public');
      // The npub binding is identity-level, so it is carried into the public
      // projection too (only LINKS are filtered by visibility).
      expect(publishedRecord.alsoKnownAs).toEqual(state.record.alsoKnownAs);
    }
    // The published jws is exactly the store's cached public projection.
    expect(profileCalls[0]?.jws).toBe(state.published?.jws);
    expect(state.published).not.toBeNull();
    expect(state.nostrPublishedJws).toBe(state.published!.jws);
    expect(kind0Calls).toHaveLength(1);
    expect(kind0Calls[0]?.relays).toEqual(relays);
    expect(kind0Calls[0]?.did).toBe(state.record.did);
  });

  it('invalidates the published-version marker as soon as a newer profile is saved', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: [],
    });
    await nostrUserKeyMod.provisionFromRootMnemonic();
    mod.__setNostrPublishForTesting({
      publishProfile: (opts) =>
        Promise.resolve({ ok: true, value: fakeReport(30078, opts.jws) }),
      updateKind0AlsoKnownAs: (opts) =>
        Promise.resolve({
          ok: true,
          value: fakeReport(0, JSON.stringify({ alsoKnownAs: [opts.did] })),
        }),
    });

    const published = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(published.ok).toBe(true);
    expect(mod.useProfileStore.getState().nostrPublishedJws).not.toBeNull();

    const edited = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice edited',
      bio: '',
      links: [],
    });
    expect(edited.ok).toBe(true);
    expect(mod.useProfileStore.getState().nostrPublishedJws).toBeNull();
  });

  it('skips the re-sign on a second call once the nostr:npub… claim already exists, but still republishes', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Alice', bio: '', links: [] });
    await nostrUserKeyMod.provisionFromRootMnemonic();

    let profileCalls = 0;
    let kind0Calls = 0;
    mod.__setNostrPublishForTesting({
      publishProfile: (opts) => {
        profileCalls++;
        return Promise.resolve({ ok: true, value: fakeReport(30078, opts.jws) });
      },
      updateKind0AlsoKnownAs: (opts) => {
        kind0Calls++;
        return Promise.resolve({ ok: true, value: fakeReport(0, JSON.stringify({ alsoKnownAs: [opts.did] })) });
      },
    });

    const first = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(first.ok).toBe(true);
    const jwsAfterFirst = mod.useProfileStore.getState().jws;
    biometricCalls.length = 0;

    const second = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(second.ok).toBe(true);
    expect(mod.useProfileStore.getState().jws).toBe(jwsAfterFirst); // no re-sign -> jws unchanged
    expect(biometricCalls).toEqual([]); // no Face ID prompt on the second call
    expect(profileCalls).toBe(2); // still republishes both directions
    expect(kind0Calls).toBe(2);
  });

  it('publishes a claim included in saveProfile without a publish-time biometric re-sign', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    const provisioned = await nostrUserKeyMod.provisionFromRootMnemonic();
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;
    const npub = nostrUserKeyMod.npubEncode(provisioned.value);
    expect(npub.ok).toBe(true);
    if (!npub.ok) return;

    const claim = `nostr:${npub.value}`;
    const saved = await mod.useProfileStore.getState().saveProfile(
      { displayName: 'Alice', bio: '', links: [] },
      { alsoKnownAs: [claim] }
    );
    expect(saved.ok).toBe(true);
    const jwsBeforePublish = mod.useProfileStore.getState().jws;
    biometricCalls.length = 0;

    let profileCalls = 0;
    let kind0Calls = 0;
    mod.__setNostrPublishForTesting({
      publishProfile: (opts) => {
        profileCalls += 1;
        return Promise.resolve({ ok: true, value: fakeReport(30078, opts.jws) });
      },
      updateKind0AlsoKnownAs: (opts) => {
        kind0Calls += 1;
        return Promise.resolve({
          ok: true,
          value: fakeReport(0, JSON.stringify({ alsoKnownAs: [opts.did] })),
        });
      },
    });

    const published = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(published.ok).toBe(true);
    expect(biometricCalls).toEqual([]);
    expect(mod.useProfileStore.getState().jws).toBe(jwsBeforePublish);
    expect(mod.useProfileStore.getState().record?.alsoKnownAs).toContain(claim);
    expect(profileCalls).toBe(1);
    expect(kind0Calls).toBe(1);
  });

  it('propagates a publishProfile failure without calling updateKind0AlsoKnownAs', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Alice', bio: '', links: [] });
    await nostrUserKeyMod.provisionFromRootMnemonic();

    let kind0Calls = 0;
    mod.__setNostrPublishForTesting({
      publishProfile: () => Promise.resolve({ ok: false, error: 'publishProfile: only 1/3 relays accepted' }),
      updateKind0AlsoKnownAs: () => {
        kind0Calls++;
        return Promise.resolve({ ok: true, value: fakeReport(0, '{}') });
      },
    });

    const r = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('publishProfile');
    expect(kind0Calls).toBe(0);
  });

  it('propagates an updateKind0AlsoKnownAs failure', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Alice', bio: '', links: [] });
    await nostrUserKeyMod.provisionFromRootMnemonic();

    mod.__setNostrPublishForTesting({
      publishProfile: (opts) => Promise.resolve({ ok: true, value: fakeReport(30078, opts.jws) }),
      updateKind0AlsoKnownAs: () => Promise.resolve({ ok: false, error: 'updateKind0AlsoKnownAs: relay timeout' }),
    });

    const r = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('updateKind0AlsoKnownAs');
  });

  it('drops a relay completion that arrives after the profile was locally wiped', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    const provisioned = await nostrUserKeyMod.provisionFromRootMnemonic();
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;
    const npub = nostrUserKeyMod.npubEncode(provisioned.value);
    expect(npub.ok).toBe(true);
    if (!npub.ok) return;
    await mod.useProfileStore.getState().saveProfile(
      { displayName: 'Alice', bio: '', links: [] },
      { alsoKnownAs: [`nostr:${npub.value}`] },
    );

    let releasePublish!: (result: NostrRes<PublishReportShape>) => void;
    const publishResponse = new Promise<NostrRes<PublishReportShape>>(
      (resolve) => {
        releasePublish = resolve;
      },
    );
    let publishStarted!: () => void;
    const didStart = new Promise<void>((resolve) => {
      publishStarted = resolve;
    });
    let kind0Calls = 0;
    mod.__setNostrPublishForTesting({
      publishProfile: () => {
        publishStarted();
        return publishResponse;
      },
      updateKind0AlsoKnownAs: () => {
        kind0Calls += 1;
        return Promise.resolve({ ok: true, value: fakeReport(0, '{}') });
      },
    });

    const publishing = mod.useProfileStore
      .getState()
      .publishToNostr(['wss://a']);
    await didStart;
    mod.useProfileStore.getState().resetForLocalWipe();
    kv.clear();
    releasePublish({ ok: true, value: fakeReport(30078, 'old-profile') });

    const result = await publishing;
    expect(result.ok).toBe(false);
    expect(kind0Calls).toBe(0);
    expect(kv.has('profile:v1')).toBe(false);
    expect(mod.useProfileStore.getState().record).toBeNull();
  });
});

// ── T7: three-tier link visibility → public / shared / full projections ─────

describe('saveProfile — three-tier link projections', () => {
  const LINKS = [
    { label: 'Site', url: 'https://public.example' },
    { label: 'Draft', url: 'https://linkonly.example' },
    { label: 'Secret', url: 'https://private.example' },
  ];

  it('signs full (all links), shared (public+link-only), and public (public-only) projections', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const saved = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: LINKS,
      linkVisibility: ['public', 'link-only', 'private'],
    });
    expect(saved.ok).toBe(true);

    const state = mod.useProfileStore.getState();
    // Full record: source of truth, ALL links, scope absent (= full).
    expect(state.record?.links.map((l) => l.url)).toEqual([
      'https://public.example',
      'https://linkonly.example',
      'https://private.example',
    ]);
    expect(state.record?.scope).toBeUndefined();
    // Visibility is LOCAL only — never in the signed wire record's links.
    expect(state.linkVisibility).toEqual(['public', 'link-only', 'private']);

    // Shared projection: public + link-only, scope:'shared', verifiable.
    expect(state.shared?.record.scope).toBe('shared');
    expect(state.shared?.record.links.map((l) => l.url)).toEqual([
      'https://public.example',
      'https://linkonly.example',
    ]);
    const sharedVerified = verifyCompact(state.shared!.jws, created.value.did);
    expect(sharedVerified.ok).toBe(true);
    if (sharedVerified.ok) expect(sharedVerified.value).toEqual(state.shared!.record);

    // Public projection: public only, scope:'public', verifiable.
    expect(state.published?.record.scope).toBe('public');
    expect(state.published?.record.links.map((l) => l.url)).toEqual(['https://public.example']);
    const publicVerified = verifyCompact(state.published!.jws, created.value.did);
    expect(publicVerified.ok).toBe(true);
  });

  it('uses a fragment-free short name while preserving the broader shared QR projection as offline backup', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const saved = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: LINKS,
      linkVisibility: ['public', 'link-only', 'private'],
    });
    expect(saved.ok).toBe(true);

    const state = mod.useProfileStore.getState();
    expect(state.shared).not.toBeNull();
    expect(state.published).not.toBeNull();
    if (!state.shared || !state.published) return;

    const model = buildProfileShareModel(
      state.shared.record,
      state.shared.jws,
      'alice',
      { record: state.published.record, jws: state.published.jws },
    );
    expect(model.usernameUrl).not.toBeNull();
    if (!model.usernameUrl) return;

    expect(model.usernameUrl).toBe('https://app.solidarity.gg/@alice');
    expect(new URL(model.usernameUrl).hash).toBe('');

    const sharedFragment = decodeFragment(new URL(model.offlineUrl).hash.slice(1));
    expect(sharedFragment.ok).toBe(true);
    if (!sharedFragment.ok) return;
    const sharedVerified = verifyCompact(sharedFragment.value, created.value.did);
    expect(sharedVerified.ok).toBe(true);
    if (!sharedVerified.ok) return;
    const sharedParsed = parseProfile(sharedVerified.value);
    expect(sharedParsed.ok).toBe(true);
    if (!sharedParsed.ok) return;
    expect(sharedParsed.value.scope).toBe('shared');
    expect(sharedParsed.value.links.map((link) => link.url)).toEqual([
      'https://public.example',
      'https://linkonly.example',
    ]);
  });

  it('publishes the PUBLIC projection to Nostr — a private/link-only link never reaches a relay', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: LINKS,
      linkVisibility: ['public', 'link-only', 'private'],
    });
    await nostrUserKeyMod.provisionFromRootMnemonic();

    const profileCalls: string[] = [];
    mod.__setNostrPublishForTesting({
      publishProfile: (opts) => {
        profileCalls.push(opts.jws);
        return Promise.resolve({ ok: true, value: fakeReport(30078, opts.jws) });
      },
      updateKind0AlsoKnownAs: (opts) =>
        Promise.resolve({ ok: true, value: fakeReport(0, JSON.stringify({ alsoKnownAs: [opts.did] })) }),
    });

    const did = mod.useProfileStore.getState().record!.did;
    const r = await mod.useProfileStore.getState().publishToNostr(['wss://a']);
    expect(r.ok).toBe(true);

    expect(profileCalls).toHaveLength(1);
    const publishedVerified = verifyCompact(profileCalls[0]!, did);
    expect(publishedVerified.ok).toBe(true);
    if (publishedVerified.ok) {
      const publishedRecord = publishedVerified.value as ProfileRecord;
      expect(publishedRecord.scope).toBe('public');
      // Only the public-tier link — the link-only and private ones are gone.
      expect(publishedRecord.links.map((l) => l.url)).toEqual(['https://public.example']);
    }
  });

  it('defaults every link to public when no visibility is supplied (back-compat)', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: '',
      links: [{ label: 'Site', url: 'https://public.example' }],
    });
    const state = mod.useProfileStore.getState();
    expect(state.linkVisibility).toEqual(['public']);
    // Every projection keeps the (public) link.
    expect(state.shared?.record.links).toHaveLength(1);
    expect(state.published?.record.links).toHaveLength(1);
  });
});
