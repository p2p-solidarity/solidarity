/**
 * Vault shard distribution + recovery rail — end-to-end.
 *
 * Swift reference:
 *   solidarity/Services/Vault/ShardDistributionService.swift
 *   solidarity/Services/Vault/ShardDistributionService+Recovery.swift
 *   solidarity/Services/Vault/WrappedShardEnvelope.swift
 *   solidarity/Services/Vault/InactivityMonitorService.swift
 *   solidarity/Services/Vault/VaultCloudSyncService.swift
 *   solidarity/Models/Vault/TimeLockConfig.swift
 *
 * TS port under test:
 *   apps/expo/src/vault/secretsKeychain.ts
 *   apps/expo/src/vault/shardEnvelope.ts
 *   apps/expo/src/vault/shardDistribution.ts
 *   apps/expo/src/vault/recovery.ts
 *   apps/expo/src/vault/timeLock.ts
 *   apps/expo/src/vault/inactivityMonitor.ts
 *   apps/expo/src/vault/cloudSync.ts
 *
 * What this suite covers (each block ≤ a few it()'s):
 *   1. wrapShard / unwrapShard byte-binding semantics.
 *   2. distributeRecoveryShards full split→wrap→send round trip with
 *      the sakura sendMessage path mocked.
 *   3. recovery threshold semantics — k-1 stays pending, k reconstructs.
 *   4. timeLock isUnlocked + nextUnlockAt.
 *   5. inactivityMonitor triggers the configured `onLock` after the
 *      idle window (simulated timer + mocked AppState).
 *   6. cloudSync builds + merges manifests, last-write-wins.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  bytesToHex,
  combine,
  hexToBytes,
  split,
} from '@solidarity/shared';

import type * as ShardEnvelopeNS from '../../src/vault/shardEnvelope';
import type * as ShardDistNS from '../../src/vault/shardDistribution';
import type * as RecoveryNS from '../../src/vault/recovery';
import type * as TimeLockNS from '../../src/vault/timeLock';
import type * as InactivityNS from '../../src/vault/inactivityMonitor';
import type * as CloudSyncNS from '../../src/vault/cloudSync';

// We can't import the vault modules eagerly at top level: the in-memory
// mocks below must register BEFORE Bun resolves the imports. So we keep
// the imports lazy and stash them after the void mock.module() calls run.

interface SecretsKeychainMod {
  readonly getOrCreateRootSecret: (
    mode?: 'biometric' | 'silent'
  ) => Promise<
    | { readonly kind: 'ok'; readonly bytes: Uint8Array }
    | { readonly kind: 'err'; readonly reason: 'biometricDenied' | 'storageFailed' }
  >;
  readonly evictCachedRootSecret: () => void;
  readonly resetRootSecretForTesting: () => Promise<void>;
}

type ShardEnvelopeMod = typeof ShardEnvelopeNS;
type ShardDistMod = typeof ShardDistNS;
type RecoveryMod = typeof RecoveryNS;
type TimeLockMod = typeof TimeLockNS;
type InactivityMod = typeof InactivityNS;
type CloudSyncMod = typeof CloudSyncNS;

// ── Globals — captured across tests ─────────────────────────────────────────

const FIXED_ROOT_SECRET = new Uint8Array(32).fill(0x55);
const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xbc);

const kv = new Map<string, string>();
const secureStore = new Map<string, string>();
const sentRequests: { recipientPubKey: string; blob: string }[] = [];
let nextBiometricResult = true;

interface CloudKitRecord {
  readonly recordId: string;
  readonly recordType: string;
  fields: string;
  readonly modifiedTime: number;
}
const cloudKitStore = new Map<string, CloudKitRecord>();

let secretsKeychain: SecretsKeychainMod;
let shardEnvelope: ShardEnvelopeMod;
let shardDist: ShardDistMod;
let recovery: RecoveryMod;
let timeLock: TimeLockMod;
let inactivity: InactivityMod;
let cloudSync: CloudSyncMod;

// Install module mocks at TOP-LEVEL (not inside beforeAll) so they survive
// running this suite alongside others that may have set their own mocks
// earlier in the same bun process. `mock.module` is idempotent w.r.t. the
// last-registered shape; we re-register here unconditionally.
void mock.module('@/storage/mmkv', () => ({
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
  initMmkv: (): Promise<undefined> => Promise.resolve(undefined),
}));

void mock.module('@/storage/secureMasterKey', () => ({
  getMasterKey: (): Promise<Uint8Array> => Promise.resolve(FIXED_MASTER_KEY),
  resetMasterKeyForTesting: (): Promise<undefined> => Promise.resolve(undefined),
  evictMasterKeyCache: (): undefined => undefined,
}));

void mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: (alias: string): Promise<string | null> =>
    Promise.resolve(secureStore.get(alias) ?? null),
  setItemAsync: (alias: string, value: string): Promise<void> => {
    secureStore.set(alias, value);
    return Promise.resolve();
  },
  deleteItemAsync: (alias: string): Promise<void> => {
    secureStore.delete(alias);
    return Promise.resolve();
  },
}));

void mock.module('expo-local-authentication', () => ({
  hasHardwareAsync: (): Promise<boolean> => Promise.resolve(true),
  isEnrolledAsync: (): Promise<boolean> => Promise.resolve(true),
  authenticateAsync: (): Promise<{ success: boolean }> =>
    Promise.resolve({ success: nextBiometricResult }),
}));

void mock.module('@/sakura/client', () => ({
  sendMessage: (req: { recipient_pubkey: string; blob: string }): Promise<void> => {
    sentRequests.push({ recipientPubKey: req.recipient_pubkey, blob: req.blob });
    return Promise.resolve();
  },
  buildSealedSendRequest: (
    msg: {
      recipientPubKey: string;
      recipientSealedRoute: string;
      senderSignPubKey: string;
      payload: unknown;
    },
    unsignedSenderSig = ''
  ) => ({
    recipient_pubkey: msg.recipientPubKey,
    blob: Buffer.from(JSON.stringify(msg.payload)).toString('base64'),
    sealed_route: msg.recipientSealedRoute,
    sender_pubkey: msg.senderSignPubKey,
    sender_sig: unsignedSenderSig || 'test',
  }),
}));

void mock.module('@solidarity/nitro-cloudkit', () => ({
  getCloudKit: () => ({
    initialize: (): Promise<undefined> => Promise.resolve(undefined),
    saveRecord: (rec: CloudKitRecord): Promise<void> => {
      cloudKitStore.set(rec.recordId, { ...rec });
      return Promise.resolve();
    },
    fetchRecord: (id: string): Promise<CloudKitRecord> => {
      const rec = cloudKitStore.get(id);
      if (!rec) return Promise.reject(new Error(`no record ${id}`));
      return Promise.resolve(rec);
    },
    setDriveAccessToken: (): void => undefined,
  }),
}));

// secretsKeychain.ts now imports `@solidarity/nitro-secrets-vault`. We
// stub the hardware-backed driver as "unavailable" so this suite keeps
// driving the legacy v0 raw path (the existing root-secret bytes are
// pre-seeded into `secureStore` under the rootSecret alias).
void mock.module('@solidarity/nitro-secrets-vault', () => ({
  getSecretsVault: () => ({
    isHardwareAvailable: (): boolean => false,
    ensureWrappingKey: (): Promise<{ hardwareBacked: boolean }> =>
      Promise.resolve({ hardwareBacked: false }),
    wrap: (): Promise<never> => Promise.reject(new Error('hw stub: wrap disabled')),
    unwrap: (): Promise<never> => Promise.reject(new Error('hw stub: unwrap disabled')),
    deleteKey: (): Promise<void> => Promise.resolve(),
  }),
}));

void mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: (): Promise<{ exists: boolean }> => Promise.resolve({ exists: false }),
  makeDirectoryAsync: (): Promise<undefined> => Promise.resolve(undefined),
  writeAsStringAsync: (): Promise<undefined> => Promise.resolve(undefined),
  readAsStringAsync: (): Promise<string> => Promise.resolve(''),
  deleteAsync: (): Promise<undefined> => Promise.resolve(undefined),
}));

void mock.module('react-native', () => ({
  ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
    .__AIRMEISHI_RN_MOCK__),
  Platform: { OS: 'ios' },
  AppState: {
    addEventListener: () => ({ remove: (): undefined => undefined }),
  },
}));

beforeAll(async () => {
  // Seed the rootSecret BEFORE module import so the secretsKeychain cache
  // primes with the deterministic FIXED bytes.
  const b64 = Buffer.from(FIXED_ROOT_SECRET).toString('base64');
  secureStore.set('gg.solidarity.vault.rootSecret.v1', b64);

  shardEnvelope = await import('../../src/vault/shardEnvelope');
  secretsKeychain = await import('../../src/vault/secretsKeychain');
  shardDist = await import('../../src/vault/shardDistribution');
  recovery = await import('../../src/vault/recovery');
  timeLock = await import('../../src/vault/timeLock');
  inactivity = await import('../../src/vault/inactivityMonitor');
  cloudSync = await import('../../src/vault/cloudSync');
}, 30_000);

beforeEach(async () => {
  kv.clear();
  sentRequests.length = 0;
  cloudKitStore.clear();
  nextBiometricResult = true;
  // Re-seed root secret each test (some tests evict it).
  const b64 = Buffer.from(FIXED_ROOT_SECRET).toString('base64');
  secureStore.set('gg.solidarity.vault.rootSecret.v1', b64);
  secretsKeychain.evictCachedRootSecret();
  // The shared grace bucket (phase 4) persists across tests in this file —
  // a prior successful auth would silence the denial-path assertions.
  const bio = await import('../../src/keychain/biometric');
  bio.resetBiometricGrace();
});

// ── 1. Envelope binding semantics ───────────────────────────────────────────

describe('shardEnvelope: AAD binding', () => {
  const VAULT_ID = '11111111-2222-3333-4444-555555555555';
  const GUARDIAN_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';
  const WRAP_KEY = FIXED_ROOT_SECRET;

  it('uuidStringToBytes parses with and without dashes', () => {
    const a = shardEnvelope.uuidStringToBytes(VAULT_ID);
    const b = shardEnvelope.uuidStringToBytes(VAULT_ID.replace(/-/gu, ''));
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(a.length).toBe(16);
  });

  it('wrap → unwrap round-trips the shard bytes', () => {
    const shard = hexToBytes('aabbccddeeff00112233445566778899');
    const wrapped = shardEnvelope.wrapShard(shard, WRAP_KEY, {
      vaultId: VAULT_ID,
      guardianContactId: GUARDIAN_ID,
      shardIndex: 3,
      threshold: 3,
    });
    expect(wrapped.kind).toBe('ok');
    if (wrapped.kind !== 'ok') return;
    const opened = shardEnvelope.unwrapShard(wrapped.envelope, WRAP_KEY, 3);
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') return;
    expect(bytesToHex(opened.shardBytes)).toBe(bytesToHex(shard));
  });

  it('mutating any AAD field breaks auth (vaultId)', () => {
    const wrapped = shardEnvelope.wrapShard(
      hexToBytes('1100'),
      WRAP_KEY,
      { vaultId: VAULT_ID, guardianContactId: GUARDIAN_ID, shardIndex: 1, threshold: 2 }
    );
    if (wrapped.kind !== 'ok') throw new Error('seal failed');
    const tampered = {
      ...wrapped.envelope,
      vaultId: '99999999-9999-9999-9999-999999999999',
    };
    const opened = shardEnvelope.unwrapShard(tampered, WRAP_KEY, 2);
    expect(opened.kind).toBe('err');
  });

  it('mutating the threshold value (bindingMismatch)', () => {
    const wrapped = shardEnvelope.wrapShard(
      hexToBytes('22'),
      WRAP_KEY,
      { vaultId: VAULT_ID, guardianContactId: GUARDIAN_ID, shardIndex: 2, threshold: 3 }
    );
    if (wrapped.kind !== 'ok') throw new Error('seal failed');
    const opened = shardEnvelope.unwrapShard(wrapped.envelope, WRAP_KEY, /* expected */ 5);
    expect(opened.kind).toBe('err');
    if (opened.kind !== 'err') return;
    expect(opened.reason).toBe('bindingMismatch');
  });

  it('encode/decode round-trip preserves Codable JSON shape', () => {
    const wrapped = shardEnvelope.wrapShard(
      hexToBytes('33'),
      WRAP_KEY,
      { vaultId: VAULT_ID, guardianContactId: GUARDIAN_ID, shardIndex: 1, threshold: 2 }
    );
    if (wrapped.kind !== 'ok') throw new Error('seal failed');
    const json = shardEnvelope.encodeEnvelope(wrapped.envelope);
    const decoded = shardEnvelope.decodeEnvelope(json);
    expect(decoded).not.toBeNull();
    expect(decoded?.shardIndex).toBe(1);
    expect(decoded?.vaultId).toBe(VAULT_ID.toUpperCase());
  });
});

// ── 2. distributeRecoveryShards + sakura wire ──────────────────────────────

function makeRecipient(i: number): {
  contactId: string;
  sakuraRecipientPub: string;
  sakuraSealedRoute: string;
  senderSignPubKey: string;
  displayName: string;
} {
  return {
    contactId: `00000000-0000-0000-0000-00000000000${String(i)}`,
    sakuraRecipientPub: `pub-${String(i)}`,
    sakuraSealedRoute: `route-${String(i)}`,
    senderSignPubKey: `sign-${String(i)}`,
    displayName: `Guardian ${String(i)}`,
  };
}

describe('distributeRecoveryShards: split → wrap → send', () => {
  const VAULT_ID = 'abcdef00-1111-2222-3333-444444444444';

  it('sends one Sakura message per recipient and persists distribution records', async () => {
    const recipients = [1, 2, 3, 4, 5].map((i) => makeRecipient(i));
    const result = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 3,
      recipients,
    });
    expect(result.kind).toBe('ok');
    expect(sentRequests.length).toBe(5);
    if (result.kind !== 'ok') return;
    expect(result.envelopes.length).toBe(5);
    expect(result.records.length).toBe(5);
    expect(result.records.every((r) => r.threshold === 3)).toBe(true);
    expect(result.records.every((r) => r.total === 5)).toBe(true);

    const loaded = await shardDist.loadAllDistributionRecords();
    expect(loaded.length).toBe(5);
  });

  it('rejects invalid threshold (< 2 or > recipients)', async () => {
    const recipients = [makeRecipient(1), makeRecipient(2)];
    const tooLow = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 1,
      recipients,
    });
    expect(tooLow.kind).toBe('err');
    const tooHigh = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 5,
      recipients,
    });
    expect(tooHigh.kind).toBe('err');
  });

  it('biometric-denied root secret aborts distribution', async () => {
    nextBiometricResult = false;
    secretsKeychain.evictCachedRootSecret();
    const result = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 2,
      recipients: [makeRecipient(1), makeRecipient(2)],
    });
    expect(result.kind).toBe('err');
    if (result.kind === 'err') {
      expect(result.reason).toBe('biometricDenied');
    }
    expect(sentRequests.length).toBe(0);
  });

  it('the sealed payload decoded back matches the envelope we shipped', async () => {
    const recipients = [1, 2, 3].map((i) => makeRecipient(i));
    const result = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 2,
      recipients,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    // The test stub of buildSealedSendRequest stashes JSON.stringify(payload)
    // in `blob` as base64. Decode + verify the envelope round trip.
    const first = sentRequests[0];
    expect(first).toBeDefined();
    if (!first) return;
    const payload = JSON.parse(Buffer.from(first.blob, 'base64').toString('utf-8')) as {
      type: string;
      envelopeJson: string;
    };
    expect(payload.type).toBe(shardDist.VAULT_SHARD_MESSAGE_TYPE);
    const env = shardEnvelope.decodeEnvelope(payload.envelopeJson);
    expect(env).not.toBeNull();
    expect(env?.shardIndex).toBe(result.envelopes[0]?.shardIndex);
  });
});

// ── 3. End-to-end: split → wrap → unwrap → combine ─────────────────────────

describe('full recovery round trip via the public surface', () => {
  const VAULT_ID = '00000000-1111-2222-3333-deadbeefcafe';

  it('threshold semantics: k-1 stays pending, k reconstructs the original secret', async () => {
    const recipients = [1, 2, 3, 4, 5].map((i) => makeRecipient(i));
    const dist = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 3,
      recipients,
    });
    expect(dist.kind).toBe('ok');
    if (dist.kind !== 'ok') return;

    // Replay the first two envelopes; recovery must remain `pending`.
    let last = await recovery.addReceivedShard(dist.envelopes[0]!, FIXED_ROOT_SECRET);
    expect(last.collected).toBe(1);
    expect(last.ready).toBe(false);

    last = await recovery.addReceivedShard(dist.envelopes[1]!, FIXED_ROOT_SECRET);
    expect(last.collected).toBe(2);
    expect(last.ready).toBe(false);

    const stillPending = await recovery.reconstructRootSecret(VAULT_ID);
    expect(stillPending.kind).toBe('pending');
    expect(stillPending.rootSecret).toBeUndefined();

    // Third envelope flips us to ready.
    last = await recovery.addReceivedShard(dist.envelopes[2]!, FIXED_ROOT_SECRET);
    expect(last.collected).toBe(3);
    expect(last.ready).toBe(true);

    const done = await recovery.reconstructRootSecret(VAULT_ID);
    expect(done.kind).toBe('ok');
    expect(done.rootSecret).toBeDefined();
    if (!done.rootSecret) return;
    expect(bytesToHex(done.rootSecret)).toBe(bytesToHex(FIXED_ROOT_SECRET));

    recovery.clearRecoveryState(VAULT_ID);
    const after = await recovery.inspectRecovery(VAULT_ID);
    expect(after).toBeNull();
  });

  it('duplicate shard with the same index is ignored', async () => {
    const recipients = [makeRecipient(1), makeRecipient(2), makeRecipient(3)];
    const dist = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 2,
      recipients,
    });
    if (dist.kind !== 'ok') throw new Error('distribute failed');

    const first = await recovery.addReceivedShard(dist.envelopes[0]!, FIXED_ROOT_SECRET);
    expect(first.collected).toBe(1);
    const dup = await recovery.addReceivedShard(dist.envelopes[0]!, FIXED_ROOT_SECRET);
    expect(dup.kind).toBe('duplicate');
    expect(dup.collected).toBe(1);
  });

  it('a forged envelope (wrong wrap key) fails authentication', async () => {
    const recipients = [makeRecipient(1), makeRecipient(2)];
    const dist = await shardDist.distributeRecoveryShards({
      vaultId: VAULT_ID,
      threshold: 2,
      recipients,
    });
    if (dist.kind !== 'ok') throw new Error('distribute failed');
    const badKey = new Uint8Array(32).fill(0x00);
    const res = await recovery.addReceivedShard(dist.envelopes[0]!, badKey);
    expect(res.kind).toBe('authFailed');
  });

  it('direct Shamir combine on the embedded shares (no envelope) matches', () => {
    // Sanity: even bypassing the envelope, the embedded share layout we
    // packed in distributeRecoveryShards round-trips through combine.
    const shares = split(FIXED_ROOT_SECRET, 3, 5);
    const recovered = combine(shares.slice(0, 3));
    expect(bytesToHex(recovered)).toBe(bytesToHex(FIXED_ROOT_SECRET));
  });
});

// ── 4. Time lock ───────────────────────────────────────────────────────────

describe('timeLock policy', () => {
  it('disabled → always unlocked', () => {
    const c = timeLock.defaultTimeLockConfig();
    expect(timeLock.isUnlocked(c)).toBe(true);
  });

  it('unlockDate in the future → locked; past → unlocked', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(timeLock.isUnlocked({ ...timeLock.defaultTimeLockConfig(), enabled: true, unlockDate: future })).toBe(false);
    expect(timeLock.isUnlocked({ ...timeLock.defaultTimeLockConfig(), enabled: true, unlockDate: past })).toBe(true);
  });

  it('nextUnlockAt returns the unlockDate epoch when set', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const c = { ...timeLock.defaultTimeLockConfig(), enabled: true, unlockDate: future };
    expect(timeLock.nextUnlockAt(c)).toBe(Date.parse(future));
  });

  it('inactivity threshold unlocks once daysSinceLastActivity >= inactivityDays', () => {
    const c = { ...timeLock.defaultTimeLockConfig(), enabled: true, inactivityDays: 7 };
    expect(timeLock.isUnlocked(c, Date.now(), 6)).toBe(false);
    expect(timeLock.isUnlocked(c, Date.now(), 7)).toBe(true);
  });

  it('applyTimeLock + readTimeLock round-trips via MMKV', async () => {
    const c = { ...timeLock.defaultTimeLockConfig(), enabled: true, inactivityDays: 30 };
    await timeLock.applyTimeLock('item-1', c);
    const got = await timeLock.readTimeLock('item-1');
    expect(got?.inactivityDays).toBe(30);
    expect(got?.enabled).toBe(true);
  });
});

// ── 5. Inactivity monitor ──────────────────────────────────────────────────

describe('inactivityMonitor', () => {
  it('recordActivity persists the timestamp and resets idle', () => {
    const fakeNow = 1_700_000_000_000;
    inactivity.startMonitor({
      idleMs: 1000,
      now: () => fakeNow,
      onLock: () => undefined,
    });
    inactivity.recordActivity();
    expect(inactivity.readLastActivity()).toBe(fakeNow);
    inactivity.stopMonitor();
  });

  it('_testFireIdle invokes the configured onLock', () => {
    let locked = false;
    inactivity.startMonitor({
      idleMs: 1000,
      onLock: () => {
        locked = true;
      },
    });
    inactivity._testFireIdle();
    expect(locked).toBe(true);
    inactivity.stopMonitor();
  });

  it('AppState change to background triggers lockVault', () => {
    let locked = false;
    inactivity.startMonitor({
      idleMs: 60_000,
      onLock: () => {
        locked = true;
      },
    });
    inactivity._testHandleAppStateChange('background');
    expect(locked).toBe(true);
    inactivity.stopMonitor();
  });

  it('daysSinceLastActivity zero on a fresh record', () => {
    const fakeNow = 1_700_000_000_000;
    inactivity.startMonitor({
      idleMs: 60_000,
      now: () => fakeNow,
      onLock: () => undefined,
    });
    inactivity.recordActivity();
    expect(inactivity.daysSinceLastActivity(fakeNow)).toBe(0);
    expect(inactivity.daysSinceLastActivity(fakeNow + 3 * 24 * 60 * 60 * 1000)).toBe(3);
    inactivity.stopMonitor();
  });
});

// ── 6. Cloud sync ──────────────────────────────────────────────────────────

function makeItem(id: string, updatedAt: string, checksum: string): {
  id: string;
  name: string;
  kind: 'file';
  size: number;
  checksumSha256: string;
  encryptedPath: string;
  createdAt: Date;
  updatedAt: Date;
  tags: readonly string[];
} {
  return {
    id,
    name: id,
    kind: 'file',
    size: 100,
    checksumSha256: checksum,
    encryptedPath: `/mock/${id}.enc`,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    tags: [],
  };
}

describe('cloudSync', () => {
  it('buildLocalManifest produces one entry per item with isDeleted=false', () => {
    const a = makeItem('a', '2026-01-01T00:00:00Z', 'cs1');
    const m = cloudSync.buildLocalManifest([a]);
    expect(Object.keys(m.items).length).toBe(1);
    expect(m.items['a']?.checksum).toBe('cs1');
    expect(m.items['a']?.isDeleted).toBe(false);
  });

  it('computeSyncChanges classifies local-only, cloud-only, and conflicts', () => {
    const local = {
      items: {
        a: { modifiedAt: '2026-01-01T00:00:00Z', checksum: 'cs-a', isDeleted: false },
        c: { modifiedAt: '2026-01-03T00:00:00Z', checksum: 'cs-c-local', isDeleted: false },
      },
      lastSync: null,
    };
    const cloud = {
      items: {
        b: { modifiedAt: '2026-01-02T00:00:00Z', checksum: 'cs-b', isDeleted: false },
        c: { modifiedAt: '2026-01-04T00:00:00Z', checksum: 'cs-c-cloud', isDeleted: false },
      },
      lastSync: null,
    };
    const changes = cloudSync.computeSyncChanges(local, cloud);
    expect(changes.toUpload).toEqual(['a']);
    expect(changes.toDownload).toEqual(['b']);
    expect(changes.conflicts.length).toBe(1);
    expect(changes.conflicts[0]?.itemId).toBe('c');
  });

  it('mergeManifests picks the entry with the later modifiedAt', () => {
    const local = {
      items: {
        c: { modifiedAt: '2026-01-03T00:00:00Z', checksum: 'cs-local', isDeleted: false },
      },
      lastSync: null,
    };
    const cloud = {
      items: {
        c: { modifiedAt: '2026-01-04T00:00:00Z', checksum: 'cs-cloud', isDeleted: false },
      },
      lastSync: null,
    };
    const merged = cloudSync.mergeManifests(local, cloud);
    expect(merged.items['c']?.checksum).toBe('cs-cloud');
    expect(merged.lastSync).not.toBeNull();
  });

  it('syncVaultMetadata writes a record to the mocked CloudKit', async () => {
    const a = makeItem('a', '2026-01-01T00:00:00Z', 'cs-a');
    const res = await cloudSync.syncVaultMetadata([a]);
    expect(res.kind).toBe('ok');
    // The record was written under the manifest id.
    expect(cloudKitStore.has('solidarity.vault.manifest.v1')).toBe(true);
  });

  it('pullVaultMetadata round-trips through the mocked CloudKit', async () => {
    const a = makeItem('a', '2026-01-01T00:00:00Z', 'cs-a');
    await cloudSync.syncVaultMetadata([a]);
    const pulled = await cloudSync.pullVaultMetadata([a]);
    expect(pulled.kind).toBe('ok');
    if (pulled.kind === 'ok') {
      expect(pulled.merged.items['a']?.checksum).toBe('cs-a');
    }
  });

  it('resolveConflict("keepLocal" | "keepCloud" | "merge") returns the right entry', () => {
    const conflict = {
      itemId: 'c',
      localModifiedAt: '2026-01-03T00:00:00Z',
      cloudModifiedAt: '2026-01-04T00:00:00Z',
      localChecksum: 'L',
      cloudChecksum: 'C',
    };
    expect(cloudSync.resolveConflict(conflict, 'keepLocal').checksum).toBe('L');
    expect(cloudSync.resolveConflict(conflict, 'keepCloud').checksum).toBe('C');
    expect(cloudSync.resolveConflict(conflict, 'merge').checksum).toBe('C');
  });
});
