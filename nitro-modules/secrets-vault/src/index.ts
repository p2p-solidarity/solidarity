/**
 * @solidarity/nitro-secrets-vault — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject
 * adapter is auto-registered. `getSecretsVault()` returns the iOS Swift
 * impl (Secure Enclave + ECIES) or the Android Kotlin impl (Android
 * Keystore AES-GCM with StrongBox / TEE).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { SecretsVault } from './specs/SecretsVault.nitro';

export type {
  SecretsVault,
  WrappedSecret,
  EnsureWrappingKeyResult,
} from './specs/SecretsVault.nitro';

let cached: SecretsVault | null = null;

export function getSecretsVault(): SecretsVault {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<SecretsVault>('SecretsVault');
  return cached;
}
