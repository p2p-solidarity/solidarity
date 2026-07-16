/**
 * SOLB envelope — the 5-byte header prepended to every encrypted backup file:
 *
 *   "SOLB" (0x53 0x4F 0x4C 0x42) || version(1 byte) || AES-GCM(ciphertext)
 *
 * The version byte selects EXACTLY ONE key scheme (never "try keys until one
 * works"):
 *   - v1 (0x01) `device-storage-v1`      — sealed with the device-local Device
 *     Storage Key. The original SwiftUI `.solbk` format; readable here for
 *     same-device / legacy restore, but NO LONGER WRITTEN (a v1 archive can't
 *     be decrypted on another device — the key never leaves the device).
 *   - v2 (0x02) `recovery-phrase-hkdf-v1` — sealed with the Recovery-Phrase-
 *     derived Portable Backup Key (see `docs/adr/0001`), so a second device
 *     that recovers the same Recovery Phrase can decrypt it. All NEW writes are
 *     v2.
 *
 * Header integrity: the version byte lives OUTSIDE the AES-GCM ciphertext, so
 * it is framing, not authenticated data. That is safe because each version
 * maps to a DISTINCT key — flipping the version byte only changes which key is
 * tried, and the wrong key fails the GCM auth tag → a typed decrypt error. It
 * can NEVER yield plaintext under the wrong scheme, so header tampering is a
 * denial/error-class issue only, not a confidentiality/integrity break. (Codex
 * adversarial-review note, 2026-07-16.) Unknown versions fail closed.
 *
 * Pure functions over base64 strings (the Nitro bridge passes file bytes as
 * base64). Fully unit-testable with no native module.
 */
import { base64Decode, base64Encode } from '@solidarity/shared';

const SOLB_MAGIC = [0x53, 0x4f, 0x4c, 0x42] as const; // "SOLB"
const SOLB_VERSION_V1 = 0x01; // device-storage-v1
const SOLB_VERSION_V2 = 0x02; // recovery-phrase-hkdf-v1
const HEADER_LEN = SOLB_MAGIC.length + 1;
const OPEN_BRACE = 0x7b; // '{' — start of a legacy plaintext JSON backup

export type SolbVersion = 1 | 2;
export type SolbKeyScheme = 'device-storage-v1' | 'recovery-phrase-hkdf-v1';

export interface DecodedSolb {
  readonly version: SolbVersion;
  /** Which key the ciphertext MUST be opened with — the caller never guesses. */
  readonly keyScheme: SolbKeyScheme;
  /** base64 AES-GCM ciphertext (`nonce || ct || tag`). */
  readonly ciphertextB64: string;
}

const KEY_SCHEME_BY_VERSION: Record<SolbVersion, SolbKeyScheme> = {
  1: 'device-storage-v1',
  2: 'recovery-phrase-hkdf-v1',
};

const VERSION_BYTE: Record<SolbVersion, number> = {
  1: SOLB_VERSION_V1,
  2: SOLB_VERSION_V2,
};

/**
 * Frame a base64 AES-GCM ciphertext into a base64 SOLB file blob. `version`
 * defaults to 2 (the only scheme we WRITE now — the portable, cross-device
 * archive). v1 encoding exists for tests / legacy-format round-tripping.
 */
export function encodeSolb(ciphertextB64: string, version: SolbVersion = 2): string {
  const ct = base64Decode(ciphertextB64);
  const out = new Uint8Array(HEADER_LEN + ct.length);
  out[0] = SOLB_MAGIC[0];
  out[1] = SOLB_MAGIC[1];
  out[2] = SOLB_MAGIC[2];
  out[3] = SOLB_MAGIC[3];
  out[4] = VERSION_BYTE[version];
  out.set(ct, HEADER_LEN);
  return base64Encode(out);
}

/**
 * Validate + strip the SOLB header, returning the version, the key scheme it
 * pins, and the base64 AES-GCM ciphertext. Mirrors Swift `decodeBackup`:
 * unknown version, legacy plaintext, and bad magic each throw (fail closed).
 */
export function decodeSolb(fileB64: string): DecodedSolb {
  const raw = base64Decode(fileB64);
  const hasMagic =
    raw.length >= HEADER_LEN &&
    raw[0] === SOLB_MAGIC[0] &&
    raw[1] === SOLB_MAGIC[1] &&
    raw[2] === SOLB_MAGIC[2] &&
    raw[3] === SOLB_MAGIC[3];

  if (hasMagic) {
    const versionByte = raw[4];
    const version: SolbVersion | null =
      versionByte === SOLB_VERSION_V1 ? 1 : versionByte === SOLB_VERSION_V2 ? 2 : null;
    if (version === null) {
      throw new Error(`Unsupported backup version: ${String(versionByte)}`);
    }
    return {
      version,
      keyScheme: KEY_SCHEME_BY_VERSION[version],
      ciphertextB64: base64Encode(raw.subarray(HEADER_LEN)),
    };
  }

  // A bare '{' is a legacy plaintext backup — refuse to silently load PII.
  if (raw[0] === OPEN_BRACE) {
    throw new Error(
      'Legacy plaintext backup detected and refused. Re-create the backup to upgrade to the encrypted format.'
    );
  }

  throw new Error('Unrecognized backup format');
}
