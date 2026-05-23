/**
 * Nitro spec — nfc-passport (ICAO 9303 passport reader)
 *
 * Reads DG1/DG2/DG14/DG15/SOD via BAC + PACE + passive auth.
 * Mirrors Swift NFCPassportReaderService.swift surface.
 *
 *   iOS    : HybridNfcPassport.swift wraps NFCPassportReader (AndyQ).
 *   Android: HybridNfcPassport.kt wraps jmrtd via JNI.
 *
 * The MRZ used to derive BAC/PACE keys is composed externally (the
 * caller already has it from MRZScanner). DG content stays as ArrayBuffer
 * so callers can route the raw bytes into the ZK pipeline without copy.
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

export interface PassportReadResult {
  readonly mrz: {
    readonly nationality: string;
    readonly documentNumber: string;
    readonly name: string;
    readonly dateOfBirth: string;
    readonly dateOfExpiry: string;
    readonly gender: string;
  };
  readonly dataGroups: {
    readonly dg1?: ArrayBuffer;
    /** Face image (JPEG2000 / JPEG). */
    readonly dg2?: ArrayBuffer;
    /** Chip Authentication (CA) public key. */
    readonly dg14?: ArrayBuffer;
    /** Active Authentication (AA) public key. */
    readonly dg15?: ArrayBuffer;
    /** Security Object document (SHA-256-signed DG hashes). */
    readonly sod?: ArrayBuffer;
  };
  readonly chipUid?: string;
  readonly passiveAuthValid: boolean;
}

export interface NfcPassport
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  isAvailable(): boolean;
  read(mrz: PassportMRZ): Promise<PassportReadResult>;
  cancel(): void;
}
