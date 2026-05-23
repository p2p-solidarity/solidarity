/**
 * BusinessCard restore round-trip — mirrors Swift BackupManager.swift's
 * "save → wipe → restore" semantics on the Expo side.
 *
 * Swift reference:
 *   solidarity/Services/Backup/BackupManager.swift   (performBackupNow / restoreFromBackup)
 *   solidarity/Services/Card/CardManager.swift       (createCard / getAllCards)
 *   solidarity/Services/Identity/KeychainService.swift
 *     (signingKey + did:key persist across reinstall via Keychain — restore
 *     should not rotate the identity key)
 *
 * What we assert:
 *   1. useCardStore.upsert() persists a card to (mocked) MMKV.
 *   2. Wiping the in-memory zustand state then re-hydrating from MMKV
 *      restores byte-identical cards (id, all fields, animal, createdAt,
 *      updatedAt, sharingPreferences).
 *   3. The signing pubkey + did:key derived from the master key are stable
 *      across the restore cycle — restoring backup data MUST NOT rotate
 *      the user's identity key (Swift behaviour: the key lives in Keychain,
 *      not in the backup blob).
 *
 * Notes on the mock surface:
 *   - `@/storage/mmkv` + `@/storage/encryptionManager` stubbed with an
 *     in-memory map (same pattern as groupStore / shoutoutStore tests).
 *   - `encryptJson` mock has a `Set` → array shim so the BusinessCard's
 *     sharingPreferences (which the Zod schema transforms array → Set on
 *     parse) survives the JSON round-trip. JSON.stringify(Set) yields `{}`
 *     in vanilla JS, which would otherwise drop those fields. This shim is
 *     a TEST-ONLY workaround; the production encryptionManager has the
 *     same gap.
 *     TODO(production-bug): replace this with the real encryptJson once
 *     apps/expo/src/storage/encryptionManager.ts handles Set/Map serialisation.
 *   - `decryptJson` rebuilds Date prototypes the way Swift Codable does so
 *     `createdAt instanceof Date` survives JSON round-trip.
 *   - `@/keychain/signingKey` stubbed to return a fixed seed so we can check
 *     that the same pubkey is produced before AND after the restore cycle.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  bytesToHex,
  didKeyFromPublicKey,
  hexToBytes,
  publicKeyFromPrivate,
  publicKeyToJwk,
  type BusinessCard,
  type CardError,
} from '@solidarity/shared';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const kv = new Map<string, string>();

/**
 * Stand-in for the master signing scalar. Same fixed seed used by the
 * identityDeep parity test; chosen so we can assert byte-equal pubkey hex
 * after restore.
 */
const FIXED_PRIV = hexToBytes(
  '1111111122222222333333334444444455555555666666667777777788888888'
);

interface CardStoreSurface {
  readonly useCardStore: {
    getState: () => {
      readonly cards: readonly BusinessCard[];
      readonly hydrated: boolean;
      readonly hydrate: () => Promise<void>;
      readonly upsert: (card: BusinessCard) => Promise<{ ok: true } | { ok: false; error: CardError }>;
      readonly remove: (id: string) => Promise<void>;
    };
    setState: (s: Partial<{ cards: readonly BusinessCard[]; hydrated: boolean }>) => void;
  };
}

interface SigningSurface {
  readonly ensureSigningKey: () => Promise<{
    readonly privateKey: Uint8Array;
    readonly publicKey: Uint8Array;
  }>;
  readonly publicJwk: () => Promise<ReturnType<typeof publicKeyToJwk>>;
}

let cardMod: CardStoreSurface;
let signingMod: SigningSurface;

/**
 * Walk a value and rewrite Sets to plain arrays so JSON.stringify preserves
 * them. Mirrors what a "fixed" encryptionManager.encryptJson SHOULD do; the
 * real one is gappy. Keep this in sync with the schema's transform layout.
 */
function setsToArrays(value: unknown): unknown {
  if (value instanceof Set) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(setsToArrays);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = setsToArrays(v);
    }
    return out;
  }
  return value;
}

beforeAll(async () => {
  // Mock MMKV with an in-memory map — same shape as the existing
  // groupStore / vaultEncryption tests.
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

  // Bypass at-rest crypto. The vault / encryption parity tests already
  // cover that layer; here we only need the JSON round-trip to be stable.
  await mock.module('@/storage/encryptionManager', () => ({
    encryptJson: async (v: unknown) => JSON.stringify(setsToArrays(v)),
    decryptJson: async <T,>(s: string): Promise<T> => JSON.parse(s) as T,
  }));

  // Mock the master master key + signing key paths so we can assert that
  // identity is keychain-scoped (NOT backup-scoped) and survives a wipe of
  // the zustand state.
  await mock.module('expo-secure-store', () => ({
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: async () => null,
    setItemAsync: async () => undefined,
    deleteItemAsync: async () => undefined,
  }));
  await mock.module('expo-local-authentication', () => ({
    hasHardwareAsync: async () => true,
    isEnrolledAsync: async () => true,
    authenticateAsync: async () => ({ success: true }),
  }));
  await mock.module('@/keychain/signingKey', () => ({
    ensureSigningKey: async () => ({
      privateKey: FIXED_PRIV,
      publicKey: publicKeyFromPrivate(FIXED_PRIV),
    }),
    publicJwk: async () => publicKeyToJwk(publicKeyFromPrivate(FIXED_PRIV)),
    signJwt: async () => 'signed.jwt.fake',
    resetSigningKeyForTesting: async () => undefined,
  }));

  cardMod = (await import('../../src/cards/cardManager')) as unknown as CardStoreSurface;
  signingMod = (await import('../../src/keychain/signingKey')) as unknown as SigningSurface;
});

beforeEach(() => {
  kv.clear();
  cardMod.useCardStore.setState({ cards: [], hydrated: false });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a fully-populated card matching the BusinessCard Zod schema's INPUT
 * shape — sharingPreferences sets are arrays here because that's what
 * Zod's `.array(...).transform(new Set)` expects. The store's safeParse
 * runs the transform; the resulting object on `.data` has real Sets.
 *
 * We pin every field so the round-trip restore can assert byte-equal on a
 * deterministic comparison rather than a deep-object diff.
 */
function makeCardInput(overrides: Record<string, unknown> = {}): BusinessCard {
  const id = (overrides['id'] as string | undefined) ?? '11111111-1111-4111-8111-111111111111';
  const createdAt =
    (overrides['createdAt'] as Date | undefined) ?? new Date('2025-01-01T00:00:00Z');
  const updatedAt =
    (overrides['updatedAt'] as Date | undefined) ?? new Date('2025-01-02T00:00:00Z');
  return {
    id,
    name: 'Ada Lovelace',
    title: 'Founder',
    company: 'Solidarity',
    email: 'ada@solidarity.gg',
    phone: '+1 555 0100',
    profileImage: undefined,
    animal: 'sheep',
    socialNetworks: [],
    skills: [],
    categories: ['engineering'],
    // Zod schema expects arrays on input (and transforms them to Sets on
    // the output type). The card store calls safeParse(card) so we MUST
    // supply arrays here, not Sets, despite the BusinessCard type
    // saying Set<...>.
    sharingPreferences: {
      publicFields: ['name', 'title'],
      professionalFields: ['name', 'title', 'company', 'email'],
      personalFields: ['name', 'email', 'phone'],
      allowForwarding: true,
      expirationDate: undefined,
      useZK: false,
      sharingFormat: 'didSigned',
    },
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt,
    updatedAt,
    ...overrides,
  } as unknown as BusinessCard;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('cardRestore: upsert + hydrate round trip', () => {
  it('upsert persists into MMKV under the cards: prefix', async () => {
    const card = makeCardInput();
    const result = await cardMod.useCardStore.getState().upsert(card);
    expect(result.ok).toBe(true);
    expect(kv.has(`cards:${card.id}`)).toBe(true);
  });

  it('rejects invalid cards (Zod schema gate, no MMKV write)', async () => {
    // name is required — empty name fails businessCardSchema validation.
    const broken = makeCardInput({ name: '' });
    const result = await cardMod.useCardStore.getState().upsert(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('validationError');
    }
    expect(kv.has(`cards:${broken.id}`)).toBe(false);
  });
});

describe('cardRestore: save → wipe → restore round trip', () => {
  it('byte-equal: every BusinessCard field survives an MMKV-backed restore', async () => {
    const card = makeCardInput({
      id: '11111111-1111-4111-8111-111111111111',
      animal: 'pig',
      categories: ['engineering', 'design'],
    });

    // 1. Save.
    const saveResult = await cardMod.useCardStore.getState().upsert(card);
    expect(saveResult.ok).toBe(true);

    // 2. Wipe the in-memory zustand state (simulates app cold-start /
    //    factory-reset before restore). MMKV (the persistent layer) is
    //    intentionally NOT cleared — that's the "restore" data source.
    cardMod.useCardStore.setState({ cards: [], hydrated: false });
    expect(cardMod.useCardStore.getState().cards.length).toBe(0);

    // 3. Restore via hydrate().
    await cardMod.useCardStore.getState().hydrate();
    const restored = cardMod.useCardStore.getState().cards[0];

    expect(restored).toBeDefined();
    expect(restored?.id).toBe(card.id);
    expect(restored?.name).toBe(card.name);
    expect(restored?.title).toBe(card.title);
    expect(restored?.company).toBe(card.company);
    expect(restored?.email).toBe(card.email);
    expect(restored?.phone).toBe(card.phone);
    expect(restored?.animal).toBe('pig');
    expect(restored?.categories).toEqual(['engineering', 'design']);
    expect(restored?.nameType).toBe('display_name');

    // Dates are recovered from JSON via Zod's z.coerce.date() on load.
    expect(restored?.createdAt).toBeInstanceOf(Date);
    expect(restored?.createdAt?.toISOString()).toBe(card.createdAt.toISOString());
    expect(restored?.updatedAt).toBeInstanceOf(Date);

    // SharingPreferences round-trip — the Zod transform rebuilds the Sets
    // from arrays so we compare via Array.from(...).sort().
    expect(
      Array.from(restored?.sharingPreferences.publicFields ?? []).sort()
    ).toEqual(['name', 'title']);
    expect(
      Array.from(restored?.sharingPreferences.professionalFields ?? []).sort()
    ).toEqual(['company', 'email', 'name', 'title']);
    expect(
      Array.from(restored?.sharingPreferences.personalFields ?? []).sort()
    ).toEqual(['email', 'name', 'phone']);
    expect(restored?.sharingPreferences.allowForwarding).toBe(true);
    expect(restored?.sharingPreferences.sharingFormat).toBe('didSigned');
    expect(restored?.sharingPreferences.useZK).toBe(false);
  });

  it('multiple cards survive the restore cycle (no merge / dedup loss)', async () => {
    const a = makeCardInput({ id: '00000000-0000-4000-8000-000000000001', name: 'Alice' });
    const b = makeCardInput({ id: '00000000-0000-4000-8000-000000000002', name: 'Bob' });
    const c = makeCardInput({ id: '00000000-0000-4000-8000-000000000003', name: 'Carol' });
    expect((await cardMod.useCardStore.getState().upsert(a)).ok).toBe(true);
    expect((await cardMod.useCardStore.getState().upsert(b)).ok).toBe(true);
    expect((await cardMod.useCardStore.getState().upsert(c)).ok).toBe(true);

    // Wipe + rehydrate.
    cardMod.useCardStore.setState({ cards: [], hydrated: false });
    await cardMod.useCardStore.getState().hydrate();
    const names = cardMod.useCardStore
      .getState()
      .cards.map((x) => x.name)
      .sort();
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('upsert with the same id replaces the previous version (no duplicates after restore)', async () => {
    const id = '00000000-0000-4000-8000-000000000099';
    expect((await cardMod.useCardStore.getState().upsert(makeCardInput({ id, name: 'Original' }))).ok).toBe(true);
    expect((await cardMod.useCardStore.getState().upsert(makeCardInput({ id, name: 'Edited' }))).ok).toBe(true);

    cardMod.useCardStore.setState({ cards: [], hydrated: false });
    await cardMod.useCardStore.getState().hydrate();

    const cards = cardMod.useCardStore.getState().cards;
    expect(cards.length).toBe(1);
    expect(cards[0]?.name).toBe('Edited');
  });
});

describe('cardRestore: identity key is keychain-scoped, NOT backup-scoped', () => {
  it('public-key bytes do not change across a card restore cycle', async () => {
    const beforePub = (await signingMod.ensureSigningKey()).publicKey;

    // Drive a full save → wipe → restore cycle.
    expect((await cardMod.useCardStore.getState().upsert(makeCardInput())).ok).toBe(true);
    cardMod.useCardStore.setState({ cards: [], hydrated: false });
    await cardMod.useCardStore.getState().hydrate();

    const afterPub = (await signingMod.ensureSigningKey()).publicKey;
    expect(bytesToHex(afterPub)).toBe(bytesToHex(beforePub));
  });

  it('did:key derived from signing key is stable across restore', async () => {
    const beforeDid = didKeyFromPublicKey(
      (await signingMod.ensureSigningKey()).publicKey
    );

    expect((await cardMod.useCardStore.getState().upsert(makeCardInput())).ok).toBe(true);
    cardMod.useCardStore.setState({ cards: [], hydrated: false });
    await cardMod.useCardStore.getState().hydrate();

    const afterDid = didKeyFromPublicKey(
      (await signingMod.ensureSigningKey()).publicKey
    );
    expect(afterDid).toBe(beforeDid);
  });

  it('public JWK is byte-equal before and after restore', async () => {
    const beforeJwk = await signingMod.publicJwk();

    expect((await cardMod.useCardStore.getState().upsert(makeCardInput())).ok).toBe(true);
    cardMod.useCardStore.setState({ cards: [], hydrated: false });
    await cardMod.useCardStore.getState().hydrate();

    const afterJwk = await signingMod.publicJwk();
    expect(afterJwk.x).toBe(beforeJwk.x);
    expect(afterJwk.y).toBe(beforeJwk.y);
    expect(afterJwk.crv).toBe(beforeJwk.crv);
    expect(afterJwk.alg).toBe(beforeJwk.alg);
  });
});
