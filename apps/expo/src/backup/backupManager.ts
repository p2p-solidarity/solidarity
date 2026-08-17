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
  downloadArchive,
  downloadLatestArchive,
  prepareProvider,
  setProvider,
  uploadBackup,
  type ProviderKind,
} from './cloudProvider';
import { decryptJson } from '../storage/encryptionManager';
import { decryptJsonWithKey } from '../storage/jsonCrypto';
import { getPortableBackupKey } from '../identity/rootKey';
import { shouldRunBackup, type BackupReason } from './backupPolicy';
import { normalizeRestoredPayload } from './normalizeBackupPayload';
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

/**
 * Snapshot every local record and upload it as a portable SOLB v2 archive
 * sealed with `portableKey` (the Recovery-Phrase-derived Portable Backup Key
 * resolved by the caller). NEVER falls back to the device-local key — a v1
 * archive can't be restored on another device, so writing one under the guise
 * of "backed up" would be dishonest (see `docs/adr/0001` + plan §4.3).
 */
export async function performBackupNow(
  provider: ProviderKind,
  portableKey: Uint8Array
): Promise<BackupPayload> {
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
  await uploadBackup(payload, portableKey);
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
  // Resolve the Portable Backup Key BEFORE writing. No Recovery Phrase yet
  // (onboarding not finished) → skip honestly rather than write a device-only
  // v1 archive that no other device could ever restore.
  const keyRes = await getPortableBackupKey();
  if (!keyRes.ok) {
    return { ran: false, skipReason: 'root-key-unavailable' };
  }
  const payload = await performBackupNow(prefs.backupProvider, keyRes.value);
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
 * A restore that found a backup file but couldn't use it. Each kind maps to a
 * distinct, actionable UI message (plan §6):
 *   - `root-key-unavailable`   — a v2 archive exists but there is no local
 *     Recovery Phrase to derive its Portable Backup Key (recover the Root
 *     Identity first).
 *   - `portable-key-mismatch`  — v2 archive failed the auth tag under the
 *     active Recovery Phrase (wrong identity / corrupt archive).
 *   - `legacy-key-unavailable` — a v1 device-key archive can't be opened on
 *     this device (the original Device Storage Key is gone — the classic
 *     cross-device / post-wipe case).
 *   - `unsupported-version`    — the archive version byte is unknown.
 *   - `unreadable`             — any other download / framing / I/O failure.
 */
export class BackupRestoreError extends Error {
  constructor(
    readonly kind:
      | 'root-key-unavailable'
      | 'portable-key-mismatch'
      | 'legacy-key-unavailable'
      | 'unsupported-version'
      | 'unreadable',
    options?: { cause?: unknown },
  ) {
    super(kind, options);
    this.name = 'BackupRestoreError';
  }
}

/**
 * Restore from the newest archive, or — when `archiveName` is given — from a
 * SPECIFIC archive the user picked in the dated backup list (plan G6: explicit
 * choice, never a silent fallback to an older file).
 */
export async function restoreFromBackup(archiveName?: string): Promise<RestoreResult | null> {
  // null = nothing to restore (no file). A present-but-unusable backup throws
  // a typed BackupRestoreError so the caller can show the right message.
  let archive: Awaited<ReturnType<typeof downloadLatestArchive>>;
  try {
    archive = archiveName ? await downloadArchive(archiveName) : await downloadLatestArchive();
  } catch (err) {
    // Framing failures from decodeSolb: unknown version fails closed as its own
    // kind; anything else (bad magic, legacy plaintext, IO) is unreadable.
    const msg = err instanceof Error ? err.message : '';
    throw new BackupRestoreError(
      msg.includes('Unsupported backup version') ? 'unsupported-version' : 'unreadable',
      { cause: err },
    );
  }
  if (!archive) return null;

  let payload: BackupPayload;
  try {
    let raw: unknown;
    if (archive.keyScheme === 'recovery-phrase-hkdf-v1') {
      // v2 portable archive → Recovery-Phrase-derived Portable Backup Key.
      const keyRes = await getPortableBackupKey();
      if (!keyRes.ok) throw new BackupRestoreError('root-key-unavailable', { cause: keyRes.error });
      raw = decryptJsonWithKey(keyRes.value, archive.ciphertextB64);
    } else {
      // v1 legacy archive → device-local Device Storage Key (same-device only).
      raw = await decryptJson(archive.ciphertextB64);
    }
    const normalized = normalizeRestoredPayload(raw);
    if (!normalized) {
      throw new BackupRestoreError('unreadable', {
        cause: new Error('backup payload is not an object'),
      });
    }
    payload = normalized;
  } catch (err) {
    if (err instanceof BackupRestoreError) throw err;
    // Duck-type by name rather than `instanceof DecryptError` so tests that mock
    // the crypto layer without the class still link. A tag failure maps to the
    // scheme-specific "wrong key" kind; anything else is unreadable.
    const isDecryptError = err instanceof Error && err.name === 'DecryptError';
    const kind = !isDecryptError
      ? ('unreadable' as const)
      : archive.keyScheme === 'recovery-phrase-hkdf-v1'
        ? ('portable-key-mismatch' as const)
        : ('legacy-key-unavailable' as const);
    throw new BackupRestoreError(kind, { cause: err });
  }

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
