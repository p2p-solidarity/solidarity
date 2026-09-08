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
 *   apps/expo/src/backup/cloudProvider.ts      — file-based facade over the
 *                                                  @solidarity/nitro-keystone
 *                                                  file API (iCloud OR Drive)
 *   apps/expo/src/backup/solbEnvelope.ts       — SOLB magic + version framing
 *   apps/expo/src/backup/backupManager.ts      — performBackupNow / restore
 *   apps/expo/src/backup/gestureAutoBackup.ts  — pull-down pan to trigger
 *
 * NOTE on the magic header: new writes are SOLB v2 (`0x02`,
 * recovery-phrase-hkdf key scheme) — a portable, cross-device archive. The
 * reader stays v1-COMPATIBLE (`0x01`, device-storage key) so existing Swift /
 * pre-upgrade `.solbk` files still restore on the original device, but writes
 * are no longer byte-identical to the SwiftUI format. The serialised JSON field
 * NAMES still match Swift Codable verbatim.
 *
 * We mock the @solidarity/nitro-keystone file API here (writeFileBackup /
 * readFileBackup / listFileBackups) with an in-memory file store.
 *
 * Run:
 *   cd apps/expo && bun test __tests__/unit/icloudBackupRoundtrip.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { Preferences } from '../../src/settings/preferences';

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

import {
  DecryptError,
  decryptJsonWithKey,
  encryptJsonWithKey,
} from '../../src/storage/jsonCrypto';
import { encodeSolb } from '../../src/backup/solbEnvelope';
import { ArchiveDownloadPendingError } from '../../src/backup/archiveDownload';

// ─── Module surface types (imported lazily after mocks install) ─────────────

interface DownloadedArchive {
  readonly keyScheme: 'device-storage-v1' | 'recovery-phrase-hkdf-v1';
  readonly ciphertextB64: string;
}
interface BackupArchiveInfo {
  readonly name: string;
  readonly timestampMs: number;
  readonly version: 1 | 2 | null;
  readonly availability: 'ready' | 'downloading' | 'cloud-only';
  readonly percent: number | null;
}
interface CloudProviderSurface {
  readonly uploadBackup: <T>(value: T, key: Uint8Array) => Promise<void>;
  readonly ensureArchiveDownloaded: (
    name: string,
    options?: {
      readonly pollMs?: number;
      readonly onProgress?: (progress: { readonly percent: number | null }) => void;
    },
  ) => Promise<void>;
  readonly downloadLatestArchive: () => Promise<DownloadedArchive | null>;
  readonly downloadArchive: (name: string) => Promise<DownloadedArchive>;
  readonly listBackupArchives: () => Promise<readonly BackupArchiveInfo[]>;
  readonly backupMtime: () => Promise<Date | null>;
  readonly setProvider: (kind: 'iCloud' | 'googleDrive') => void;
  readonly getActiveProvider: () => 'iCloud' | 'googleDrive';
}

// ─── Fake @solidarity/nitro-keystone (Nitro module) ────────────────────────
//
// The real CloudKit surface stores one record per recordId + recordType.
// Our test fake stores records in a Map keyed by `<activeProvider>:<recordId>`
// so the cross-provider isolation test still demonstrates that switching
// providers wipes the visible record set.
//
// The post-Nitro cloudProvider.ts surface no longer touches files —
// uploadBackup serialises into a single `AirmeishiBackup` record whose
// `fields` payload contains the base64 ciphertext as JSON.

interface FakeFile {
  content: string;
  modifiedTime: number;
}
// File-based store keyed by `<activeProvider>:<filename>`. The cloudProvider
// now writes SOLB-framed `.solbk` files via writeFileBackup (iOS ubiquity /
// Android Drive), not a CloudKit record.
const fakeFiles = new Map<string, FakeFile>();
let activeProvider: 'iCloud' | 'googleDrive' = 'iCloud';
let fakeClock = 1_700_000_000_000;
// iCloud eviction: a file that exists in the cloud but whose bytes are not on
// this device. `readFileBackup` fails fast on it (the real native contract);
// `startFileBackupDownload` begins a two-poll "transfer" (50% → current).
const evicted = new Set<string>();
const downloadPolls = new Map<string, number>();
const reads: string[] = [];
const starts: string[] = [];

function fileKey(filename: string): string {
  return `${activeProvider}:${filename}`;
}

const FakeCloudKit = {
  initialize: async () => true,
  isAvailable: () => true,
  currentUserId: async () => 'fake-user',
  // Record CRUD retained as no-ops — backup no longer uses it.
  saveRecord: async (r: unknown) => r,
  fetchRecord: async (id: string) => { throw new Error(`fake-cloudkit: records unused (${id})`); },
  deleteRecord: async () => undefined,
  queryRecords: async () => [],
  createShare: async () => ({ shareId: '', url: '', title: '', thumbnail: undefined }),
  acceptShare: async () => '',
  fetchSharedRecords: async () => [],
  removeShare: async () => undefined,
  addEventListener: () => () => undefined,
  setDriveAccessToken: () => undefined,
  // File-based backup surface.
  writeFileBackup: async (filename: string, content: string) => {
    fakeClock += 1000;
    fakeFiles.set(fileKey(filename), { content, modifiedTime: fakeClock });
  },
  readFileBackup: async (filename: string): Promise<string> => {
    reads.push(filename);
    const f = fakeFiles.get(fileKey(filename));
    if (!f) throw new Error(`fake-cloudkit: missing ${filename}`);
    if (evicted.has(filename)) throw new Error('iCloud file is still downloading');
    return f.content;
  },
  getFileBackupDownloadState: async (filename: string) => {
    if (!fakeFiles.has(fileKey(filename))) return { status: 'missing' as const };
    if (!evicted.has(filename)) return { status: 'current' as const, percentDownloaded: 100 };
    const polls = downloadPolls.get(filename);
    if (polls === undefined) return { status: 'notDownloaded' as const };
    if (polls === 0) {
      downloadPolls.set(filename, 1);
      return { status: 'downloading' as const, percentDownloaded: 50 };
    }
    evicted.delete(filename);
    downloadPolls.delete(filename);
    return { status: 'current' as const, percentDownloaded: 100 };
  },
  startFileBackupDownload: async (filename: string) => {
    starts.push(filename);
    if (evicted.has(filename)) downloadPolls.set(filename, 0);
  },
  listFileBackups: async (): Promise<string[]> => {
    const prefix = `${activeProvider}:`;
    return Array.from(fakeFiles.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  },
  deleteFileBackup: async (filename: string) => {
    fakeFiles.delete(fileKey(filename));
  },
  getFileBackupMtime: async (filename: string): Promise<number> =>
    fakeFiles.get(fileKey(filename))?.modifiedTime ?? 0,
};

// ─── Mock setup ────────────────────────────────────────────────────────────

const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xa1);
// Two independent Portable Backup Keys standing in for two devices that hold
// DIFFERENT Recovery Phrases (device A vs a wrong phrase). Same key on two
// devices ⇒ same phrase ⇒ restore works; different key ⇒ auth-tag failure.
const PORTABLE_KEY_A = new Uint8Array(32).fill(0x11);
const PORTABLE_KEY_B = new Uint8Array(32).fill(0x22);

let cloud: CloudProviderSurface;

beforeAll(async () => {
  await mock.module('@solidarity/nitro-keystone', () => ({
    getCloudKit: () => FakeCloudKit,
  }));
  await mock.module('react-native', () => ({
    ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
      .__AIRMEISHI_RN_MOCK__),
    Platform: { OS: 'ios', select: <T,>(o: { ios?: T; android?: T; default?: T }) =>
      o.ios ?? o.default },
  }));
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => FIXED_MASTER_KEY,
    resetMasterKeyForTesting: async () => undefined,
    evictMasterKeyCache: () => undefined,
  }));
  // Install a REAL AES-GCM encryption manager for the Device Storage Key path
  // (backupManager's v1 legacy decrypt + any sibling that imports it). The
  // portable v2 path uses jsonCrypto's explicit-key helpers directly (real, not
  // mocked). `MockDecryptError` matches the real class's `.name` so
  // backupManager's duck-type (`err.name === 'DecryptError'`) still classifies.
  class MockDecryptError extends Error {
    constructor(message = 'decrypt-failed', options?: { cause?: unknown }) {
      super(message, options);
      this.name = 'DecryptError';
    }
  }
  await mock.module('@/storage/encryptionManager', () => ({
    DecryptError: MockDecryptError,
    encryptJson: async (value: unknown) => {
      const sealed = aesGcmSeal(FIXED_MASTER_KEY, utf8ToBytes(JSON.stringify(value)));
      return base64Encode(sealed);
    },
    decryptJson: async <T,>(blob: string): Promise<T> => {
      const sealed = base64Decode(blob);
      let opened: Uint8Array;
      try {
        opened = aesGcmOpen(FIXED_MASTER_KEY, sealed);
      } catch (cause) {
        throw new MockDecryptError('decrypt-failed', { cause });
      }
      return JSON.parse(bytesToUtf8(opened)) as T;
    },
  }));

  cloud = await import('../../src/backup/cloudProvider');
});

beforeEach(() => {
  fakeFiles.clear();
  evicted.clear();
  downloadPolls.clear();
  reads.length = 0;
  starts.length = 0;
  activeProvider = 'iCloud';
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

describe('iCloud backup round trip — portable SOLB v2 archive across devices', () => {
  it('writes a v2 portable archive that is ciphertext (never plaintext) on disk', async () => {
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);

    const stored = Array.from(fakeFiles.values())[0]?.content ?? '';
    expect(stored.length).toBeGreaterThan(0);
    expect(stored).not.toContain('Ada Lovelace');
    expect(stored).not.toContain('Aurora');

    const archive = await cloud.downloadLatestArchive();
    expect(archive).not.toBeNull();
    // The reader pins the key scheme; new writes are always v2 (portable).
    expect(archive?.keyScheme).toBe('recovery-phrase-hkdf-v1');
  });

  it('device B with the SAME Portable Backup Key restores the full payload', async () => {
    const payload = makeFullPayload();
    await cloud.uploadBackup(payload, PORTABLE_KEY_A);

    // Device B: fresh install, different Device Storage Key — but the same
    // Recovery Phrase ⇒ the same Portable Backup Key derived independently.
    const archive = await cloud.downloadLatestArchive();
    expect(archive).not.toBeNull();
    const restored = decryptJsonWithKey<SwiftCompatibleBackupData>(
      PORTABLE_KEY_A,
      archive!.ciphertextB64
    );
    expect(JSON.stringify(restored.businessCards)).toBe(JSON.stringify(payload.businessCards));
    expect(JSON.stringify(restored.contacts)).toBe(JSON.stringify(payload.contacts));
    expect(JSON.stringify(restored.groups)).toBe(JSON.stringify(payload.groups));
    expect(JSON.stringify(restored.identityKeyWrapper)).toBe(
      JSON.stringify(payload.identityKeyWrapper)
    );
  });

  it('device B with a DIFFERENT Recovery Phrase fails the auth tag (typed DecryptError, no plaintext)', async () => {
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    const archive = await cloud.downloadLatestArchive();
    expect(archive).not.toBeNull();
    expect(() => decryptJsonWithKey(PORTABLE_KEY_B, archive!.ciphertextB64)).toThrow(DecryptError);
  });

  it('downloadLatestArchive() returns null when no file exists (fresh device)', async () => {
    expect(await cloud.downloadLatestArchive()).toBeNull();
  });

  it('picks the NEWEST archive when several exist', async () => {
    const older = makeFullPayload();
    await cloud.uploadBackup(older, PORTABLE_KEY_A);
    const newer = { ...makeFullPayload(), timestamp: '2026-06-01T00:00:00Z' };
    await cloud.uploadBackup(newer, PORTABLE_KEY_A);

    const archive = await cloud.downloadLatestArchive();
    const restored = decryptJsonWithKey<SwiftCompatibleBackupData>(
      PORTABLE_KEY_A,
      archive!.ciphertextB64
    );
    expect(restored.timestamp).toBe('2026-06-01T00:00:00Z');
  });

  it('backupMtime() reports the cloud-side timestamp after upload', async () => {
    expect(await cloud.backupMtime()).toBeNull();
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    const after = await cloud.backupMtime();
    expect(after).toBeInstanceOf(Date);
  });

  it('listBackupArchives returns dated rows newest-first with the format version', async () => {
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    await new Promise((r) => setTimeout(r, 2)); // distinct ms filenames
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);

    // Inject a legacy v1 (device-key) archive + a corrupt file alongside.
    fakeFiles.set('iCloud:backup_1500000000000.solbk', {
      content: encodeSolb(encryptJsonWithKey(FIXED_MASTER_KEY, makeFullPayload()), 1),
      modifiedTime: 1_500_000_000_000,
    });
    fakeFiles.set('iCloud:backup_1400000000000.solbk', {
      content: 'bm90LWEtc29sYi1maWxl', // "not-a-solb-file" — header decode fails
      modifiedTime: 1_400_000_000_000,
    });

    const list = await cloud.listBackupArchives();
    expect(list.length).toBe(4);
    // Newest first.
    const stamps = list.map((a) => a.timestampMs);
    expect([...stamps].sort((x, y) => y - x)).toEqual(stamps);
    // The two fresh uploads are portable v2.
    expect(list[0]?.version).toBe(2);
    expect(list[1]?.version).toBe(2);
    // The injected legacy + corrupt files are classified, not hidden.
    expect(list.find((a) => a.name === 'backup_1500000000000.solbk')?.version).toBe(1);
    expect(list.find((a) => a.name === 'backup_1400000000000.solbk')?.version).toBeNull();
  });

  it('downloadArchive(name) restores a SPECIFIC older archive (explicit choice, no silent fallback)', async () => {
    const older = { ...makeFullPayload(), timestamp: '2026-05-01T00:00:00Z' };
    await cloud.uploadBackup(older, PORTABLE_KEY_A);
    await new Promise((r) => setTimeout(r, 2));
    await cloud.uploadBackup({ ...makeFullPayload(), timestamp: '2026-06-01T00:00:00Z' }, PORTABLE_KEY_A);

    const list = await cloud.listBackupArchives();
    const oldest = list[list.length - 1]!;
    const archive = await cloud.downloadArchive(oldest.name);
    const restored = decryptJsonWithKey<SwiftCompatibleBackupData>(
      PORTABLE_KEY_A,
      archive.ciphertextB64
    );
    expect(restored.timestamp).toBe('2026-05-01T00:00:00Z');
  });

  it('lists an archive iCloud has not delivered yet as cloud-only, without reading its header', async () => {
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    await new Promise((r) => setTimeout(r, 2));
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    const [newest, older] = (await cloud.listBackupArchives()).map((a) => a.name);
    if (!newest || !older) throw new Error('expected two archives');
    evicted.add(older);
    reads.length = 0;

    const list = await cloud.listBackupArchives();
    expect(list.find((a) => a.name === newest)).toMatchObject({ availability: 'ready', version: 2 });
    // Cold row is listed honestly — not as "Unrecognized format" — and tappable.
    expect(list.find((a) => a.name === older)).toMatchObject({
      availability: 'cloud-only',
      version: null,
      percent: null,
    });
    // Listing must neither read nor start a transfer for a cold row: that is
    // the user's tap, not a side effect of opening History.
    expect(reads).not.toContain(older);
    expect(starts).toEqual([]);
  });

  it('reading an undelivered archive fails as pending and names the archive', async () => {
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    const [only] = await cloud.listBackupArchives();
    if (!only) throw new Error('expected an archive');
    evicted.add(only.name);

    const specific = await cloud.downloadArchive(only.name).catch((e: unknown) => e);
    expect(specific).toBeInstanceOf(ArchiveDownloadPendingError);
    expect((specific as ArchiveDownloadPendingError).archiveName).toBe(only.name);
    const latest = await cloud.downloadLatestArchive().catch((e: unknown) => e);
    expect(latest).toBeInstanceOf(ArchiveDownloadPendingError);
    expect((latest as ArchiveDownloadPendingError).archiveName).toBe(only.name);
  });

  it('ensureArchiveDownloaded drives the transfer, reports progress, and leaves the archive readable', async () => {
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);
    const [only] = await cloud.listBackupArchives();
    if (!only) throw new Error('expected an archive');
    evicted.add(only.name);

    const progress: (number | null)[] = [];
    await cloud.ensureArchiveDownloaded(only.name, {
      pollMs: 5,
      onProgress: (p) => { progress.push(p.percent); },
    });
    expect(starts).toEqual([only.name]);
    expect(progress).toEqual([null, 50]);
    const archive = await cloud.downloadArchive(only.name);
    expect(archive.keyScheme).toBe('recovery-phrase-hkdf-v1');
    expect((await cloud.listBackupArchives())[0]).toMatchObject({ availability: 'ready', version: 2 });
  });

  it('Google Drive provider isolates files from iCloud (cross-provider safety)', async () => {
    cloud.setProvider('iCloud');
    activeProvider = 'iCloud';
    await cloud.uploadBackup(makeFullPayload(), PORTABLE_KEY_A);

    cloud.setProvider('googleDrive');
    activeProvider = 'googleDrive';
    expect(await cloud.downloadLatestArchive()).toBeNull();

    cloud.setProvider('iCloud');
    activeProvider = 'iCloud';
    expect(await cloud.downloadLatestArchive()).not.toBeNull();
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
    handlers: {
      readonly onStart?: () => void;
      readonly onComplete?: (payload: unknown) => void;
      readonly onError?: (err: unknown) => void;
    }
  ) => { readonly onEnd: (cb: (e: GestureEvent) => void) => unknown };
}

describe('iCloud backup — gesture-triggered (pull-down pan)', () => {
  let gestureMod: GestureModule;
  let prefsStore: { setState: (partial: Partial<Preferences>) => void } | null = null;

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
    // backupManager now reads usePreferences (→ mmkv) and routes gesture
    // backups through the coordinated requestBackup, which gates on
    // backupEnabled. Mock mmkv and enable backup so the pull-down fires.
    const prefKv = new Map<string, string>();
    await mock.module('@/storage/mmkv', () => ({
      getMmkv: () => ({
        getString: (k: string): string | undefined => prefKv.get(k),
        set: (k: string, v: string): void => { prefKv.set(k, v); },
        remove: (k: string): void => { prefKv.delete(k); },
        // getAllKeys keeps the REAL storageManager.listKeys() safe if
        // backupManager was already cached with it (full-suite module order),
        // so performBackupNow loads an empty card/contact set instead of throwing.
        getAllKeys: (): string[] => Array.from(prefKv.keys()),
      }),
    }));
    gestureMod = await import('../../src/backup/gestureAutoBackup');

    // requestBackup now resolves the Portable Backup Key before writing, so a
    // gesture backup needs a provisioned Recovery Phrase. Inject one via
    // rootKey's DI hook (reset in afterAll so it can't leak into other suites).
    const rootKey = await import('@/identity/rootKey');
    rootKey.__setRootKeyStorageForTesting({
      getMnemonic: async () =>
        'legal winner thank year wave sausage worth useful legal winner thank yellow',
      setMnemonic: async () => undefined,
      deleteMnemonic: async () => undefined,
    });

    // Enable backup AFTER importing gestureAutoBackup so backupManager's
    // usePreferences binding (same '@/settings/preferences' singleton) is
    // already established — otherwise requestBackup('gesture') self-gates on
    // the default backupEnabled:false and the pull-down never fires.
    const { usePreferences } = await import('@/settings/preferences');
    prefsStore = usePreferences;
    usePreferences.setState({
      backupEnabled: true,
      autoBackupOnPull: true,
      backupProvider: 'iCloud',
    });
    // A device with NOTHING to back up now skips instead of writing an empty
    // archive that would rotate away the archives still holding real data, so
    // give this one a single portable record. `set` (not `setState`) is what
    // persists to `prefs:v1`, which is where the snapshot reads it from.
    usePreferences.getState().set('shareEmail', true);
  });

  afterAll(async () => {
    // usePreferences is a process-global singleton; reset the enabled flag so
    // this suite doesn't bleed backupEnabled:true into later tests
    // (e.g. preferencesKeys.parity asserts the Swift default stays false).
    prefsStore?.setState({
      backupEnabled: false,
      autoBackupOnPull: true,
      backupProvider: 'iCloud',
      shareEmail: false,
    });
    // Reset the rootKey storage DI so the injected phrase can't leak.
    const rootKey = await import('@/identity/rootKey');
    rootKey.__setRootKeyStorageForTesting(null);
  });

  it('triggers backup when translationY exceeds the 80px threshold', async () => {
    let completedPayload: unknown = null;
    const gesture = gestureMod.makeGestureAutoBackup({
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
    await new Promise((r) => setTimeout(r, 200));
    expect(completedPayload).not.toBeNull();
  });

  it('cooldown prevents thrashing (a second pull within 30s is a no-op)', async () => {
    let calls = 0;
    const ghMod = await import('react-native-gesture-handler') as unknown as {
      __getPendingOnEnd: () => ((e: GestureEvent) => void) | null;
    };
    gestureMod.makeGestureAutoBackup({
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

  it('restoring an archive iCloud has not delivered yet fails as download-pending, naming it', async () => {
    const manager = await import('../../src/backup/backupManager');
    const name = 'backup_1700000005000.solbk';
    fakeFiles.set(`iCloud:${name}`, {
      content: encodeSolb(encryptJsonWithKey(PORTABLE_KEY_A, makeFullPayload()), 2),
      modifiedTime: 1_700_000_005_000,
    });
    evicted.add(name);

    for (const attempt of [manager.restoreFromBackup(name), manager.restoreFromBackup()]) {
      const failure = await attempt.catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(manager.BackupRestoreError);
      const typed = failure as { readonly kind: string; readonly archiveName?: string };
      // Not "unreadable": the UI can show the transfer and retry once it lands.
      expect(typed.kind).toBe('download-pending');
      expect(typed.archiveName).toBe(name);
    }
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
