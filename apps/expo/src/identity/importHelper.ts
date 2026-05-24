/**
 * IdentityImportHelper — TS port of
 * solidarity/Services/Identity/IdentityImportHelper.swift +
 * the password-encrypted blob format used by the multi-device migration
 * flow.
 *
 * Blob wire layout (cross-platform — Swift will adopt the same layout in
 * its next release so iOS-exported blobs import on Expo and vice versa):
 *
 *   magic[4]      "SOLI"
 *   version[1]    0x01
 *   salt[16]      PBKDF2 salt
 *   iters[4 BE]   PBKDF2 iteration count (uint32, big-endian)
 *   payload[..]   AES-256-GCM combined (nonce(12) || ciphertext || tag(16))
 *                 of the UTF-8 JSON snapshot below
 *
 * Payload schema (JSON, sorted keys):
 *   {
 *     version: 1,
 *     issuedAt: ISO8601,
 *     activeDid: string | null,
 *     identityCards: IdentityCardEntity[],
 *     provableClaims: ProvableClaimEntity[],
 *     storedCredentials: StoredCredential[]
 *   }
 *
 * The hardware-backed signing key is intentionally NOT included. Importing
 * restores VC + claim snapshots; the signing key (and therefore the DID)
 * stays bound to the device's Secure Enclave / StrongBox, matching the
 * Swift KeychainService behaviour where the master alias never leaves
 * iCloud Keychain.
 */
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToUtf8,
  err,
  ok,
  utf8ToBytes,
  type CardError,
  type Result,
} from '@solidarity/shared';

import { useCredentialStore, type StoredCredential } from '@/credentials/store';

import { useIdentityCoordinator } from './coordinator';
import { useIdentityData } from './dataStore';
import type { IdentityCardEntity, ProvableClaimEntity } from './entities';

export type IdentityError = CardError;

const MAGIC = utf8ToBytes('SOLI');
const VERSION = 0x01;
const SALT_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + 4;
const DEFAULT_ITERATIONS = 210_000;
const KEY_LEN = 32;

interface SerializedIdentityCard
  extends Omit<IdentityCardEntity, 'issuedAt' | 'expiresAt' | 'createdAt' | 'updatedAt'> {
  readonly issuedAt: string;
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SerializedProvableClaim
  extends Omit<ProvableClaimEntity, 'lastPresentedAt' | 'createdAt' | 'updatedAt'> {
  readonly lastPresentedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface SerializedStoredCredential
  extends Omit<StoredCredential, 'issuedAt' | 'expiresAt'> {
  readonly issuedAt: string;
  readonly expiresAt?: string;
}

interface IdentitySnapshot {
  readonly version: 1;
  readonly issuedAt: string;
  readonly activeDid: string | null;
  readonly identityCards: readonly SerializedIdentityCard[];
  readonly provableClaims: readonly SerializedProvableClaim[];
  readonly storedCredentials: readonly SerializedStoredCredential[];
}

function serializeCard(c: IdentityCardEntity): SerializedIdentityCard {
  return {
    ...c,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString(),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function deserializeCard(s: SerializedIdentityCard): IdentityCardEntity {
  return {
    ...s,
    issuedAt: new Date(s.issuedAt),
    expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  };
}

function serializeClaim(c: ProvableClaimEntity): SerializedProvableClaim {
  return {
    ...c,
    lastPresentedAt: c.lastPresentedAt?.toISOString(),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function deserializeClaim(s: SerializedProvableClaim): ProvableClaimEntity {
  return {
    ...s,
    lastPresentedAt: s.lastPresentedAt ? new Date(s.lastPresentedAt) : undefined,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  };
}

function serializeCredential(c: StoredCredential): SerializedStoredCredential {
  return {
    ...c,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString(),
  };
}

function deserializeCredential(s: SerializedStoredCredential): StoredCredential {
  return {
    ...s,
    issuedAt: new Date(s.issuedAt),
    expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined,
  };
}

function writeUint32BE(value: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen: KEY_LEN,
  });
}

async function buildSnapshot(): Promise<IdentitySnapshot> {
  await useIdentityData.getState().hydrate();
  await useCredentialStore.getState().hydrate();
  const identityState = useIdentityData.getState();
  const credentialState = useCredentialStore.getState();
  const coordinator = useIdentityCoordinator.getState();
  return {
    version: 1,
    issuedAt: new Date().toISOString(),
    activeDid: coordinator.profile.activeDID?.did ?? null,
    identityCards: identityState.identityCards.map(serializeCard),
    provableClaims: identityState.provableClaims.map(serializeClaim),
    storedCredentials: credentialState.items.map(serializeCredential),
  };
}

export async function exportIdentityBlob(opts: {
  password: string;
  iterations?: number;
}): Promise<Result<string, IdentityError>> {
  if (!opts.password || opts.password.length < 8) {
    return err<IdentityError>({
      type: 'validationError',
      message: 'Identity export password must be at least 8 characters',
    });
  }
  try {
    const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
    const snapshot = await buildSnapshot();
    const salt = randomBytes(SALT_LEN);
    const key = await deriveKey(opts.password, salt, iterations);
    const ciphertext = aesGcmSeal(key, utf8ToBytes(JSON.stringify(snapshot)));
    const blob = new Uint8Array(HEADER_LEN + ciphertext.length);
    blob.set(MAGIC, 0);
    blob[MAGIC.length] = VERSION;
    blob.set(salt, MAGIC.length + 1);
    blob.set(writeUint32BE(iterations), MAGIC.length + 1 + SALT_LEN);
    blob.set(ciphertext, HEADER_LEN);
    return ok(base64Encode(blob));
  } catch (error) {
    return err<IdentityError>({
      type: 'encryptionError',
      message: `Failed to export identity blob: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function importIdentityBlob(
  blob: string,
  opts: { password: string }
): Promise<Result<{ readonly did: string | null; readonly restoredCount: number }, IdentityError>> {
  try {
    const bytes = base64Decode(blob);
    if (bytes.length < HEADER_LEN + 12 + 16) {
      return err<IdentityError>({ type: 'invalidData', message: 'Identity blob too short' });
    }
    for (let i = 0; i < MAGIC.length; i++) {
      if (bytes[i] !== MAGIC[i]) {
        return err<IdentityError>({ type: 'invalidData', message: 'Identity blob magic mismatch' });
      }
    }
    const version = bytes[MAGIC.length];
    if (version !== VERSION) {
      return err<IdentityError>({
        type: 'invalidData',
        message: `Unsupported identity blob version: ${String(version)}`,
      });
    }
    const salt = bytes.subarray(MAGIC.length + 1, MAGIC.length + 1 + SALT_LEN);
    const iterations = readUint32BE(bytes, MAGIC.length + 1 + SALT_LEN);
    if (iterations < 1000) {
      return err<IdentityError>({ type: 'invalidData', message: 'Identity blob iteration count too low' });
    }
    const ciphertext = bytes.subarray(HEADER_LEN);
    const key = await deriveKey(opts.password, salt, iterations);
    let plaintext: Uint8Array;
    try {
      plaintext = aesGcmOpen(key, ciphertext);
    } catch {
      return err<IdentityError>({ type: 'encryptionError', message: 'Identity blob decryption failed' });
    }
    const snapshot = JSON.parse(bytesToUtf8(plaintext)) as IdentitySnapshot;
    if (snapshot.version !== 1) {
      return err<IdentityError>({
        type: 'invalidData',
        message: `Unsupported snapshot version: ${String(snapshot.version)}`,
      });
    }

    await useIdentityData.getState().hydrate();
    await useCredentialStore.getState().hydrate();

    let restored = 0;
    const cards = snapshot.identityCards ?? [];
    for (const raw of cards) {
      await useIdentityData.getState().upsertIdentityCard(deserializeCard(raw));
      restored++;
    }
    const claims = snapshot.provableClaims ?? [];
    for (const raw of claims) {
      await useIdentityData.getState().upsertProvableClaim(deserializeClaim(raw));
      restored++;
    }
    const credentials = snapshot.storedCredentials ?? [];
    for (const raw of credentials) {
      await useCredentialStore.getState().add(deserializeCredential(raw));
      restored++;
    }
    return ok({ did: snapshot.activeDid ?? null, restoredCount: restored });
  } catch (error) {
    return err<IdentityError>({
      type: 'invalidData',
      message: `Failed to import identity blob: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
