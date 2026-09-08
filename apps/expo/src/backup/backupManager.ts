import { withCloudDataLock } from './cloudDataLock';
import { getMmkv } from '../storage/mmkv';
import { captureLocalDataEpoch, canCommitLocalData, trackLocalDataOperation } from '../settings/localDataWipeBarrier';
/**
 * BackupManager — mirrors Swift Services/Backup/BackupManager.swift.
 *
 * Bundles every locally-persisted record into a single encrypted, SOLB-framed
 * blob and writes it as a `backup_<ts>.solbk` file via the active cloud
 * provider (iCloud Drive Documents on iOS, Drive on Android). Restore is the
 * inverse: download → decrypt → validate every record → journaled apply.
 *
 * Payload parity with Swift `BackupData` v3:
 *   businessCards + contacts + identityCards + provableClaims + storedCredentials
 *
 * The "SOLB" magic header is preserved (see `solbEnvelope.ts`) so the file is
 * byte-compatible with the SwiftUI app's `.solbk` files.
 *
 * Current and legacy payloads share the same validated portable-data commit
 * path. A storage failure aborts honestly; restore never skips a bad record
 * and then reports the archive as complete.
 */
import {
  backupMtime,
  downloadArchive,
  downloadLatestArchive,
  prepareProvider,
  setProvider,
  uploadBackup,
  type ProviderKind,
} from './cloudProvider';
import { decryptJson } from '../storage/encryptionManager';
import { decryptJsonWithKey } from '../storage/jsonCrypto';
import { getRootDid, getPortableBackupKey } from '../identity/rootKey';
import {
  resolveAutoBackupIntervalHours,
  shouldRunBackup,
  type BackupReason,
} from './backupPolicy';
import {
  portableDataDigest,
  readAutoBackupState,
  writeAutoBackupState,
} from './autoBackupState';
import { ArchiveDownloadPendingError } from './archiveDownload';
import { normalizeRestoredPayload } from './normalizeBackupPayload';
import { usePreferences } from '@/settings/preferences';
import { uuid, type BusinessCard, type Contact } from '@solidarity/shared';
import type { IdentityCardEntity, ProvableClaimEntity } from '../identity/entities';
import type { StoredCredential } from '../credentials/store';
import type { PortableData } from './portableData';

export type { BackupReason } from './backupPolicy';

export interface BackupPayload {
  readonly schemaVersion: 3 | 4;
  readonly portableData?: PortableData;
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

/**
 * Snapshot every local record and upload it as a portable SOLB v2 archive
 * sealed with `portableKey` (the Recovery-Phrase-derived Portable Backup Key
 * resolved by the caller). NEVER falls back to the device-local key — a v1
 * archive can't be restored on another device, so writing one under the guise
 * of "backed up" would be dishonest (see `docs/adr/0001` + plan §4.3).
 */
export async function performBackupNow(
  provider: ProviderKind,
  portableKey: Uint8Array,
  gathered?: PortableData,
): Promise<BackupPayload> {
  // `gathered` lets the caller reuse a snapshot it already took to decide
  // whether anything changed, instead of reading every record twice.
  let portableData = gathered;
  if (!portableData) {
    const did = await getRootDid();
    if (!did.ok) throw new Error('backup-identity-unavailable');
    const { gatherPortableData } = await import('./portableStorage');
    portableData = await gatherPortableData(did.value);
  }
  const list = (prefix: string): readonly unknown[] => Object.entries(portableData.records)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, value]) => JSON.parse(value) as unknown);
  const payload: BackupPayload = {
    schemaVersion: 4, exportedAt: new Date().toISOString(), provider, portableData,
    cards: list('cards:') as readonly BusinessCard[],
    contacts: list('contacts:') as readonly Contact[],
    identityCards: list('idcard:') as readonly IdentityCardEntity[],
    provableClaims: list('provable:') as readonly ProvableClaimEntity[],
    storedCredentials: list('vc:') as readonly StoredCredential[],
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
 * the scheduled automatic run, People pull-to-refresh, pan gesture — routes
 * through here so the prefs (enabled / automatic / interval / provider),
 * provider selection, the cooldown and the content check are all applied in
 * ONE place. Returns without backing up (`ran: false`) when the policy says
 * skip; only throws for a genuine upload error, never for a skip.
 *
 * Skip reasons an automatic caller should simply ignore: `disabled`,
 * `auto-disabled`, `cooldown`, `interval`, `unchanged`, `root-key-unavailable`.
 *
 * This replaces the old footgun where `usePeopleScreen.refresh()` called
 * `performBackupNow(DEFAULT_PROVIDER)` unconditionally on every pull —
 * ignoring `backupEnabled`/`autoBackupOnPull`, racing the rotation, and using
 * a different provider than the gesture path.
 */
export function requestBackup(reason: BackupReason): Promise<BackupRequestOutcome> {
  return trackLocalDataOperation(withCloudDataLock(() => requestBackupUnlocked(reason)));
}
async function requestBackupUnlocked(reason: BackupReason): Promise<BackupRequestOutcome> {
  const prefs = usePreferences.getState();
  const autoState = readAutoBackupState();
  const decision = shouldRunBackup({
    reason,
    backupEnabled: prefs.backupEnabled,
    autoBackupEnabled: prefs.autoBackupOnPull,
    lastRunAtMs: lastBackupAtMs,
    lastArchiveAtMs: autoState.lastArchiveAtMs,
    nowMs: Date.now(),
    cooldownMs: BACKUP_COOLDOWN_MS,
    minIntervalMs:
      resolveAutoBackupIntervalHours(prefs.autoBackupIntervalHours) * 3_600_000,
  });
  if (!decision.run) return { ran: false, skipReason: decision.skipReason };
  // Make the provider preference actually take effect (it was never applied).
  setProvider(prefs.backupProvider);
  // On Android Drive, detect a missing Google connection up front and prompt,
  // rather than letting the upload 401 with an opaque error.
  const driveStatus = await prepareProvider(reason === 'manual');
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
  // Snapshot once, then decide. Three retained archives are a scarce
  // resource: an automatic run that wrote an identical snapshot every
  // interval would evict the user's real restore points in favour of three
  // copies of the same data. A manual press always writes — the user asked
  // for a backup and must get a file, unchanged or not.
  const did = await getRootDid();
  if (!did.ok) throw new Error('backup-identity-unavailable');
  const { gatherPortableData } = await import('./portableStorage');
  const portableData = await gatherPortableData(did.value);
  // A device that has been wiped, or that has not finished restoring, gathers
  // nothing. Retention is a scarce resource, so writing that empty archive
  // would rotate away the very files that still hold the user's data — the
  // safety net destroying itself. Nothing to back up is a skip, not a write.
  if (Object.keys(portableData.records).length === 0) {
    return { ran: false, skipReason: 'empty' };
  }
  const digest = portableDataDigest(portableData);
  if (reason !== 'manual' && autoState.digest !== null && digest === autoState.digest) {
    // "We already archived this content" is only a reason to skip while that
    // archive still EXISTS. The marker records content and time, not which
    // container it landed in, so an Apple-ID switch, an iCloud sign-out or a
    // user deleting AirMeishiBackup would otherwise leave the schedule
    // permanently inert with zero archives in the cloud and the toggle still
    // on. `backupMtime` answers null on any error too, so an unreadable
    // provider fails OPEN — one redundant archive, never a silent gap.
    if (await backupMtime()) return { ran: false, skipReason: 'unchanged' };
  }
  // Stamp the cooldown BEFORE the upload. A backup that fails (offline,
  // iCloud signed out) previously left the guard unset, so the change-driven
  // trigger would retry on every debounce tick for as long as it kept
  // failing. Only a SUCCESSFUL write advances the archive schedule.
  lastBackupAtMs = Date.now();
  const payload = await performBackupNow(prefs.backupProvider, keyRes.value, portableData);
  writeAutoBackupState({ lastArchiveAtMs: Date.now(), digest });
  return { ran: true, payload };
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
 *   - `download-pending`       — the archive exists but iCloud has not
 *     delivered its bytes to this device yet (`archiveName` says which; the
 *     read already asked for the transfer — bring it down with
 *     `ensureArchiveDownloaded`, then retry).
 *   - `unreadable`             — any other download / framing / I/O failure.
 */
export class BackupRestoreError extends Error {
  /** Set for `download-pending`: the archive the transfer concerns. */
  readonly archiveName: string | undefined;

  constructor(
    readonly kind:
      | 'root-key-unavailable'
      | 'portable-key-mismatch'
      | 'legacy-key-unavailable'
      | 'unsupported-version'
      | 'download-pending'
      | 'unreadable',
    options?: { cause?: unknown; archiveName?: string },
  ) {
    super(kind, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BackupRestoreError';
    this.archiveName = options?.archiveName;
  }
}

/** Sync state carrying the restored keys for adoption, or null when this
 * device has sync state we cannot read — compounding an unreadable state with
 * a freshly minted device identity would make the restore concurrent with its
 * own history instead of authoritative over it. */
async function pendingAdoptState(identity: string, keys: readonly string[]): Promise<string | null> {
  const { SYNC_STATE_KEY } = await import('./portableStorage');
  const { newSyncState, parseSyncState } = await import('./syncEngine');
  const raw = getMmkv().getString(SYNC_STATE_KEY);
  let current;
  if (raw === undefined) {
    current = newSyncState(identity, uuid());
  } else {
    try {
      current = parseSyncState(JSON.parse(raw) as unknown, identity);
    } catch {
      return null;
    }
  }
  return JSON.stringify({ ...current, adopt: [...new Set([...(current.adopt ?? []), ...keys])] });
}

async function restorePortablePayload(payload: BackupPayload): Promise<RestoreResult> {
  // Namespace import, not a destructure: `applyingPortableData` is a `let`
  // whose value changes during the apply, and destructuring would freeze it at
  // `false` — making the apply's own writes look like concurrent local edits.
  const portableStorage = await import('./portableStorage');
  const { applyPortableData, gatherPortableData, isPortableStorageKey } = portableStorage;
  const { legacyPortableRecords, validatePortableData } = await import('./portableData');
  const did = await getRootDid();
  if (!did.ok) throw new BackupRestoreError('root-key-unavailable');
  const data = validatePortableData(
    payload.portableData ?? legacyPortableRecords(payload, did.value),
    did.value,
  );
  const epoch = captureLocalDataEpoch();
  const localStateChanged = { value: false };
  const subscription = getMmkv().addOnValueChangedListener((key) => {
    if (!portableStorage.applyingPortableData && isPortableStorageKey(key)) localStateChanged.value = true;
  });
  try {
    const before = await gatherPortableData(did.value);
    const current = await getRootDid();
    if (!current.ok || current.value !== did.value) {
      throw new BackupRestoreError('portable-key-mismatch');
    }
    // The restored records are the user's explicit choice, so the next sync
    // must author them ON TOP of whatever the other device holds instead of
    // racing it. Writing the marker inside the SAME journaled commit as the
    // data means a crash can never leave one without the other.
    const adoptState = await pendingAdoptState(did.value, Object.keys(data.records));
    await trackLocalDataOperation(applyPortableData(data, before.records, {
      replace: false,
      ...(adoptState === null ? {} : { state: adoptState }),
      assertCurrent: () => {
        if (localStateChanged.value || !canCommitLocalData(epoch)) {
          throw new Error('restore-local-data-changed');
        }
      },
    }));
  } finally {
    subscription.remove();
  }
  // Report what was applied. A v4 archive restores `data.records`; the v3
  // top-level arrays are a parallel copy, so counting those could claim
  // records that never reached storage.
  const restored = (prefix: string): number =>
    Object.keys(data.records).filter((key) => key.startsWith(prefix)).length;
  return {
    cardsRestored: restored('cards:'),
    contactsRestored: restored('contacts:'),
    identityCardsRestored: restored('idcard:'),
    claimsRestored: restored('provable:'),
    credentialsRestored: restored('vc:'),
    exportedAt: payload.exportedAt,
  };
}

/**
 * Restore from the newest archive, or — when `archiveName` is given — from a
 * SPECIFIC archive the user picked in the dated backup list (plan G6: explicit
 * choice, never a silent fallback to an older file).
 */
export function restoreFromBackup(archiveName?: string): Promise<RestoreResult | null> {
  return trackLocalDataOperation(withCloudDataLock(() => restoreFromBackupUnlocked(archiveName)));
}
async function restoreFromBackupUnlocked(archiveName?: string): Promise<RestoreResult | null> {
  // null = nothing to restore (no file). A present-but-unusable backup throws
  // a typed BackupRestoreError so the caller can show the right message.
  let archive: Awaited<ReturnType<typeof downloadLatestArchive>>;
  try {
    archive = archiveName ? await downloadArchive(archiveName) : await downloadLatestArchive();
  } catch (err) {
    // Not on this device yet is not "unreadable": name the archive so the UI
    // can show the transfer and retry once it lands.
    if (err instanceof ArchiveDownloadPendingError) {
      throw new BackupRestoreError('download-pending', { cause: err, archiveName: err.archiveName });
    }
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

  return restorePortablePayload(payload);
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
