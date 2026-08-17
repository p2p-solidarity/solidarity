/**
 * Vault file storage — encrypt + write to expo-file-system, read + decrypt.
 *
 * Pipeline:
 *   write : pickedURI → readBytes → aesGcmSeal(masterKey, bytes) → write to documentDir/vault/<id>.enc
 *   read  : read documentDir/vault/<id>.enc → aesGcmOpen → caller receives Uint8Array
 *
 * Encryption uses the same master key as MMKV (single key for the whole
 * device). Per-item derivation can come later (HKDF off masterKey + id)
 * if we want crypto-shredded delete; today `remove()` just unlinks the file.
 */
// v56 split the API: the legacy `documentDirectory` + `writeAsStringAsync`
// helpers live behind `/legacy`. The new File/Directory class API ships at
// the root export; we'll migrate when there's time.
import * as FileSystem from 'expo-file-system/legacy';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToHex,
  sha256Bytes,
} from '@solidarity/shared';

import { getMasterKey } from '@/storage/secureMasterKey';
import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from '@/storage/deletionResult';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  quiesceLocalDataOperations,
  trackLocalDataOperation,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

const VAULT_DIR = `${FileSystem.documentDirectory ?? ''}vault/`;

function localDataWipeError(): Error {
  return new Error('Vault file write was invalidated by a local data wipe');
}

async function ensureDir(writeEpoch: LocalDataEpoch): Promise<void> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  const info = await FileSystem.getInfoAsync(VAULT_DIR);
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(VAULT_DIR, { intermediates: true });
    if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  }
}

/** Encrypt + persist; returns the encryptedPath, size, sha256-hex of plaintext. */
export function writeVaultBlob(
  id: string,
  plaintextBase64: string
): Promise<{ encryptedPath: string; size: number; checksumSha256: string }> {
  return trackLocalDataOperation(
    writeVaultBlobAtEpoch(id, plaintextBase64, captureLocalDataEpoch()),
  );
}

async function writeVaultBlobAtEpoch(
  id: string,
  plaintextBase64: string,
  writeEpoch: LocalDataEpoch,
): Promise<{ encryptedPath: string; size: number; checksumSha256: string }> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  await ensureDir(writeEpoch);
  const plaintext = base64Decode(plaintextBase64);
  const masterKey = await getMasterKey();
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  const sealed = aesGcmSeal(masterKey, plaintext);
  const encryptedPath = `${VAULT_DIR}${id}.enc`;
  await FileSystem.writeAsStringAsync(encryptedPath, base64Encode(sealed), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  return {
    encryptedPath,
    size: plaintext.length,
    checksumSha256: bytesToHex(sha256Bytes(plaintext)),
  };
}

/** Read + decrypt; returns the original bytes. */
export async function readVaultBlob(encryptedPath: string): Promise<Uint8Array> {
  const sealedB64 = await FileSystem.readAsStringAsync(encryptedPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const masterKey = await getMasterKey();
  return aesGcmOpen(masterKey, base64Decode(sealedB64));
}

/** Best-effort delete; ignores missing-file. */
export async function deleteVaultBlob(encryptedPath: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(encryptedPath);
  if (info.exists) await FileSystem.deleteAsync(encryptedPath, { idempotent: true });
}

/**
 * Strict production wipe for every encrypted vault blob.
 *
 * The target is resolved from Expo's document directory in-process and is
 * never accepted from a caller. A missing document root or filesystem error
 * is a typed failure so the wipe coordinator keeps the encryption keys and
 * can be retried safely.
 */
export async function deleteVaultDirectory(): Promise<LocalDeletionResult> {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) return deletionFailed();

  const vaultDirectory = `${documentDirectory}vault/`;
  try {
    await quiesceLocalDataOperations();
    const info = await FileSystem.getInfoAsync(vaultDirectory);
    if (info.exists) {
      await FileSystem.deleteAsync(vaultDirectory, { idempotent: true });
    }
    return deletionSucceeded();
  } catch {
    return deletionFailed();
  }
}
