import { businessCardSchema, contactSchema } from '@solidarity/shared';
import { claimSchema, credentialSchema, identityCardSchema, validatePortableData } from './portableData';
/**
 * normalizeRestoredPayload — shape-validate a decrypted Backup Archive before
 * restore touches it.
 *
 * Root cause this fixes (build 155 crash, 2026-07-16 device report): the
 * restore path iterated `payload.cards` / `payload.contacts` with NO schema
 * validation. A SwiftUI-era `BackupData` archive uses DIFFERENT field names
 * (`businessCards` / `timestamp` / `version` vs the Expo `BackupPayload`'s
 * `cards` / `exportedAt` / `schemaVersion`), so a successfully-decrypted Swift
 * archive (legacy Device Storage Key recovered via `tryRecoverLegacyMasterKey`
 * or a Quick Start keychain migration) crashed Hermes with
 * `TypeError: Cannot convert undefined value to object` — a `for...of` over
 * `undefined` — instead of restoring.
 *
 * Pure function over `unknown` (module imports types only), so it is
 * unit-testable with zero mocks. Returns `null` when the payload is not an
 * object at all — the caller maps that to `BackupRestoreError('unreadable')`.
 * Every array field is defaulted to `[]`; Swift aliases are accepted:
 *   cards      ← `cards` (Expo) or `businessCards` (Swift BackupData)
 *   exportedAt ← `exportedAt` (Expo) or `timestamp` (Swift BackupData)
 */
import type { IdentityCardEntity, ProvableClaimEntity } from '../identity/entities';
import type { StoredCredential } from '../credentials/store';
import type { BackupPayload } from './backupManager';

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeRestoredPayload(raw: unknown): BackupPayload | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (Object.hasOwn(o, 'schemaVersion') && o['schemaVersion'] !== 3 && o['schemaVersion'] !== 4) {
    throw new Error('unsupported-backup-schema');
  }
  return {
    schemaVersion: o['schemaVersion'] === 4 ? 4 : 3,
    ...(o['schemaVersion'] === 4 ? { portableData: validatePortableData(o['portableData']) } : {}),
    exportedAt:
      typeof o['exportedAt'] === 'string'
        ? o['exportedAt']
        : typeof o['timestamp'] === 'string'
          ? o['timestamp']
          : '',
    provider: (o['provider'] === 'googleDrive' ? 'googleDrive' : 'iCloud'),
    cards: asArray(o['cards'] ?? o['businessCards']).map((value) => businessCardSchema.parse(value)),
    contacts: asArray(o['contacts']).map((value) => contactSchema.parse(value)),
    identityCards: asArray(o['identityCards']).map((value) =>
      identityCardSchema.parse(value) as IdentityCardEntity),
    provableClaims: asArray(o['provableClaims']).map((value) =>
      claimSchema.parse(value) as ProvableClaimEntity),
    storedCredentials: asArray(o['storedCredentials']).map((value) =>
      credentialSchema.parse(value) as StoredCredential),
  };
}
