/**
 * @solidarity/nitro-keystone — public entrypoint.
 *
 * The device trust foundation, merged from the former nitro-secrets-vault,
 * nitro-spruce-did and nitro-cloudkit packages (2.0.0 nitro convergence):
 *
 *   - SecretsVault — hardware-backed root-secret wrapping. iOS: Secure
 *     Enclave P-256 ECIES (AES-GCM seal). Android: Keystore AES-GCM with
 *     StrongBox (TEE fallback).
 *   - SpruceDid — Secure Enclave / AndroidKeyStore P-256 signing keys +
 *     JWS (ES256) for DID operations.
 *   - CloudKit — cloud file backup. iOS: iCloud Drive ubiquity container.
 *     Android: Google Drive REST.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject
 * adapters are auto-registered; each getter lazily creates its singleton so
 * importing the package doesn't crash where the native module isn't linked
 * (web preview, bun tests without the JSI bridge).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { CloudKit } from './specs/CloudKit.nitro';
import type { SecretsVault } from './specs/SecretsVault.nitro';
import type { SpruceDid } from './specs/SpruceDid.nitro';

export type {
  SecretsVault,
  WrappedSecret,
  EnsureWrappingKeyResult,
} from './specs/SecretsVault.nitro';

export type {
  SpruceDid,
  SpruceDidEvent,
  SpruceDidEventKind,
} from './specs/SpruceDid.nitro';

export type {
  CloudKit,
  CloudKitRecord,
  CloudKitShareInvite,
  CloudKitEvent,
  CloudKitEventKind,
} from './specs/CloudKit.nitro';

let cachedSecretsVault: SecretsVault | null = null;

export function getSecretsVault(): SecretsVault {
  if (cachedSecretsVault) return cachedSecretsVault;
  cachedSecretsVault = NitroModules.createHybridObject<SecretsVault>('SecretsVault');
  return cachedSecretsVault;
}

let cachedSpruceDid: SpruceDid | null = null;

export function getSpruceDid(): SpruceDid {
  if (cachedSpruceDid) return cachedSpruceDid;
  cachedSpruceDid = NitroModules.createHybridObject<SpruceDid>('SpruceDid');
  return cachedSpruceDid;
}

let cachedCloudKit: CloudKit | null = null;

export function getCloudKit(): CloudKit {
  if (cachedCloudKit) return cachedCloudKit;
  cachedCloudKit = NitroModules.createHybridObject<CloudKit>('CloudKit');
  return cachedCloudKit;
}
