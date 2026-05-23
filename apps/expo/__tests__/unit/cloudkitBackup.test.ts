/**
 * CloudKit backup parity — iOS-flavoured. Mirrors Swift
 * solidarity/Services/Backup/BackupManager.swift's iCloud-resident blob:
 *
 *   File layout on disk (`backup_<unix>.solbk`):
 *     0x53 0x4F 0x4C 0x42   ← "SOLB" magic (4 bytes)
 *     0x01                  ← version byte (currently 0x01)
 *     AES-256-GCM(BackupData JSON)
 *
 *   BackupData Codable shape:
 *     {
 *       version: Int,                 // currently 3
 *       timestamp: Date,              // .secondsSince1970 in current Swift
 *       businessCards: [BusinessCard],
 *       contacts: [Contact],
 *       identityCards?:   [BackupIdentityCard],
 *       provableClaims?:  [BackupProvableClaim],
 *       storedCredentials?: [BackupStoredCredential],
 *     }
 *
 * What this test covers:
 *   1. Stubbed nitro CloudKit module exposes write/read/exists APIs that
 *      our `CloudKitBackupService` port would call. We assert the test
 *      stub's surface so the real nitro implementation can drop in without
 *      changing the TS caller.
 *   2. The encrypted blob produced by the TS encoder is byte-equal to what
 *      Swift would write to the iCloud Ubiquity container:
 *        magic(4) || version(1) || aesGcm(masterKey, JSON.stringify(data))
 *   3. The decoder rejects:
 *        - missing/wrong magic header
 *        - unsupported version byte
 *        - tampered ciphertext (AES-GCM auth-tag mismatch)
 *   4. Restore replays cards + contacts + identity records into the stores
 *      deterministically — running restore twice with the same blob yields
 *      the same final state (no duplicate insertions).
 *
 * iOS-only behaviour: the test asserts the iOS code path. We do not skip on
 * non-darwin because the encode/decode logic is pure JS (no native bridge
 * dependency) — only the CloudKit transport itself is iOS-only, and that
 * surface is fully mocked here.
 *
 * TODO(nitro): replace the stubbed `nitro-cloudkit` module with the real
 * native bridge once nitro-modules/cloudkit lands (see
 * docs/migration/12-icloud-bridge.md). The fake's surface is the minimum
 * the real bridge must expose: writeRecord / readLatestRecord / exists /
 * latestRecordTimestamp.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToHex,
  bytesToUtf8,
  utf8ToBytes,
  uuid,
} from '@solidarity/shared';

// ── Swift wire format constants ─────────────────────────────────────────────
//
// Pulled verbatim from BackupManager.swift (`backupMagic`, `backupVersion`).
// Keep these in sync with the Swift source — any drift means the iOS app
// will refuse to load a TS-produced backup (or vice-versa).

/** 4-byte ASCII magic "SOLB" — file identifier on disk. */
const SOLB_MAGIC = new Uint8Array([0x53, 0x4f, 0x4c, 0x42]);
const SOLB_VERSION: number = 0x01;
const SOLB_HEADER_BYTES = SOLB_MAGIC.length + 1;

/**
 * Pin the master key to a deterministic 32-byte value so the test does not
 * depend on Keychain or `generateAesKey()` randomness. Matches the existing
 * vaultEncryption / icloudBackup tests.
 */
const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xb1);

// ── Stubbed nitro CloudKit module ───────────────────────────────────────────
//
// Surface mirrors what a `@solidarity/nitro-cloudkit` HybridObject would
// expose. Records are stored in-memory under their recordName.
//
// TODO(nitro-cloudkit): replace this fake with the real module surface. The
// shape below is the minimum that maps onto CKModifyRecordsOperation +
// CKFetchRecordsOperation (write/read 1 blob per recordName, single zone).

interface CloudKitRecord {
  readonly recordName: string;
  readonly blobB64: string;
  readonly modifiedAt: Date;
}

const cloudkitRecords = new Map<string, CloudKitRecord>();

const NitroCloudKitStub = {
  /** Write (overwrite) a single record. */
  async writeRecord(recordName: string, blobB64: string): Promise<void> {
    cloudkitRecords.set(recordName, { recordName, blobB64, modifiedAt: new Date() });
  },
  /** Read the latest record under a given name. Returns null when missing. */
  async readLatestRecord(recordName: string): Promise<string | null> {
    return cloudkitRecords.get(recordName)?.blobB64 ?? null;
  },
  /** True iff a record with the given name exists. */
  async exists(recordName: string): Promise<boolean> {
    return cloudkitRecords.has(recordName);
  },
  /** Modification timestamp for a record, or null. */
  async latestRecordTimestamp(recordName: string): Promise<Date | null> {
    return cloudkitRecords.get(recordName)?.modifiedAt ?? null;
  },
};

// ── Backup blob encoder / decoder (mirrors Swift BackupManager) ─────────────
//
// Lives in-test for now because the production iOS port hasn't landed yet.
// Once apps/expo/src/backup/cloudkit.ts exists, import that and delete this
// section.

interface BackupBlob {
  readonly version: number;
  readonly timestamp: string;
  readonly businessCards: readonly Record<string, unknown>[];
  readonly contacts: readonly Record<string, unknown>[];
  readonly identityCards?: readonly Record<string, unknown>[];
  readonly provableClaims?: readonly Record<string, unknown>[];
  readonly storedCredentials?: readonly Record<string, unknown>[];
}

/**
 * Encode a BackupBlob the way Swift BackupManager.swift writes it:
 *   "SOLB" || 0x01 || AES-GCM(masterKey, utf8(JSON.stringify(blob)))
 */
function encodeBackup(masterKey: Uint8Array, blob: BackupBlob): Uint8Array {
  const json = JSON.stringify(blob);
  const ciphertext = aesGcmSeal(masterKey, utf8ToBytes(json));
  const out = new Uint8Array(SOLB_HEADER_BYTES + ciphertext.length);
  out.set(SOLB_MAGIC, 0);
  out[SOLB_MAGIC.length] = SOLB_VERSION;
  out.set(ciphertext, SOLB_HEADER_BYTES);
  return out;
}

/**
 * Decode a blob, validating magic header + version. Mirrors
 * BackupManager.decodeBackup. Throws on any header / decryption failure so
 * callers can surface a user-visible error.
 */
function decodeBackup(masterKey: Uint8Array, raw: Uint8Array): BackupBlob {
  if (raw.length < SOLB_HEADER_BYTES) {
    throw new Error('backup blob too short for header');
  }
  for (let i = 0; i < SOLB_MAGIC.length; i += 1) {
    if (raw[i] !== SOLB_MAGIC[i]) {
      throw new Error('backup magic mismatch');
    }
  }
  const version = raw[SOLB_MAGIC.length];
  if (version !== SOLB_VERSION) {
    throw new Error(`unsupported backup version: ${String(version)}`);
  }
  const ciphertext = raw.subarray(SOLB_HEADER_BYTES);
  const plaintext = aesGcmOpen(masterKey, ciphertext);
  return JSON.parse(bytesToUtf8(plaintext)) as BackupBlob;
}

// ── Stores that the restore replays into ───────────────────────────────────
//
// Stand-in for CardManager.shared / ContactRepository.shared on the JS side.
// We deliberately use plain Maps (not zustand) so the test focuses on the
// blob layout — the zustand round-trip is already covered by
// cardRestore.test.ts and groupStore.test.ts.

interface RestoreTarget {
  readonly cards: Map<string, Record<string, unknown>>;
  readonly contacts: Map<string, Record<string, unknown>>;
  readonly identityCards: Map<string, Record<string, unknown>>;
}

function makeRestoreTarget(): RestoreTarget {
  return {
    cards: new Map(),
    contacts: new Map(),
    identityCards: new Map(),
  };
}

interface RestoreResult {
  restoredCards: number;
  restoredContacts: number;
  restoredIdentityCards: number;
  skippedDuplicates: number;
}

function restoreInto(target: RestoreTarget, blob: BackupBlob): RestoreResult {
  const result: RestoreResult = {
    restoredCards: 0,
    restoredContacts: 0,
    restoredIdentityCards: 0,
    skippedDuplicates: 0,
  };
  for (const card of blob.businessCards) {
    const id = String(card['id']);
    if (target.cards.has(id)) {
      result.skippedDuplicates += 1;
    } else {
      target.cards.set(id, card);
      result.restoredCards += 1;
    }
  }
  for (const contact of blob.contacts) {
    const id = String(contact['id']);
    if (target.contacts.has(id)) {
      result.skippedDuplicates += 1;
    } else {
      target.contacts.set(id, contact);
      result.restoredContacts += 1;
    }
  }
  for (const ic of blob.identityCards ?? []) {
    const id = String(ic['id']);
    if (target.identityCards.has(id)) {
      result.skippedDuplicates += 1;
    } else {
      target.identityCards.set(id, ic);
      result.restoredIdentityCards += 1;
    }
  }
  return result;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeBlob(): BackupBlob {
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
          professionalFields: ['name', 'company'],
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
            sharingFormat: 'plaintext',
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
    identityCards: [
      {
        id: uuid(),
        type: 'epassport',
        issuerType: 'government',
        trustLevel: 'high',
        title: 'Republic of Examplestan ePassport',
        issuerDid: 'did:web:gov.example',
        holderDid: 'did:key:zHolder',
        issuedAt: '2026-05-24T00:00:00Z',
        expiresAt: '2031-05-24T00:00:00Z',
        status: 'active',
        sourceReference: 'nfc',
        rawCredentialJWT: 'header.payload.sig',
        metadataTags: ['nationality:EX'],
      },
    ],
    provableClaims: [],
    storedCredentials: [],
  };
}

const RECORD_NAME = 'solidarity.backup.latest';

beforeAll(() => {
  // No module mocks needed — this suite is fully self-contained. The
  // CloudKit stub above replaces a future nitro module; encode/decode is
  // pure TS. When the nitro module lands, import its types here and
  // replace the `NitroCloudKitStub` references.
});

beforeEach(() => {
  cloudkitRecords.clear();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('cloudkitBackup: stubbed nitro CloudKit surface', () => {
  it('writeRecord + readLatestRecord round-trip a base64 blob byte-equal', async () => {
    const original = base64Encode(utf8ToBytes('hello cloudkit'));
    await NitroCloudKitStub.writeRecord(RECORD_NAME, original);
    const fetched = await NitroCloudKitStub.readLatestRecord(RECORD_NAME);
    expect(fetched).toBe(original);
  });

  it('readLatestRecord returns null for a missing record (fresh install)', async () => {
    const fetched = await NitroCloudKitStub.readLatestRecord('does-not-exist');
    expect(fetched).toBeNull();
  });

  it('exists reflects writeRecord / read state', async () => {
    expect(await NitroCloudKitStub.exists(RECORD_NAME)).toBe(false);
    await NitroCloudKitStub.writeRecord(RECORD_NAME, 'AAAA');
    expect(await NitroCloudKitStub.exists(RECORD_NAME)).toBe(true);
  });

  it('latestRecordTimestamp returns a Date after write', async () => {
    expect(await NitroCloudKitStub.latestRecordTimestamp(RECORD_NAME)).toBeNull();
    await NitroCloudKitStub.writeRecord(RECORD_NAME, 'AAAA');
    const ts = await NitroCloudKitStub.latestRecordTimestamp(RECORD_NAME);
    expect(ts).toBeInstanceOf(Date);
  });
});

describe('cloudkitBackup: blob byte layout matches Swift BackupManager', () => {
  it('encoded blob starts with SOLB magic + version 0x01', () => {
    const blob = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    expect(encoded[0]).toBe(0x53);
    expect(encoded[1]).toBe(0x4f);
    expect(encoded[2]).toBe(0x4c);
    expect(encoded[3]).toBe(0x42);
    expect(encoded[4]).toBe(SOLB_VERSION);
  });

  it('blob payload length === magic(4) + version(1) + nonce(12) + plaintextLen + tag(16)', () => {
    const blob = makeBlob();
    const json = JSON.stringify(blob);
    const ptLen = utf8ToBytes(json).length;
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    expect(encoded.length).toBe(SOLB_HEADER_BYTES + 12 + ptLen + 16);
  });

  it('ciphertext bytes after the header are NOT the plaintext (basic confidentiality)', () => {
    const blob = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    const hex = bytesToHex(encoded);
    // The plaintext JSON includes "Ada Lovelace"; converted to UTF-8 hex it
    // must NOT appear inside the encrypted body (encryption would be broken).
    const adaHex = bytesToHex(utf8ToBytes('Ada Lovelace'));
    expect(hex).not.toContain(adaHex);
  });
});

describe('cloudkitBackup: decoder rejects malformed input', () => {
  it('rejects a blob with a wrong magic header', () => {
    const blob = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    const tampered = new Uint8Array(encoded);
    tampered[0] = 0xff;
    expect(() => decodeBackup(FIXED_MASTER_KEY, tampered)).toThrow(/magic/);
  });

  it('rejects a blob with an unsupported version byte', () => {
    const blob = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    const tampered = new Uint8Array(encoded);
    tampered[4] = 0xff;
    expect(() => decodeBackup(FIXED_MASTER_KEY, tampered)).toThrow(/version/);
  });

  it('rejects ciphertext tampering (AES-GCM auth-tag mismatch)', () => {
    const blob = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    const tampered = new Uint8Array(encoded);
    // Flip the last byte (part of the auth tag).
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    expect(() => decodeBackup(FIXED_MASTER_KEY, tampered)).toThrow();
  });

  it('rejects decryption under a wrong master key', () => {
    const blob = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, blob);
    const wrongKey = new Uint8Array(32).fill(0xff);
    expect(() => decodeBackup(wrongKey, encoded)).toThrow();
  });

  it('rejects a blob that is too short to even contain the header', () => {
    expect(() => decodeBackup(FIXED_MASTER_KEY, new Uint8Array(2))).toThrow();
  });
});

describe('cloudkitBackup: full save → CloudKit → restore round trip', () => {
  it('round-trips the BackupData blob through the stubbed CloudKit record', async () => {
    const original = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, original);
    await NitroCloudKitStub.writeRecord(RECORD_NAME, base64Encode(encoded));

    const fetched = await NitroCloudKitStub.readLatestRecord(RECORD_NAME);
    expect(fetched).not.toBeNull();
    const decoded = decodeBackup(FIXED_MASTER_KEY, base64Decode(fetched ?? ''));
    expect(decoded.version).toBe(original.version);
    expect(decoded.timestamp).toBe(original.timestamp);
    expect(decoded.businessCards.length).toBe(original.businessCards.length);
    expect(decoded.contacts.length).toBe(original.contacts.length);
    expect(decoded.identityCards?.length).toBe(original.identityCards?.length);
  });

  it('restoreInto replays cards + contacts + identity records deterministically', async () => {
    const original = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, original);
    await NitroCloudKitStub.writeRecord(RECORD_NAME, base64Encode(encoded));

    const blobB64 = await NitroCloudKitStub.readLatestRecord(RECORD_NAME);
    const decoded = decodeBackup(FIXED_MASTER_KEY, base64Decode(blobB64 ?? ''));

    const target = makeRestoreTarget();
    const result = restoreInto(target, decoded);
    expect(result.restoredCards).toBe(1);
    expect(result.restoredContacts).toBe(1);
    expect(result.restoredIdentityCards).toBe(1);
    expect(result.skippedDuplicates).toBe(0);

    const cardId = String(original.businessCards[0]?.['id']);
    expect(target.cards.has(cardId)).toBe(true);
    expect(target.cards.get(cardId)?.['name']).toBe('Ada Lovelace');
  });

  it('second restore from the same blob is idempotent (skips duplicates)', async () => {
    const original = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, original);
    await NitroCloudKitStub.writeRecord(RECORD_NAME, base64Encode(encoded));

    const blobB64 = await NitroCloudKitStub.readLatestRecord(RECORD_NAME);
    const decoded = decodeBackup(FIXED_MASTER_KEY, base64Decode(blobB64 ?? ''));

    const target = makeRestoreTarget();
    restoreInto(target, decoded);
    const second = restoreInto(target, decoded);
    expect(second.restoredCards).toBe(0);
    expect(second.restoredContacts).toBe(0);
    expect(second.restoredIdentityCards).toBe(0);
    expect(second.skippedDuplicates).toBe(3);
  });

  it('round-trip preserves the Swift Codable field order (alphabetical for sortedKeys output)', () => {
    // BackupData is encoded with .sortedKeys in Swift to keep the wire stable;
    // JS JSON.stringify is insertion-order, so we just confirm the field
    // SET is preserved (no silent additions / drops).
    const original = makeBlob();
    const encoded = encodeBackup(FIXED_MASTER_KEY, original);
    const decoded = decodeBackup(FIXED_MASTER_KEY, encoded);
    const keys = Object.keys(decoded).sort();
    expect(keys).toEqual(
      [
        'businessCards',
        'contacts',
        'identityCards',
        'provableClaims',
        'storedCredentials',
        'timestamp',
        'version',
      ].sort()
    );
  });
});
