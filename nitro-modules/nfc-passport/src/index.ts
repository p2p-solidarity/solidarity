/**
 * @solidarity/nitro-nfc-passport — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject
 * adapter is auto-registered. `getNfcPassport()` returns the iOS Swift impl
 * (NFCPassportReader wrap) or the Android Kotlin impl (jmrtd JNI).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { NfcPassport } from './specs/NfcPassport.nitro';

export type {
  NfcPassport,
  PassportMRZ,
  PassportReadResult,
  ParsedMrz,
  DataGroupsBundle,
} from './specs/NfcPassport.nitro';

let cached: NfcPassport | null = null;

export function getNfcPassport(): NfcPassport {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<NfcPassport>('NfcPassport');
  return cached;
}
