/**
 * BackupManager — mirrors Swift Services/Backup/BackupManager.swift.
 *
 * Bundles every locally-persisted record into a single encrypted, SOLB-framed
 * blob and writes it as a `backup_<ts>.solbk` file via the active cloud
 * provider (iCloud Drive Documents on iOS, Drive on Android). Restore is the
 * inverse: download → decrypt → upsert into the feature stores.
 *
 * Payload parity with Swift `BackupData` v3:
 *   businessCards + contacts + identityCards + provableClaims + storedCredentials
 *
 * The "SOLB" magic header is preserved (see `solbEnvelope.ts`) so the file is
 * byte-compatible with the SwiftUI app's `.solbk` files.
 *
 * Identity / credential data is gathered and restored through the feature
 * stores via dynamic import + defensive guards: a context without native MMKV
 * (unit tests) degrades to "cards + contacts only" rather than throwing.
 */
import {
  loadAllBusinessCards,
  loadAllContacts,
  saveBusinessCard,
  saveContact,
} from '../storage/storageManager';
import {
  downloadBackup,
  prepareProvider,
  setProvider,
  uploadBackup,
  type ProviderKind,
} from './cloudProvider';
import { shouldRunBackup, type BackupReason } from './backupPolicy';
import { usePreferences } from '@/settings/preferences';
import type { BusinessCard, Contact } from '@solidarity/shared';
import type { IdentityCardEntity, ProvableClaimEntity } from '../identity/entities';
import type { StoredCredential } from '../credentials/store';

export type { BackupReason } from './backupPolicy';

export interface BackupPayload {
  readonly schemaVersion: 3;
  readonly exportedAt: string;
  readonly provider: ProviderKind;
  readonly cards: readonly BusinessCard[];
  readonly contacts: readonly Contact[];
  /** Optional so a legacy v1 backup (cards + contacts only) still restores. */
  readonly identityCards?: readonly IdentityCardEntity[];
  readonly provableClaims?: readonly ProvableClaimEntity[];
  readonly storedCredentials?: readonly StoredCredential[];
}

export interface RestoreResult {
  readonly cardsRestored: number;
  readonly contactsRestored: number;
  readonly identityCardsRestored: number;
  readonly claimsRestored: number;
  readonly credentialsRestored: number;
  readonly exportedAt: string;
}

interface IdentitySnapshot {
  readonly identityCards: readonly IdentityCardEntity[];
  readonly provableClaims: readonly ProvableClaimEntity[];
  readonly storedCredentials: readonly StoredCredential[];
}

const EMPTY_IDENTITY: IdentitySnapshot = {
  identityCards: [],
  provableClaims: [],
  storedCredentials: [],
};

/** Snapshot identity cards / claims / credentials from their feature stores. */
async function gatherIdentity(): Promise<IdentitySnapshot> {
  try {
    const [{ useIdentityData }, { useCredentialStore }] = await Promise.all([
      import('../identity/dataStore'),
      import('../credentials/store'),
    ]);
    // hydrate() pulls credentials + cards + claims into memory. Idempotent;
    // throws only where native MMKV is absent (unit tests) — then we fall
    // back to whatever the in-memory state already holds.
    try {
      await useIdentityData.getState().hydrate();
    } catch {
      /* use in-memory state */
    }
    return {
      identityCards: useIdentityData.getState().identityCards,
      provableClaims: useIdentityData.getState().provableClaims,
      storedCredentials: Array.from(useCredentialStore.getState().details.values()),
    };
  } catch {
    return EMPTY_IDENTITY;
  }
}

export async function performBackupNow(provider: ProviderKind): Promise<BackupPayload> {
  const [cards, contacts, identity] = await Promise.all([
    loadAllBusinessCards(),
    loadAllContacts(),
    gatherIdentity(),
  ]);
  const payload: BackupPayload = {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    provider,
    cards,
    contacts,
    identityCards: identity.identityCards,
    provableClaims: identity.provableClaims,
    storedCredentials: identity.storedCredentials,
  };
  await uploadBackup(payload);
  return payload;
}

/** Shared cooldown for automatic backups (manual bypasses it). Matches the
 *  30s window gestureAutoBackup previously enforced on its own. */
const BACKUP_COOLDOWN_MS = 30_000;
let lastBackupAtMs: number | null = null;

export interface BackupRequestOutcome {
  readonly ran: boolean;
  readonly skipReason?: string;
  readonly payload?: BackupPayload;
}

/**
 * THE single coordinated backup entrypoint. Every trigger — manual button,
 * People pull-to-refresh, pan gesture — routes through here so the prefs
 * (enabled / pull / provider), provider selection, and the cooldown are all
 * applied in ONE place. Returns without backing up (`ran: false`) when the
 * policy says skip; only throws for a genuine upload error, never for a skip.
 *
 * This replaces the old footgun where `usePeopleScreen.refresh()` called
 * `performBackupNow(DEFAULT_PROVIDER)` unconditionally on every pull —
 * ignoring `backupEnabled`/`autoBackupOnPull`, racing the rotation, and using
 * a different provider than the gesture path.
 */
export async function requestBackup(reason: BackupReason): Promise<BackupRequestOutcome> {
  const prefs = usePreferences.getState();
  const decision = shouldRunBackup({
    reason,
    backupEnabled: prefs.backupEnabled,
    autoBackupOnPull: prefs.autoBackupOnPull,
    lastRunAtMs: lastBackupAtMs,
    nowMs: Date.now(),
    cooldownMs: BACKUP_COOLDOWN_MS,
  });
  if (!decision.run) return { ran: false, skipReason: decision.skipReason };
  // Make the provider preference actually take effect (it was never applied).
  setProvider(prefs.backupProvider);
  // On Android Drive, detect a missing Google connection up front and prompt,
  // rather than letting the upload 401 with an opaque error.
  const driveStatus = await prepareProvider();
  if (prefs.backupProvider === 'googleDrive' && driveStatus === 'needs-connection') {
    return { ran: false, skipReason: 'needs-connection' };
  }
  const payload = await performBackupNow(prefs.backupProvider);
  lastBackupAtMs = Date.now();
  return { ran: true, payload };
}

interface IdentityRestoreCounts {
  readonly identityCardsRestored: number;
  readonly claimsRestored: number;
  readonly credentialsRestored: number;
}

/** Restore identity cards / claims / credentials, best-effort per record. */
async function restoreIdentity(payload: BackupPayload): Promise<IdentityRestoreCounts> {
  let credentialsRestored = 0;
  let identityCardsRestored = 0;
  let claimsRestored = 0;
  try {
    const [{ useIdentityData }, { useCredentialStore }] = await Promise.all([
      import('../identity/dataStore'),
      import('../credentials/store'),
    ]);

    for (const c of payload.storedCredentials ?? []) {
      try {
        await useCredentialStore.getState().add({
          ...c,
          issuedAt: new Date(c.issuedAt),
          expiresAt: c.expiresAt ? new Date(c.expiresAt) : undefined,
        });
        credentialsRestored += 1;
      } catch {
        /* skip a single bad credential */
      }
    }
    for (const card of payload.identityCards ?? []) {
      try {
        await useIdentityData.getState().upsertIdentityCard({
          ...card,
          issuedAt: new Date(card.issuedAt),
          expiresAt: card.expiresAt ? new Date(card.expiresAt) : undefined,
          createdAt: new Date(card.createdAt),
          updatedAt: new Date(card.updatedAt),
        });
        identityCardsRestored += 1;
      } catch {
        /* skip */
      }
    }
    for (const claim of payload.provableClaims ?? []) {
      try {
        await useIdentityData.getState().upsertProvableClaim({
          ...claim,
          lastPresentedAt: claim.lastPresentedAt ? new Date(claim.lastPresentedAt) : undefined,
          createdAt: new Date(claim.createdAt),
          updatedAt: new Date(claim.updatedAt),
        });
        claimsRestored += 1;
      } catch {
        /* skip */
      }
    }
  } catch {
    // identity / credential stores unavailable in this context — cards +
    // contacts are still restored by the caller.
  }
  return { credentialsRestored, identityCardsRestored, claimsRestored };
}

/**
 * A restore that found a backup file but couldn't use it. `key-mismatch` means
 * the file decrypts with a DIFFERENT master key (the classic in-place
 * SwiftUI→Expo upgrade case) — surfaced so the UI can say so plainly instead
 * of looking like flaky iCloud. `unreadable` is any other download/IO failure.
 */
export class BackupRestoreError extends Error {
  constructor(
    readonly kind: 'key-mismatch' | 'unreadable',
    options?: { cause?: unknown },
  ) {
    super(kind, options);
    this.name = 'BackupRestoreError';
  }
}

export async function restoreFromBackup(): Promise<RestoreResult | null> {
  // null = nothing to restore (no file). A present-but-unusable backup throws
  // a typed BackupRestoreError so the caller can show the right message.
  let payload: BackupPayload | null;
  try {
    payload = await downloadBackup<BackupPayload>();
  } catch (err) {
    // Duck-type by name rather than `instanceof DecryptError` so backupManager
    // doesn't statically depend on encryptionManager's export — tests that mock
    // encryptionManager without DecryptError must still be able to link this.
    const isDecryptError = err instanceof Error && err.name === 'DecryptError';
    throw new BackupRestoreError(
      isDecryptError ? 'key-mismatch' : 'unreadable',
      { cause: err },
    );
  }
  if (!payload) return null;

  for (const card of payload.cards) await saveBusinessCard(card);
  for (const contact of payload.contacts) await saveContact(contact);

  const identity = await restoreIdentity(payload);

  return {
    cardsRestored: payload.cards.length,
    contactsRestored: payload.contacts.length,
    identityCardsRestored: identity.identityCardsRestored,
    claimsRestored: identity.claimsRestored,
    credentialsRestored: identity.credentialsRestored,
    exportedAt: payload.exportedAt,
  };
}

/**
 * Lightweight probe for an existing backup — used by onboarding to offer a
 * restore before provisioning fresh keys (mirrors Swift
 * BackupManager.probeLatestBackup). Returns the latest backup's mtime, or
 * null when none exists / iCloud is unreachable.
 */
export async function probeLatestBackup(): Promise<{ timestamp: Date; isICloud: boolean } | null> {
  const { backupMtime, getActiveProvider } = await import('./cloudProvider');
  const ts = await backupMtime();
  if (!ts) return null;
  return { timestamp: ts, isICloud: getActiveProvider() === 'iCloud' };
}
