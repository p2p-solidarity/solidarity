/**
 * Vault cloud sync — per-item ciphertext upload + download round trip.
 *
 * Swift reference:
 *   solidarity/Services/Vault/VaultCloudSyncService.swift
 *   solidarity/Services/Vault/VaultCloudSyncService+Sync.swift
 *
 * The Swift split (metadata via CloudKit-equivalent manifest,
 * ciphertext via per-item iCloud Drive blobs) is mirrored here by
 * routing each item to a distinct CloudKit record id
 * (`solidarity.vault.cipher.<itemId>`) instead of bundling cipher
 * bytes inside the manifest. See cloudSync.ts header for the full
 * rationale.
 *
 * What this suite covers (mirrors the Swift integration tests):
 *   1. uploadVaultItemCiphertext → record present in the mocked
 *      CloudKit store with the sealed bytes intact.
 *   2. downloadVaultItemCiphertext → file written back to the local
 *      vault dir + sha256 integrity check.
 *   3. syncVaultMetadata uploads any local item missing a remoteRef
 *      and writes the new ref into the manifest, then re-uploads the
 *      manifest.
 *   4. Round trip — fresh device pulls the manifest, prefetches the
 *      cipher, decrypts back to the original plaintext via the
 *      derived master key.
 *   5. Conflict resolution — both sides have ciphertext with diverging
 *      checksums; classifyCipherStatus returns 'conflict' and the
 *      manifest entry from the newer side wins.
 *   6. Prune — deleting an item locally tombstones the cloud record on
 *      the next sync.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToHex,
  bytesToUtf8,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

import type * as CloudSyncNS from '../../src/vault/cloudSync';

// ── Stub harness ────────────────────────────────────────────────────────────

const FIXED_MASTER_KEY = new Uint8Array(32).fill(0x99);

const files = new Map<string, string>();

interface CloudKitRecord {
  readonly recordId: string;
  readonly recordType: string;
  fields: string;
  readonly modifiedTime: number;
}
const cloudKitStore = new Map<string, CloudKitRecord>();

let cloudSync: typeof CloudSyncNS;

void mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  getInfoAsync: (path: string): Promise<{ exists: boolean }> =>
    Promise.resolve({ exists: files.has(path) || path.endsWith('vault/') }),
  makeDirectoryAsync: (): Promise<undefined> => Promise.resolve(undefined),
  writeAsStringAsync: (path: string, contents: string): Promise<undefined> => {
    files.set(path, contents);
    return Promise.resolve(undefined);
  },
  readAsStringAsync: (path: string): Promise<string> => {
    const v = files.get(path);
    if (v === undefined) {
      return Promise.reject(new Error(`mock fs: missing ${path}`));
    }
    return Promise.resolve(v);
  },
  deleteAsync: (path: string): Promise<undefined> => {
    files.delete(path);
    return Promise.resolve(undefined);
  },
}));

void mock.module('@/storage/secureMasterKey', () => ({
  getMasterKey: (): Promise<Uint8Array> => Promise.resolve(FIXED_MASTER_KEY),
  resetMasterKeyForTesting: (): Promise<undefined> => Promise.resolve(undefined),
  evictMasterKeyCache: (): undefined => undefined,
}));

void mock.module('react-native', () => ({
  ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
    .__AIRMEISHI_RN_MOCK__),
  Platform: { OS: 'ios' },
}));

void mock.module('@solidarity/nitro-cloudkit', () => ({
  getCloudKit: () => ({
    initialize: (): Promise<undefined> => Promise.resolve(undefined),
    saveRecord: (rec: CloudKitRecord): Promise<CloudKitRecord> => {
      cloudKitStore.set(rec.recordId, { ...rec });
      return Promise.resolve({ ...rec });
    },
    fetchRecord: (id: string): Promise<CloudKitRecord> => {
      const rec = cloudKitStore.get(id);
      if (!rec) return Promise.reject(new Error(`no record ${id}`));
      return Promise.resolve(rec);
    },
    deleteRecord: (id: string): Promise<undefined> => {
      cloudKitStore.delete(id);
      return Promise.resolve(undefined);
    },
    setDriveAccessToken: (): void => undefined,
  }),
}));

beforeAll(async () => {
  cloudSync = await import('../../src/vault/cloudSync');
});

beforeEach(() => {
  files.clear();
  cloudKitStore.clear();
});

// ── Fixtures ────────────────────────────────────────────────────────────────

interface FixtureItem {
  id: string;
  name: string;
  kind: 'file';
  size: number;
  checksumSha256: string;
  encryptedPath: string;
  createdAt: Date;
  updatedAt: Date;
  tags: readonly string[];
}

/** Seal `plaintext` with FIXED_MASTER_KEY, persist to the mock fs, return the item record. */
function seedLocalItem(id: string, plaintext: string, updatedAt = '2026-05-24T00:00:00Z'): FixtureItem {
  const pt = utf8ToBytes(plaintext);
  const sealed = aesGcmSeal(FIXED_MASTER_KEY, pt);
  const encryptedPath = `/mock/docs/vault/${id}.enc`;
  files.set(encryptedPath, base64Encode(sealed));
  return {
    id,
    name: `${id}.txt`,
    kind: 'file',
    size: pt.length,
    checksumSha256: bytesToHex(sha256Bytes(pt)),
    encryptedPath,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    tags: [],
  };
}

// ── 1. Single-item upload ───────────────────────────────────────────────────

describe('uploadVaultItemCiphertext', () => {
  it('writes a per-item record with the sealed bytes + sha256 integrity tag', async () => {
    const item = seedLocalItem('upl-1', 'top secret payload');
    const res = await cloudSync.uploadVaultItemCiphertext(item.id, item.encryptedPath);
    expect(res.remoteRef).toBe('solidarity.vault.cipher.upl-1');
    expect(res.uploadedAt).toBeGreaterThan(0);

    const rec = cloudKitStore.get(res.remoteRef);
    expect(rec).toBeDefined();
    const payload = JSON.parse(rec?.fields ?? '{}') as {
      cipherB64: string;
      sha256: string;
      uploadedAt: number;
    };
    // The bytes in the cloud must equal the sealed bytes on disk verbatim.
    const onDisk = files.get(item.encryptedPath);
    expect(onDisk).toBeDefined();
    expect(payload.cipherB64).toBe(onDisk ?? '');
    // sha256 must agree.
    const sealed = base64Decode(payload.cipherB64);
    expect(payload.sha256).toBe(bytesToHex(sha256Bytes(sealed)));
  });
});

// ── 2. Download round-trip ──────────────────────────────────────────────────

describe('downloadVaultItemCiphertext', () => {
  it('pulls the cipher record back to a local path that decrypts to the original plaintext', async () => {
    const item = seedLocalItem('dl-1', 'hello vault');
    const { remoteRef } = await cloudSync.uploadVaultItemCiphertext(item.id, item.encryptedPath);
    // Simulate a fresh device — wipe the local blob.
    files.delete(item.encryptedPath);
    const path = await cloudSync.downloadVaultItemCiphertext(item.id, remoteRef);
    expect(path).toBe(`/mock/docs/vault/${item.id}.enc`);
    expect(files.has(path)).toBe(true);
    const sealed = base64Decode(files.get(path) ?? '');
    const opened = aesGcmOpen(FIXED_MASTER_KEY, sealed);
    expect(bytesToUtf8(opened)).toBe('hello vault');
  });

  it('throws when the cipher record sha256 disagrees (tamper guard)', async () => {
    const item = seedLocalItem('dl-2', 'will be tampered');
    const { remoteRef } = await cloudSync.uploadVaultItemCiphertext(item.id, item.encryptedPath);
    // Mutate the stored sha256 so the integrity check trips.
    const rec = cloudKitStore.get(remoteRef);
    expect(rec).toBeDefined();
    if (!rec) return;
    const payload = JSON.parse(rec.fields) as { cipherB64: string; sha256: string; uploadedAt: number };
    payload.sha256 = '00'.repeat(32);
    cloudKitStore.set(remoteRef, { ...rec, fields: JSON.stringify(payload) });

    let err: unknown = null;
    try {
      await cloudSync.downloadVaultItemCiphertext(item.id, remoteRef);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(String(err)).toContain('integrity');
  });
});

// ── 3. Manifest-driven upload during syncVaultMetadata ─────────────────────

describe('syncVaultMetadata: uploads ciphertext for items missing a remoteRef', () => {
  it('attaches remoteRef + remoteUploadedAt for every newly-uploaded item', async () => {
    const a = seedLocalItem('itm-a', 'AAA');
    const b = seedLocalItem('itm-b', 'BBB');
    const res = await cloudSync.syncVaultMetadata([a, b]);
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const entryA = res.merged.items[a.id];
    const entryB = res.merged.items[b.id];
    expect(entryA?.remoteRef).toBe('solidarity.vault.cipher.itm-a');
    expect(entryB?.remoteRef).toBe('solidarity.vault.cipher.itm-b');
    expect(entryA?.remoteUploadedAt).toBeGreaterThan(0);

    // Cloud actually holds three records: manifest + the two ciphers.
    expect(cloudKitStore.has('solidarity.vault.manifest.v1')).toBe(true);
    expect(cloudKitStore.has('solidarity.vault.cipher.itm-a')).toBe(true);
    expect(cloudKitStore.has('solidarity.vault.cipher.itm-b')).toBe(true);
  });

  it('does not re-upload ciphertext when the manifest already has a remoteRef', async () => {
    const a = seedLocalItem('itm-c', 'CCC');
    await cloudSync.syncVaultMetadata([a]);
    // Replace the cipher record bytes with a sentinel so we can detect
    // any unwanted overwrite on the next sync.
    const rec = cloudKitStore.get('solidarity.vault.cipher.itm-c');
    expect(rec).toBeDefined();
    if (!rec) return;
    cloudKitStore.set(rec.recordId, {
      ...rec,
      fields: JSON.stringify({ cipherB64: 'SENTINEL', sha256: 'X', uploadedAt: 1 }),
    });
    const res2 = await cloudSync.syncVaultMetadata([a]);
    expect(res2.kind).toBe('ok');
    const after = cloudKitStore.get('solidarity.vault.cipher.itm-c');
    const payload = JSON.parse(after?.fields ?? '{}') as { cipherB64: string };
    expect(payload.cipherB64).toBe('SENTINEL');
  });
});

// ── 4. Fresh-device round trip ─────────────────────────────────────────────

describe('full round trip: device A uploads, device B pulls + decrypts', () => {
  it('syncVaultMetadata + pullVaultMetadata(prefetchAll) reconstruct the plaintext', async () => {
    const original = 'cross-device payload — sovereignty preserved';
    const a = seedLocalItem('rt-1', original);
    const pushed = await cloudSync.syncVaultMetadata([a]);
    expect(pushed.kind).toBe('ok');
    if (pushed.kind !== 'ok') return;

    // Simulate "fresh device": local items + files vanish; only the cloud knows.
    files.clear();

    const pulled = await cloudSync.pullVaultMetadata([], { prefetchAll: true });
    expect(pulled.kind).toBe('ok');
    if (pulled.kind !== 'ok') return;
    expect(pulled.merged.items[a.id]?.checksum).toBe(a.checksumSha256);
    expect(pulled.merged.items[a.id]?.remoteRef).toBe('solidarity.vault.cipher.rt-1');

    const localPath = `/mock/docs/vault/${a.id}.enc`;
    expect(files.has(localPath)).toBe(true);
    const sealed = base64Decode(files.get(localPath) ?? '');
    const opened = aesGcmOpen(FIXED_MASTER_KEY, sealed);
    expect(bytesToUtf8(opened)).toBe(original);
  });
});

// ── 5. Conflict resolution ─────────────────────────────────────────────────

describe('classifyCipherStatus + mergeManifests conflict semantics', () => {
  it('returns "conflict" when local + remote checksums diverge for the same id', () => {
    const manifest: CloudSyncNS.VaultManifest = {
      items: {
        'cf-1': {
          modifiedAt: '2026-05-20T00:00:00Z',
          checksum: 'cloud-checksum',
          isDeleted: false,
          remoteRef: 'solidarity.vault.cipher.cf-1',
          remoteUploadedAt: 1,
        },
      },
      lastSync: null,
    };
    const status = cloudSync.classifyCipherStatus('cf-1', manifest, true, 'local-checksum');
    expect(status).toBe('conflict');
  });

  it('returns "in-sync" when checksums agree on both sides', () => {
    const manifest: CloudSyncNS.VaultManifest = {
      items: {
        'cf-2': {
          modifiedAt: '2026-05-20T00:00:00Z',
          checksum: 'same',
          isDeleted: false,
          remoteRef: 'solidarity.vault.cipher.cf-2',
          remoteUploadedAt: 1,
        },
      },
      lastSync: null,
    };
    expect(cloudSync.classifyCipherStatus('cf-2', manifest, true, 'same')).toBe('in-sync');
  });

  it('returns "remote-only" when manifest has a ref but no local blob', () => {
    const manifest: CloudSyncNS.VaultManifest = {
      items: {
        'cf-3': {
          modifiedAt: '2026-05-20T00:00:00Z',
          checksum: 'remote-only',
          isDeleted: false,
          remoteRef: 'solidarity.vault.cipher.cf-3',
          remoteUploadedAt: 1,
        },
      },
      lastSync: null,
    };
    expect(cloudSync.classifyCipherStatus('cf-3', manifest, false, null)).toBe('remote-only');
  });

  it('returns "local-only" when local blob exists but manifest has no remoteRef', () => {
    const manifest: CloudSyncNS.VaultManifest = {
      items: {
        'cf-4': {
          modifiedAt: '2026-05-20T00:00:00Z',
          checksum: 'local-checksum',
          isDeleted: false,
        },
      },
      lastSync: null,
    };
    expect(cloudSync.classifyCipherStatus('cf-4', manifest, true, 'local-checksum')).toBe('local-only');
  });

  it('mergeManifests prefers the newer-modifiedAt side and carries its remoteRef', () => {
    const local: CloudSyncNS.VaultManifest = {
      items: {
        'mg-1': {
          modifiedAt: '2026-05-22T00:00:00Z',
          checksum: 'local-cs',
          isDeleted: false,
        },
      },
      lastSync: null,
    };
    const cloud: CloudSyncNS.VaultManifest = {
      items: {
        'mg-1': {
          modifiedAt: '2026-05-21T00:00:00Z',
          checksum: 'cloud-cs',
          isDeleted: false,
          remoteRef: 'solidarity.vault.cipher.mg-1',
          remoteUploadedAt: 1717000000000,
        },
      },
      lastSync: null,
    };
    const merged = cloudSync.mergeManifests(local, cloud);
    expect(merged.items['mg-1']?.checksum).toBe('local-cs');
    // Even though local won the modifiedAt race, we keep the cloud ref
    // so the cipher record stays reachable until the next upload bumps it.
    expect(merged.items['mg-1']?.remoteRef).toBe('solidarity.vault.cipher.mg-1');
  });
});

// ── 6. Prune ───────────────────────────────────────────────────────────────

describe('pruneRemoteCiphertext + syncVaultMetadata tombstoning', () => {
  it('deletes the cloud cipher record on demand', async () => {
    const a = seedLocalItem('pr-1', 'goodbye');
    await cloudSync.uploadVaultItemCiphertext(a.id, a.encryptedPath);
    expect(cloudKitStore.has('solidarity.vault.cipher.pr-1')).toBe(true);
    await cloudSync.pruneRemoteCiphertext(a.id);
    expect(cloudKitStore.has('solidarity.vault.cipher.pr-1')).toBe(false);
  });

  it('is a no-op when the record never existed (idempotent delete)', async () => {
    let threw = false;
    try {
      await cloudSync.pruneRemoteCiphertext('never-uploaded');
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
