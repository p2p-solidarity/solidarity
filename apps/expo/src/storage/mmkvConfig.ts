import { base64UrlEncode, sha256Bytes } from '@solidarity/shared';

export const MMKV_INSTANCE_ID = 'solidarity';

export interface MmkvStorageConfig {
  readonly id: string;
  readonly encryptionKey: string;
  readonly encryptionType: 'AES-256';
}

export function createMmkvConfig(masterKey: Uint8Array): MmkvStorageConfig {
  // MMKV v4 validates string byte length. A base64 32-byte master key is
  // 44 chars, so derive a stable 32-char ASCII key for AES-256.
  return {
    id: MMKV_INSTANCE_ID,
    encryptionKey: base64UrlEncode(sha256Bytes(masterKey)).slice(0, 32),
    encryptionType: 'AES-256',
  };
}
