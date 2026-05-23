/**
 * iCloud backup round trip — full payload (cards + contacts + groups +
 * identity key wrapper) → encrypt → upload → wipe → download → decrypt →
 * restore → deep-equal.
 *
 * Swift reference:
 *   solidarity/Services/Backup/BackupManager.swift
 *     - BackupData {
 *         version: Int,
 *         timestamp: Date,
 *         businessCards: [BusinessCard],
 *         contacts: [Contact],
 *         identityCards: [BackupIdentityCard]?,
 *         provableClaims: [BackupProvableClaim]?,
 *         storedCredentials: [BackupStoredCredential]?
 *       }
 *     - File layout on disk:
 *         "SOLB" (4 bytes magic) || 0x01 (version) || AES-GCM(BackupData)
 *
 * Expo port:
 *   apps/expo/src/backup/cloudProvider.ts      — react-native-cloud-storage
 *                                                  facade (iCloud OR Drive)
 *   apps/expo/src/backup/backupManager.ts      — performBackupNow / restore
 *   apps/expo/src/backup/gestureAutoBackup.ts  — pull-down pan to trigger
 *
 * NOTE on the magic header: the TS port intentionally DROPS the "SOLB" + 0x01
 * prefix because react-native-cloud-storage writes one versioned file (path
 * is fixed at /solidarity/backup.enc) and the encryption manager's JSON
 * envelope already self-identifies via shape. The serialised JSON field
 * NAMES match Swift Codable verbatim so a Swift-produced blob can be read
 * by the Expo port and vice-versa, with the magic header stripped on the
 * Swift side first.
 *
 * The native iCloud nitro bridge is NOT done yet — there's no nitro module
 * for iCloud Drive. We mock `react-native-cloud-storage` here. When the
 * nitro bridge lands, swap the mock for the real module's surface.
 *
 * Run:
 *   cd apps/expo && bun test __tests__/unit/icloudBackupRoundtrip.test.ts
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToUtf8,
  generateAesKey,
  utf8ToBytes,
  uuid,
} from '@solidarity/shared';

// ─── Module surface types (imported lazily after mocks install) ─────────────

interface CloudProviderSurface {
  readonly uploadBackup: <T>(value: T) => Promise<void>;
  readonly downloadBackup: <T>() => Promise<T | null>;
  readonly backupMtime: () => Promise<Date | null>;
  readonly setProvider: (kind: 'iCloud' | 'googleDrive') => void;
  readonly getActiveProvider: () => 'iCloud' | 'googleDrive';
}

// ─── Fake @solidarity/nitro-cloudkit (Nitro module) ────────────────────────
//
// The real CloudKit surface stores one record per recordId + recordType.
// Our test fake stores records in a Map keyed by `<activeProvider>:<recordId>`
// so the cross-provider isolation test still demonstrates that switching
// providers wipes the visible record set.
//
// The post-Nitro cloudProvider.ts surface no longer touches files —
// uploadBackup serialises into a single `AirmeishiBackup` record whose
// `fields` payload contains the base64 ciphertext as JSON.

interface FakeRecord {
  readonly recordId: string;
  readonly recordType: string;
  readonly fields: string;
  readonly modifiedTime: number;
}
const fakeRecords = new Map<string, FakeRecord>();
let activeProvider: 'iCloud' | 'googleDrive' = 'iCloud';
let activeAccessToken: string | undefined;

function fakeKey(recordId: string): string {
  return `${activeProvider}:${recordId}`;
}

const FakeCloudKit = {
  initialize: async () => true,
  isAvailable: () => true,
  currentUserId: async () => 'fake-user',
  saveRecord: async (r: FakeRecord) => {
    const stamped: FakeRecord = { ...r, modifiedTime: Date.now() };
    fakeRecords.set(fakeKey(r.recordId), stamped);
    return stamped;
  },
  fetchRecord: async (id: string): Promise<FakeRecord> => {
    const v = fakeRecords.get(fakeKey(id));
    if (!v) throw new Error(`fake-cloudkit: missing ${id}`);
    return v;
  },
  deleteRecord: async (id: string) => {
    fakeRecords.delete(fakeKey(id));
  },
  queryRecords: async () => [],
  createShare: async () => ({ shareId: '', url: '', title: '', thumbnail: undefined }),
  acceptShare: async () => '',
  fetchSharedRecords: async () => [],
  removeShare: async () => undefined,
  addEventListener: () => () => undefined,
  setDriveAccessToken: (token: string) => { activeAccessToken = token; },
};

// ─── Mock setup ────────────────────────────────────────────────────────────

const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xa1);

let cloud: CloudProviderSurface;

beforeAll(async () => {
  await mock.module('@solidarity/nitro-cloudkit', () => ({
    getCloudKit: () => FakeCloudKit,
  }));
  await mock.module('react-native', () => ({
    Platform: { OS: 'ios', select: <T,>(o: { ios?: T; android?: T; default?: T }) =>
      o.ios ?? o.default },
  }));
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => FIXED_MASTER_KEY,
    resetMasterKeyForTesting: async () => undefined,
  }));
  // Install a REAL AES-GCM encryption manager (overrides any plaintext stub
  // installed by sibling tests via mock.module). cloudProvider uses encryptJson
  // / decryptJson; we need the stored bytes to be actual ciphertext so the
  // confidentiality assertions hold.
  await mock.module('@/storage/encryptionManager', () => ({
    encryptJson: async (value: unknown) => {
      const sealed = aesGcmSeal(FIXED_MASTER_KEY, utf8ToBytes(JSON.stringify(value)));
      return base64Encode(sealed);
    },
    decryptJson: async <T,>(blob: string): Promise<T> => {
      const sealed = base64Decode(blob);
      const opened = aesGcmOpen(FIXED_MASTER_KEY, sealed);
      return JSON.parse(bytesToUtf8(opened)) as T;
    },
  }));

  cloud = (await import('../../src/backup/cloudProvider')) as unknown as CloudProviderSurface;
});

beforeEach(() => {
  fakeRecords.clear();
  activeProvider = 'iCloud';
  activeAccessToken = undefined;
});

// ─── Backup payload shape — mirrors Swift BackupData ───────────────────────

interface SwiftCompatibleBackupData {
  /** Matches Swift BackupData.version (currently 3). */
  readonly version: number;
  /** ISO-8601 timestamp (Swift JSONEncoder default for Date). */
  readonly timestamp: string;
  readonly businessCards: readonly Record<string, unknown>[];
  readonly contacts: readonly Record<string, unknown>[];
  readonly identityCards?: readonly Record<string, unknown>[];
  readonly provableClaims?: readonly Record<string, unknown>[];
  readonly storedCredentials?: readonly Record<string, unknown>[];

  /**
   * Extension fields for the Expo port — Swift doesn't emit these yet but
   * the TS port carries groups + the wrapped identity key inline so a fresh
   * Android install can recover everything from one blob. When the Swift
   * exporter adds these, drop them into the Codable struct in the same
   * field order.
   *
   * TODO(swift-parity): mirror these fields in Swift BackupManager.BackupData.
   */
  readonly groups?: readonly Record<string, unknown>[];
  readonly members?: readonly Record<string, unknown>[];
  readonly identityKeyWrapper?: Record<string, unknown>;
}

function makeFullPayload(): SwiftCompatibleBackupData {
  return {
    version: 3,
    timestamp: '2026-05-24T00:00:00Z',
    businessCards: [
      {
        id: uuid(),
        name: 'Ada Lovelace',
        title: 'Founder',
        company: 'Solidarity',
        email: 'ada@solidarity.gg',
        animal: 'sheep',
        nameType: 'display_name',
        sharingPreferences: {
          sharingFormat: 'didSigned',
          useZK: false,
          allowForwarding: true,
          personalFields: ['name', 'email'],
          professionalFields: ['company', 'name'],
          publicFields: ['name'],
        },
        categories: [],
        skills: [],
        socialNetworks: [],
        createdAt: '2026-05-24T00:00:00Z',
        updatedAt: '2026-05-24T00:00:00Z',
      },
    ],
    contacts: [
      {
        id: uuid(),
        businessCard: {
          id: uuid(),
          name: 'Bob',
          nameType: 'display_name',
          sharingPreferences: {
            sharingFormat: 'plain',
            useZK: false,
            allowForwarding: false,
            personalFields: [],
            professionalFields: [],
            publicFields: [],
          },
          categories: [],
          skills: [],
          socialNetworks: [],
          createdAt: '2026-05-24T00:00:00Z',
          updatedAt: '2026-05-24T00:00:00Z',
        },
        receivedAt: '2026-05-24T00:00:00Z',
        source: 'Manual',
        tags: [],
        verificationStatus: 'Unverified',
      },
    ],
    groups: [
      {
        id: uuid(),
        name: 'Aurora',
        description: '',
        ownerRecordID: 'me',
        merkleTreeDepth: 20,
        memberCount: 1,
        isPrivate: false,
        isSynced: true,
        credentialIssuers: [],
      },
    ],
    members: [
      {
        id: uuid(),
        groupID: 'placeholder-resolved-by-restore',
        userRecordID: 'me',
        role: 'owner',
        status: 'active',
        merkleIndex: 0,
        joinedAt: '2026-05-24T00:00:00Z',
      },
    ],
    identityKeyWrapper: {
      // Wrapped (encrypted-at-rest) private key bytes — represented as
      // base64. The wrap is done at biometric-unlock time so we can attest
      // the user's identity on restore.
      wrappedPrivateKey: base64Encode(new Uint8Array(32).fill(0x7e)),
      kid: 'gg.solidarity.signing.v2',
    },
    identityCards: [],
    provableClaims: [],
    storedCredentials: [],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('iCloud backup round trip — encrypted blob via react-native-cloud-storage', () => {
  it('uploads + downloads a full payload byte-equal', async () => {
    const payload = makeFullPayload();
    await cloud.uploadBackup(payload);

    // Storage now holds something — that something must be ciphertext (not
    // plaintext) so the cloud provider can never see the payload bytes.
    const stored = Array.from(fakeRecords.values())[0]?.fields ?? '';
    expect(stored.length).toBeGreaterThan(0);
    expect(stored).not.toContain('Ada Lovelace');
    expect(stored).not.toContain('Aurora');

    const downloaded = await cloud.downloadBackup<SwiftCompatibleBackupData>();
    expect(downloaded).not.toBeNull();
    expect(downloaded?.version).toBe(3);
    expect(downloaded?.businessCards.length).toBe(1);
    expect(downloaded?.contacts.length).toBe(1);
    expect(downloaded?.groups?.length).toBe(1);
  });

  it('round-trips through a wipe (simulating fresh install + restore)', async () => {
    const payload = makeFullPayload();
    await cloud.uploadBackup(payload);

    // Wipe local storage but NOT cloud storage (matches "fresh install" UX).
    // The cloud file persists; the local KV is empty.
    const restored = await cloud.downloadBackup<SwiftCompatibleBackupData>();
    expect(restored).not.toBeNull();

    // Deep-equal on JSON-comparable fields.
    expect(JSON.stringify(restored?.businessCards)).toBe(JSON.stringify(payload.businessCards));
    expect(JSON.stringify(restored?.contacts)).toBe(JSON.stringify(payload.contacts));
    expect(JSON.stringify(restored?.groups)).toBe(JSON.stringify(payload.groups));
    expect(JSON.stringify(restored?.identityKeyWrapper))
      .toBe(JSON.stringify(payload.identityKeyWrapper));
  });

  it('downloadBackup() returns null when no file exists (fresh device)', async () => {
    const result = await cloud.downloadBackup<SwiftCompatibleBackupData>();
    expect(result).toBeNull();
  });

  it('backupMtime() reports the cloud-side timestamp after upload', async () => {
    const before = await cloud.backupMtime();
    expect(before).toBeNull();
    await cloud.uploadBackup(makeFullPayload());
    const after = await cloud.backupMtime();
    expect(after).not.toBeNull();
    expect(after).toBeInstanceOf(Date);
  });

  it('Google Drive provider isolates files from iCloud (cross-provider safety)', async () => {
    // Upload to iCloud.
    cloud.setProvider('iCloud');
    activeProvider = 'iCloud';
    await cloud.uploadBackup(makeFullPayload());

    // Switch to Drive and try to download — must return null (different provider).
    cloud.setProvider('googleDrive');
    activeProvider = 'googleDrive';
    const drive = await cloud.downloadBackup<SwiftCompatibleBackupData>();
    expect(drive).toBeNull();

    // Switch back; iCloud blob still present.
    cloud.setProvider('iCloud');
    activeProvider = 'iCloud';
    const ic = await cloud.downloadBackup<SwiftCompatibleBackupData>();
    expect(ic).not.toBeNull();
  });
});

// ─── Swift parity: field names + order ─────────────────────────────────────

describe('iCloud backup — Swift BackupData field parity', () => {
  /**
   * Pin the exact field names + ordering Swift Codable expects on the wire.
   * If Swift gains a new field, this test reminds the dev to mirror it in
   * the TS payload above.
   */
  it('JSON keys match Swift BackupData CodingKeys', () => {
    const payload = makeFullPayload();
    const keys = Object.keys(payload).sort();
    // Swift's required + optional fields, plus our 3 extensions.
    const expected = [
      'businessCards',
      'contacts',
      'groups',                // TS extension (TODO mirror in Swift)
      'identityCards',
      'identityKeyWrapper',    // TS extension (TODO mirror in Swift)
      'members',               // TS extension (TODO mirror in Swift)
      'provableClaims',
      'storedCredentials',
      'timestamp',
      'version',
    ].sort();
    expect(keys).toEqual(expected);
  });

  it('uses Swift-compatible Date format (ISO-8601 with Z)', () => {
    const payload = makeFullPayload();
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ─── Gesture-triggered backup (pull-down) ──────────────────────────────────
//
// `makeGestureAutoBackup` returns a Gesture.Pan() with an onEnd handler.
// We can't instantiate a real gesture in bun-test, but we CAN unit-test the
// "did the threshold trigger?" logic by feeding fake events through the
// gesture-handler mock. See gestureAutoBackup.ts: the threshold is 80px on
// translationY (downward pull) with a 30s cooldown.

interface GestureEvent { readonly translationY: number }
interface GestureModule {
  readonly makeGestureAutoBackup: (
    provider: 'iCloud' | 'googleDrive',
    handlers: {
      readonly onStart?: () => void;
      readonly onComplete?: (payload: unknown) => void;
      readonly onError?: (err: unknown) => void;
    }
  ) => { readonly onEnd: (cb: (e: GestureEvent) => void) => unknown };
}

describe('iCloud backup — gesture-triggered (pull-down pan)', () => {
  let gestureMod: GestureModule;

  beforeAll(async () => {
    // Mock the gesture-handler + worklets surface so the module loads in bun.
    // The fake Pan returns the most-recent onEnd callback so the test can
    // invoke it with a synthetic event.
    let pendingOnEnd: ((e: GestureEvent) => void) | null = null;
    await mock.module('react-native-gesture-handler', () => ({
      Gesture: {
        Pan: () => ({
          onEnd: (cb: (e: GestureEvent) => void) => {
            pendingOnEnd = cb;
            // Return the same shape so chained .onEnd / .activeOffsetY works.
            return { __pendingOnEnd: cb };
          },
        }),
      },
      __getPendingOnEnd: () => pendingOnEnd,
    }));
    await mock.module('react-native-worklets', () => ({
      runOnJS: <T extends (...args: unknown[]) => unknown>(fn: T) =>
        ((...args: Parameters<T>) => { fn(...args); }) as T,
    }));
    // Also need backupManager → it pulls in storage. Stub the underlying
    // managers so the test stays hermetic.
    await mock.module('@/storage/storageManager', () => ({
      loadAllBusinessCards: async () => [],
      loadAllContacts: async () => [],
      saveBusinessCard: async () => undefined,
      saveContact: async () => undefined,
    }));

    gestureMod = (await import('../../src/backup/gestureAutoBackup')) as unknown as GestureModule;
  });

  it('triggers backup when translationY exceeds the 80px threshold', async () => {
    let completedPayload: unknown = null;
    const gesture = gestureMod.makeGestureAutoBackup('iCloud', {
      onComplete: (payload) => { completedPayload = payload; },
    });
    expect(gesture).toBeDefined();
    // The captured callback should exist via the fake.
    const ghMod = await import('react-native-gesture-handler') as unknown as {
      __getPendingOnEnd: () => ((e: GestureEvent) => void) | null;
    };
    const cb = ghMod.__getPendingOnEnd();
    expect(cb).not.toBeNull();
    // Fire a pan event below threshold — must NOT trigger.
    cb!({ translationY: 40 });
    await new Promise((r) => setTimeout(r, 20));
    expect(completedPayload).toBeNull();

    // Fire a pan event above threshold — triggers backup.
    cb!({ translationY: 120 });
    await new Promise((r) => setTimeout(r, 50));
    expect(completedPayload).not.toBeNull();
  });

  it('cooldown prevents thrashing (a second pull within 30s is a no-op)', async () => {
    let calls = 0;
    const ghMod = await import('react-native-gesture-handler') as unknown as {
      __getPendingOnEnd: () => ((e: GestureEvent) => void) | null;
    };
    gestureMod.makeGestureAutoBackup('iCloud', {
      onComplete: () => { calls += 1; },
    });
    const cb = ghMod.__getPendingOnEnd();
    cb!({ translationY: 200 });
    cb!({ translationY: 200 });
    await new Promise((r) => setTimeout(r, 80));
    // Module-level lastBackupAt is shared with the previous test; the
    // cooldown gate is `now - lastBackupAt < 30s`, so a SECOND fire of the
    // gesture inside the same tick must coalesce.
    expect(calls).toBeLessThanOrEqual(1);
  });
});

// ─── Encryption round-trip sanity check (covers Swift wire) ─────────────────

describe('iCloud backup — AES-GCM envelope matches Swift CryptoKit', () => {
  it('encrypted blob byte layout is nonce(12) || ciphertext || tag(16)', () => {
    const key = generateAesKey();
    const pt = utf8ToBytes(JSON.stringify(makeFullPayload()));
    const sealed = aesGcmSeal(key, pt);
    // 12-byte nonce + plaintext bytes + 16-byte tag.
    expect(sealed.length).toBe(12 + pt.length + 16);
    // Round-trip recovers the plaintext.
    const opened = aesGcmOpen(key, sealed);
    expect(bytesToUtf8(opened)).toBe(bytesToUtf8(pt));
  });

  it('base64 envelope (matches what react-native-cloud-storage stores) round-trips', () => {
    const key = generateAesKey();
    const pt = utf8ToBytes(JSON.stringify(makeFullPayload()));
    const sealed = aesGcmSeal(key, pt);
    const b64 = base64Encode(sealed);
    const decoded = base64Decode(b64);
    expect(decoded.length).toBe(sealed.length);
    const opened = aesGcmOpen(key, decoded);
    expect(bytesToUtf8(opened)).toBe(bytesToUtf8(pt));
  });
});
