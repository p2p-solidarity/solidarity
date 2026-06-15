/**
 * Nitro spec — nfc-passport (ICAO 9303 passport reader)
 *
 * Reads DG1/DG2/DG14/DG15/SOD via BAC + PACE + passive auth.
 * Mirrors Swift NFCPassportReaderService.swift surface.
 *
 *   iOS    : HybridNfcPassport.swift wraps NFCPassportReader (AndyQ).
 *   Android: HybridNfcPassport.kt wraps jmrtd via JNI.
 *
 * Nested object types are extracted to top-level interfaces because
 * Nitrogen rejects anonymous inline structs (it can't codegen the C++).
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface PassportMRZ {
  /** Document number, with check digit included. */
  readonly documentNumber: string;
  /** YYMMDD. */
  readonly dateOfBirth: string;
  /** YYMMDD. */
  readonly dateOfExpiry: string;
}

export interface ParsedMrz {
  readonly nationality: string;
  readonly documentNumber: string;
  readonly name: string;
  readonly dateOfBirth: string;
  readonly dateOfExpiry: string;
  readonly gender: string;
}

export interface DataGroupsBundle {
  readonly dg1?: ArrayBuffer;
  /** Face image (JPEG2000 / JPEG). */
  readonly dg2?: ArrayBuffer;
  /** Chip Authentication (CA) public key. */
  readonly dg14?: ArrayBuffer;
  /** Active Authentication (AA) public key. */
  readonly dg15?: ArrayBuffer;
  /** Security Object document (SHA-256-signed DG hashes). */
  readonly sod?: ArrayBuffer;
}

export interface PassportReadResult {
  readonly mrz: ParsedMrz;
  readonly dataGroups: DataGroupsBundle;
  readonly chipUid?: string;
  readonly passiveAuthValid: boolean;
  /**
   * Complete passport-noir 0.3.0 OpenAC v3 witness bundle, produced by the
   * native NFC/passport layer after it has parsed SOD/DSC/CSCA, revocation,
   * AA, and holder-binding material. JS treats this as opaque JSON and only
   * passes it to the v3 prover; missing means the app must fail closed to
   * fallback rather than synthesize legacy disclosure inputs.
   */
  readonly openAcV3WitnessBundleJson?: string;
  /**
   * DG15 Active Authentication evidence, JSON
   * `{ challengeB64, signatureRawB64 }`:
   *   - `challengeB64`     — base64 of the 32-byte SHA-256 digest the chip's
   *                          AA key signed (the circuit's `aa_challenge`).
   *   - `signatureRawB64`  — base64 of the raw 64-byte `r ‖ s` ECDSA-P256
   *                          signature from INTERNAL AUTHENTICATE.
   * Present only when the chip performed ECDSA-P256 Active Authentication
   * (the only AA variant the OpenAC v3 circuit verifies). Absent for RSA-AA
   * or AA-less passports, in which case a `requireAA` proof fails closed.
   */
  readonly activeAuthJson?: string;
}

/**
 * Phases of an NFC passport read, ordered roughly by time:
 *   `connecting`  — waiting for the chip / tag-found
 *   `authenticating` — BAC + PACE handshake (~5-30%)
 *   `reading-dg` — streaming a Data Group (each DG fires its own range)
 *   `verifying`   — passive auth / signature checks
 *   `done`        — successful read
 *   `error`       — terminal error (also resolved/rejected on the promise)
 */
export type NfcReadPhase =
  | 'connecting'
  | 'authenticating'
  | 'reading-dg'
  | 'verifying'
  | 'done'
  | 'error';

export interface NfcReadProgress {
  readonly phase: NfcReadPhase;
  /** 0..100 — best-effort. Some phases only have step transitions. */
  readonly percent: number;
  /** When phase=`reading-dg`, the active DG label ("DG1", "DG2", ...). */
  readonly dataGroup?: string;
  /** Human-readable copy native already shows on the system NFC sheet. */
  readonly message?: string;
}

/**
 * Per-read options. All fields are optional so existing callers (incl.
 * legacy `read(mrz)` shape from earlier Nitrogen builds) keep working —
 * Nitrogen treats `read(mrz)` as `read(mrz, undefined)` when the second
 * arg is not provided.
 */
export interface NfcReadOptions {
  /**
   * Skip DG2 (the face JPEG, ~15-30KB, ~3-5 sec NFC transfer). Default
   * `false` keeps parity with the legacy Swift app; the Expo flow passes
   * `true` because the JS pipeline only consumes DG1 today, and skipping
   * DG2 cuts a real read from ~5-8s down to ~1.5-3s.
   */
  readonly skipFaceImage?: boolean;
  /**
   * Progress callback fired from the native NFCPassportReader /
   * jmrtd hooks (iOS: `customDisplayMessage`; Android: a polled
   * progress listener). Fires on the JS thread. Treat as fire-and-forget
   * — the read still settles on the returned Promise regardless of
   * whether the callback is provided.
   */
  readonly onProgress?: (event: NfcReadProgress) => void;
}

export interface NfcPassport
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  isAvailable(): boolean;
  /**
   * Returns the bundled OpenAC v3 DSC revocation snapshot JSON.
   *
   * The native layer only exposes the build-time artifact. It does not fetch,
   * mutate, or synthesize revocation data. Missing resources throw so callers
   * can fail closed instead of treating an empty revocation set as valid.
   */
  getRevocationSnapshotJson(): string;
  read(mrz: PassportMRZ, options?: NfcReadOptions): Promise<PassportReadResult>;
  cancel(): void;
}
