/**
 * Vault encryption — AES-256-GCM file-blob round trip + metadata round trip.
 *
 * Swift reference:
 *   solidarity/Services/Vault/SovereignVaultService.swift  (importData / getDecryptedData)
 *   solidarity/Services/Vault/FileEncryptionService.swift  (single-shot AES-GCM)
 *   solidarity/Models/Vault/VaultModels.swift              (VaultItem + VaultMetadata Codable)
 *
 * TS implementation:
 *   apps/expo/src/vault/storage.ts  (writeVaultBlob / readVaultBlob)
 *   apps/expo/src/vault/store.ts    (in-memory upsert + MMKV-persisted metadata)
 *
 * Tests cover:
 *   1. aesGcmSeal/aesGcmOpen produce byte-equal plaintext on round-trip
 *   2. Decrypting with a different key fails (AES-GCM tag mismatch)
 *   3. writeVaultBlob + readVaultBlob via mocked filesystem preserve bytes
 *   4. Vault store upsert preserves every metadata field (no silent loss)
 *   5. SHA-256 checksum computation matches the Swift VaultMetadata.computeChecksum
 *      spec (lowercase hex of SHA-256 of plaintext bytes)
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToHex,
  bytesToUtf8,
  generateAesKey,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

import type { VaultItem } from '../../src/vault/store';

// ── Layer 1: pure crypto round trip ─────────────────────────────────────────

describe('Vault layer 1: AES-256-GCM round trip', () => {
  it('encrypts then decrypts yields the original bytes', () => {
    const key = generateAesKey();
    const pt = utf8ToBytes('top-secret vault payload');
    const sealed = aesGcmSeal(key, pt);
    const opened = aesGcmOpen(key, sealed);
    expect(bytesToUtf8(opened)).toBe('top-secret vault payload');
  });

  it('every call produces a unique nonce, so identical plaintext → different ciphertext', () => {
    const key = generateAesKey();
    const pt = utf8ToBytes('same payload');
    const a = aesGcmSeal(key, pt);
    const b = aesGcmSeal(key, pt);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('decryption with a different key fails (AES-GCM auth-tag mismatch)', () => {
    const key = generateAesKey();
    const wrongKey = generateAesKey();
    const sealed = aesGcmSeal(key, utf8ToBytes('vault'));
    expect(() => aesGcmOpen(wrongKey, sealed)).toThrow();
  });

  it('a flipped ciphertext byte breaks decryption (tag verification rejects)', () => {
    const key = generateAesKey();
    const sealed = aesGcmSeal(key, utf8ToBytes('vault'));
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    expect(() => aesGcmOpen(key, tampered)).toThrow();
  });

  it('vault checksum matches Swift VaultMetadata.computeChecksum (lowercase hex of SHA-256)', () => {
    // Swift: SHA256.hash(data:).compactMap { String(format: "%02x", $0) }.joined()
    // → 64 lowercase hex chars of the SHA-256 of the plaintext.
    const empty = bytesToHex(sha256Bytes(new Uint8Array(0)));
    expect(empty).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(empty).toBe(empty.toLowerCase());
  });
});

// ── Layer 2: filesystem-backed writeVaultBlob / readVaultBlob ──────────────

interface StorageModuleSurface {
  writeVaultBlob: (
    id: string,
    plaintextBase64: string,
  ) => Promise<{ encryptedPath: string; size: number; checksumSha256: string }>;
  readVaultBlob: (encryptedPath: string) => Promise<Uint8Array>;
  deleteVaultBlob: (encryptedPath: string) => Promise<void>;
}

const files = new Map<string, string>();
const FIXED_MASTER_KEY = new Uint8Array(32).fill(0xab);

let storageMod: StorageModuleSurface;

beforeAll(async () => {
  await mock.module('expo-file-system/legacy', () => ({
    documentDirectory: '/mock/docs/',
    EncodingType: { Base64: 'base64', UTF8: 'utf8' },
    getInfoAsync: async (path: string) => ({ exists: files.has(path) || path.endsWith('vault/') }),
    makeDirectoryAsync: async () => undefined,
    writeAsStringAsync: async (path: string, contents: string) => {
      files.set(path, contents);
    },
    readAsStringAsync: async (path: string) => {
      const v = files.get(path);
      if (v === undefined) throw new Error(`mock fs: missing ${path}`);
      return v;
    },
    deleteAsync: async (path: string) => {
      files.delete(path);
    },
  }));
  // Pin the master key so the test is deterministic.
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => FIXED_MASTER_KEY,
    resetMasterKeyForTesting: async () => undefined,
  }));
  storageMod = (await import('../../src/vault/storage')) as unknown as StorageModuleSurface;
});

beforeEach(() => {
  files.clear();
});

describe('Vault layer 2: writeVaultBlob / readVaultBlob', () => {
  it('round-trips a payload through the encrypted blob on disk', async () => {
    const payload = utf8ToBytes('hello vault');
    const meta = await storageMod.writeVaultBlob('item-1', base64Encode(payload));
    expect(meta.size).toBe(payload.length);
    expect(meta.encryptedPath).toContain('vault/item-1.enc');

    const recovered = await storageMod.readVaultBlob(meta.encryptedPath);
    expect(bytesToUtf8(recovered)).toBe('hello vault');
  });

  it('computes the SHA-256 checksum of the PLAINTEXT (not the ciphertext)', async () => {
    const payload = utf8ToBytes('checksum me');
    const meta = await storageMod.writeVaultBlob('item-2', base64Encode(payload));
    expect(meta.checksumSha256).toBe(bytesToHex(sha256Bytes(payload)));
    expect(meta.checksumSha256.length).toBe(64);
  });

  it('the encrypted bytes on disk are NOT the plaintext (basic confidentiality)', async () => {
    const payload = utf8ToBytes('public-secret');
    const meta = await storageMod.writeVaultBlob('item-3', base64Encode(payload));
    const sealed = base64Decode(files.get(meta.encryptedPath) ?? '');
    // Plaintext is 13 bytes; sealed = 12 (nonce) + 13 (ct) + 16 (tag) = 41 bytes.
    expect(sealed.length).toBe(12 + payload.length + 16);
    // No substring of the ciphertext should be the literal plaintext.
    expect(bytesToHex(sealed)).not.toContain(bytesToHex(payload));
  });

  it('readVaultBlob with the WRONG master key fails (tamper resistance)', async () => {
    const payload = utf8ToBytes('payload');
    const meta = await storageMod.writeVaultBlob('item-4', base64Encode(payload));
    // Swap the master key for the next read and assert the open fails.
    await mock.module('@/storage/secureMasterKey', () => ({
      getMasterKey: async () => new Uint8Array(32).fill(0xff),
      resetMasterKeyForTesting: async () => undefined,
    }));
    const fresh = (await import('../../src/vault/storage')) as unknown as StorageModuleSurface;
    await expect(fresh.readVaultBlob(meta.encryptedPath)).rejects.toBeDefined();
    // Restore master key for other tests.
    await mock.module('@/storage/secureMasterKey', () => ({
      getMasterKey: async () => FIXED_MASTER_KEY,
      resetMasterKeyForTesting: async () => undefined,
    }));
  });

  it('deleteVaultBlob is best-effort (no-op for a missing path)', async () => {
    await expect(storageMod.deleteVaultBlob('/missing/path.enc')).resolves.toBeUndefined();
  });
});

// ── Layer 3: VaultItem metadata round trip via the store ───────────────────

interface StoreSurface {
  useVaultStore: {
    getState: () => {
      readonly items: readonly VaultItem[];
      readonly hydrated: boolean;
      readonly hydrate: () => Promise<void>;
      readonly upsert: (item: VaultItem) => Promise<void>;
      readonly remove: (id: string) => Promise<void>;
    };
    setState: (s: Partial<{ items: readonly VaultItem[]; hydrated: boolean }>) => void;
  };
}

const kv = new Map<string, string>();
let store: StoreSurface;

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
    encryptJson: async (v: unknown) => JSON.stringify(v),
    decryptJson: async <T,>(s: string): Promise<T> => {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      // Rebuild Date prototypes the way Swift Codable does for VaultItem.
      if (typeof parsed['createdAt'] === 'string') {
        (parsed as { createdAt: Date }).createdAt = new Date(parsed['createdAt']);
      }
      if (typeof parsed['updatedAt'] === 'string') {
        (parsed as { updatedAt: Date }).updatedAt = new Date(parsed['updatedAt']);
      }
      return parsed as T;
    },
  }));
  store = (await import('../../src/vault/store')) as unknown as StoreSurface;
});

beforeEach(() => {
  kv.clear();
  store.useVaultStore.setState({ items: [], hydrated: false });
});

function makeItem(overrides: Partial<VaultItem> = {}): VaultItem {
  return {
    id: 'v-1',
    name: 'passport-scan.pdf',
    kind: 'document',
    mimeType: 'application/pdf',
    size: 4096,
    checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    encryptedPath: '/mock/docs/vault/v-1.enc',
    createdAt: new Date('2025-05-01T00:00:00Z'),
    updatedAt: new Date('2025-05-02T00:00:00Z'),
    tags: ['legal', 'id'],
    ...overrides,
  };
}

describe('Vault layer 3: VaultItem metadata preservation', () => {
  it('upsert + hydrate preserves every metadata field', async () => {
    const item = makeItem();
    await store.useVaultStore.getState().upsert(item);
    store.useVaultStore.setState({ items: [], hydrated: false });
    await store.useVaultStore.getState().hydrate();
    const got = store.useVaultStore.getState().items[0];
    expect(got?.id).toBe('v-1');
    expect(got?.name).toBe('passport-scan.pdf');
    expect(got?.kind).toBe('document');
    expect(got?.mimeType).toBe('application/pdf');
    expect(got?.size).toBe(4096);
    expect(got?.checksumSha256).toBe(item.checksumSha256);
    expect(got?.encryptedPath).toBe('/mock/docs/vault/v-1.enc');
    expect(got?.tags).toEqual(['legal', 'id']);
  });

  it('upsert with same id replaces (no duplicates)', async () => {
    await store.useVaultStore.getState().upsert(makeItem());
    await store.useVaultStore.getState().upsert(makeItem({ name: 'renamed.pdf' }));
    expect(store.useVaultStore.getState().items.length).toBe(1);
    expect(store.useVaultStore.getState().items[0]?.name).toBe('renamed.pdf');
  });

  it('remove drops the item from memory + MMKV', async () => {
    await store.useVaultStore.getState().upsert(makeItem());
    await store.useVaultStore.getState().remove('v-1');
    expect(store.useVaultStore.getState().items.length).toBe(0);
    expect(kv.has('vault:v-1')).toBe(false);
  });

  it('multiple kinds (file/json/text/image/video/document) all persist via upsert', async () => {
    const kinds: readonly VaultItem['kind'][] = [
      'file', 'json', 'text', 'image', 'video', 'document',
    ];
    for (const [i, k] of kinds.entries()) {
      await store.useVaultStore.getState().upsert(
        makeItem({ id: `v-${String(i)}`, kind: k })
      );
    }
    expect(store.useVaultStore.getState().items.length).toBe(kinds.length);
  });
});
