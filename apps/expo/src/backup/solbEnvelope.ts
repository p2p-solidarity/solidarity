/**
 * SOLB envelope — the 5-byte header the legacy Swift app prepends to every
 * encrypted backup file (`solidarity/Services/Backup/BackupManager.swift`):
 *
 *   "SOLB" (0x53 0x4F 0x4C 0x42) || version (0x01) || AES-GCM(ciphertext)
 *
 * The Expo encryption manager emits Swift-compatible base64 of the bare
 * AES-GCM blob (`nonce||ct||tag`). We frame it with the SOLB header here so
 * the bytes we write to `backup_<ts>.solbk` are byte-identical to the Swift
 * format — a user migrating from the SwiftUI app keeps their backups, and a
 * Swift build can read ours.
 *
 * Pure functions over base64 strings (the Nitro bridge passes file bytes as
 * base64). Fully unit-testable with no native module.
 */
import { base64Decode, base64Encode } from '@solidarity/shared';

const SOLB_MAGIC = [0x53, 0x4f, 0x4c, 0x42] as const; // "SOLB"
const SOLB_VERSION = 0x01;
const HEADER_LEN = SOLB_MAGIC.length + 1;
const OPEN_BRACE = 0x7b; // '{' — start of a legacy plaintext JSON backup

/** Frame a base64 AES-GCM ciphertext into a base64 SOLB file blob. */
export function encodeSolb(ciphertextB64: string): string {
  const ct = base64Decode(ciphertextB64);
  const out = new Uint8Array(HEADER_LEN + ct.length);
  out[0] = SOLB_MAGIC[0];
  out[1] = SOLB_MAGIC[1];
  out[2] = SOLB_MAGIC[2];
  out[3] = SOLB_MAGIC[3];
  out[4] = SOLB_VERSION;
  out.set(ct, HEADER_LEN);
  return base64Encode(out);
}

/**
 * Validate + strip the SOLB header from a base64 file blob, returning the
 * base64 AES-GCM ciphertext for `decryptJson`. Mirrors Swift `decodeBackup`:
 * unknown version, legacy plaintext, and bad magic each throw.
 */
export function decodeSolb(fileB64: string): string {
  const raw = base64Decode(fileB64);
  const hasMagic =
    raw.length >= HEADER_LEN &&
    raw[0] === SOLB_MAGIC[0] &&
    raw[1] === SOLB_MAGIC[1] &&
    raw[2] === SOLB_MAGIC[2] &&
    raw[3] === SOLB_MAGIC[3];

  if (hasMagic) {
    const version = raw[4];
    if (version !== SOLB_VERSION) {
      throw new Error(`Unsupported backup version: ${String(version)}`);
    }
    return base64Encode(raw.subarray(HEADER_LEN));
  }

  // A bare '{' is a legacy plaintext backup — refuse to silently load PII.
  if (raw[0] === OPEN_BRACE) {
    throw new Error(
      'Legacy plaintext backup detected and refused. Re-create the backup to upgrade to the encrypted format.'
    );
  }

  throw new Error('Unrecognized backup format');
}
