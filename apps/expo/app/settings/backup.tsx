import { requestCloudSync, useCloudSyncStatus, readSyncConflicts, chooseSyncConflict } from '@/backup/cloudSync';
/**
 * Backup settings.
 *
 * Two tabs, because the screen answers two unrelated questions and used to
 * stack both as one long scroll:
 *   - **Backup**  — how backing up behaves: on/off, the automatic schedule
 *     and its interval, device sync, manual actions, iCloud status.
 *   - **History** — which dated archives exist and restoring a specific one.
 *
 * Only `MAX_RETAINED_BACKUPS` archives are kept, so History is short by
 * construction; the interval control on the Backup tab is what decides how
 * much time those few slots actually span.
 */
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
  SettingsSegmented,
} from '@/components/settings/SettingsBlocks';
import {
  ArchiveDownloadError,
  AUTO_BACKUP_INTERVAL_CHOICES,
  backupMtime,
  BackupRestoreError,
  ensureArchiveDownloaded,
  isDownloadPendingError,
  listBackupArchives,
  MAX_RETAINED_BACKUPS,
  requestBackup,
  resolveAutoBackupIntervalHours,
  restoreFromBackup,
  type BackupArchiveInfo,
} from '@/backup';
import { appAlert, showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

type BackupTab = 'backup' | 'history';

export default function BackupSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const provider = usePreferences((s) => s.backupProvider);
  const backupEnabled = usePreferences((s) => s.backupEnabled);
  const autoBackup = usePreferences((s) => s.autoBackupOnPull);
  const intervalHours = usePreferences((s) => s.autoBackupIntervalHours);
  const sync = useCloudSyncStatus();
  const [conflicts, setConflicts] = useState<ReturnType<typeof readSyncConflicts>>({ revision: '', choices: [] });
  const setPref = usePreferences((s) => s.set);

  const [tab, setTab] = useState<BackupTab>('backup');
  const [lastBackup, setLastBackup] = useState<Date | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [iCloudAvailable, setICloudAvailable] = useState(true);
  // Dated archive list (plan G6: explicit choice) — strict 3-state, no
  // placeholder rows while loading (CLAUDE.md rule 8).
  const [archives, setArchives] = useState<'loading' | 'error' | readonly BackupArchiveInfo[]>(
    'loading'
  );
  // One iCloud transfer at a time: which archive, and how far. Lock-free on
  // purpose (archiveDownload.ts) so the row can keep updating for as long as
  // iCloud needs; the restore that follows takes the cloud-data lock as usual.
  const [download, setDownload] = useState<{ name: string; percent: number | null } | null>(null);
  const downloadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { downloadAbort.current?.abort(); }, []);

  const reloadArchives = useCallback(async () => {
    setArchives('loading');
    try {
      setArchives(await listBackupArchives());
    } catch {
      setArchives('error');
    }
  }, []);

  useEffect(() => {
    void backupMtime()
      .then((d) => {
        setLastBackup(d);
        setICloudAvailable(true);
      })
      .catch(() => {
        setLastBackup(null);
        setICloudAvailable(false);
      });
  }, [provider]);

  // The automatic schedule writes archives while this screen is open, so the
  // list is re-read on entry to History rather than cached from mount.
  useEffect(() => {
    if (tab === 'history') void reloadArchives();
  }, [tab, provider, reloadArchives]);

  const onBackupNow = async () => {
    setIsBackingUp(true);
    pushToast(t('backup.encrypting'), 'info', 2000);
    try {
      const result = await requestBackup('manual');
      if (!result.ran) {
        // The user pressed a button and already saw "Encrypting…" — every
        // reason a manual run can decline has to be said out loud, or the
        // screen implies a backup that never happened. Manual bypasses the
        // schedule gates, so only these three can reach here.
        const skipMessage =
          result.skipReason === 'needs-connection'
            ? t('backup.drive.needsConnection')
            : result.skipReason === 'empty'
              ? t('backup.skipped.empty')
              : result.skipReason === 'root-key-unavailable'
                ? t('backup.skipped.rootKeyUnavailable')
                : t('backup.skipped.unknown');
        pushToast(skipMessage, 'info', 3500);
        return;
      }
      if (result.payload) setLastBackup(new Date(result.payload.exportedAt));
      pushToast(t('backup.success'), 'success');
      void reloadArchives();
    } catch (err) {
      // Absorb the failure into our themed report sheet — no raw CKError in
      // a native UIAlertController, no duplicate toast. The sheet's "Send
      // report" mails the trace to err@solidarity.gg.
      showError({
        context: 'Backup › Back Up Now',
        summary: t('backup.failedSummary'),
        error: err,
      });
    } finally {
      setIsBackingUp(false);
    }
  };

  const onRestore = async (archiveName?: string, archiveDate?: string) => {
    const ok = await confirmDialog({
      title: archiveName ? t('backup.archives.restoreThis.title') : t('backup.restorePrompt.title'),
      message: archiveName
        ? t('backup.archives.restoreThis.message', { date: archiveDate ?? '' })
        : t('backup.restorePrompt.message'),
      confirmLabel: t('backup.restore.confirm'),
      destructive: true,
    });
    if (!ok) return;
    await performRestoreNow(archiveName);
  };

  /**
   * Bring `name` onto this device, mirroring iCloud's progress into the UI.
   * Resolves true once the archive is readable; false after saying why not.
   */
  const downloadArchive = async (name: string): Promise<boolean> => {
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownload({ name, percent: null });
    try {
      await ensureArchiveDownloaded(name, {
        signal: controller.signal,
        onProgress: (progress) => { setDownload({ name, percent: progress.percent }); },
      });
      return true;
    } catch (error) {
      // Leaving the screen aborts the wait; iCloud keeps transferring, and
      // the row reports the real state next time. Nothing to tell the user.
      if (error instanceof ArchiveDownloadError && error.kind === 'aborted') return false;
      showError({ context: 'Backup › Download', summary: t('backup.restore.downloadFailed'), error });
      return false;
    } finally {
      if (downloadAbort.current === controller) downloadAbort.current = null;
      setDownload(null);
    }
  };

  /** History row for an archive that is not on this device yet. */
  const onDownloadAndRestore = async (name: string, date: string) => {
    if (download) return;
    if (!(await downloadArchive(name)) || downloadAbort.current !== null) return;
    // Its header is readable now: refresh the row's format label, then carry
    // on exactly as a tap on a local archive would.
    void reloadArchives();
    await onRestore(name, date);
  };

  const performRestoreNow = async (archiveName?: string, afterDownload = false) => {
    try {
      const r = await restoreFromBackup(archiveName);
      if (!r) {
        appAlert({
          title: t('backup.restore.notFoundTitle'),
          message: t('backup.restore.notFound'),
        });
        return;
      }
      safeBack('/settings');
    } catch (err) {
      // The archive exists but iCloud has not delivered it here yet. The read
      // already asked for it; show the transfer, then retry once — the user
      // has confirmed already, so no second dialog.
      if (err instanceof BackupRestoreError && err.kind === 'download-pending' && err.archiveName) {
        if (afterDownload) {
          showError({ context: 'Backup › Restore', summary: t('backup.restore.downloadFailed'), error: err });
          return;
        }
        if (await downloadArchive(err.archiveName)) await performRestoreNow(err.archiveName, true);
        return;
      }
      // A "wrong key" failure (v2 under a different Recovery Phrase, or a v1
      // device-key archive on a device that lacks that key): explain plainly,
      // then offer to keep the CURRENT data and create a fresh portable backup
      // instead of dead-ending (user request 2026-07-17). Never deletes the
      // old archive.
      const isWrongKey =
        err instanceof BackupRestoreError &&
        (err.kind === 'portable-key-mismatch' || err.kind === 'legacy-key-unavailable');
      if (isWrongKey) {
        const createNew = await confirmDialog({
          title: t('backup.restore.keyFailedCreateNew.title'),
          message: `${t('backup.restore.keyMismatch')}\n\n${t('backup.restore.keyFailedCreateNew.message')}`,
          confirmLabel: t('backup.restore.keyFailedCreateNew.confirm'),
        });
        if (createNew) await onBackupNow();
        return;
      }
      const summary =
        err instanceof BackupRestoreError && err.kind === 'root-key-unavailable'
          ? t('backup.restore.rootKeyUnavailable')
          : t('backup.restore.failedSummary');
      showError({ context: 'Backup › Restore', summary, error: err });
    }
  };

  useEffect(() => {
    try { setConflicts(readSyncConflicts()); } catch { setConflicts({ revision: '', choices: [] }); }
  }, [sync.status, sync.conflicts]);

  const syncNow = async () => {
    try { await requestCloudSync(); }
    catch (error) {
      // Another device's revision is still on its way from iCloud — not an
      // error of this device, and the foreground poll retries by itself.
      if (isDownloadPendingError(error)) {
        pushToast(t('backup.sync.downloadingToast'), 'info', 3500);
        return;
      }
      showError({ context: 'Cloud sync', summary: t('backup.sync.failed'), error });
    }
  };
  const resolveConflict = async (key: string, index: number, summary: string) => {
    const accepted = await confirmDialog({ title: t('backup.sync.choose'),
      message: t('backup.sync.chooseMessage', { summary }), confirmLabel: t('backup.sync.choose') });
    if (!accepted) return;
    try { await chooseSyncConflict(conflicts.revision, key, index); setConflicts(readSyncConflicts()); }
    catch (error) { showError({ context: 'Cloud sync conflict', summary: t('backup.sync.failed'), error }); }
  };

  const selectedInterval = resolveAutoBackupIntervalHours(intervalHours);
  const intervalOptions = AUTO_BACKUP_INTERVAL_CHOICES.map((hours) => ({
    value: String(hours),
    label: t(`backup.auto.every.${hours}`),
  }));

  const lastBackupText = lastBackup
    ? t('backup.lastBackup', { date: lastBackup.toLocaleString() })
    : undefined;
  const backupDisabled = !backupEnabled || isBackingUp;
  const downloadTrailing = download
    ? download.percent === null
      ? t('backup.download.trailing')
      : t('backup.download.trailingPercent', { percent: download.percent })
    : undefined;

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('backup.title')} />

      <View className="px-4" style={{ paddingTop: 12 }}>
        <SettingsSegmented
          role="tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'backup', label: t('backup.tabs.backup') },
            { value: 'history', label: t('backup.tabs.history') },
          ]}
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        {tab === 'backup' ? (
          <View className="gap-6">
            {/* iCloud Backup */}
            <SettingsBlockSection title={t('backup.section.icloud')}>
              <SettingsBlockToggleRow
                icon="icloud"
                title={t('backup.sync.enable')}
                value={backupEnabled}
                onValueChange={(v) => { setPref('backupEnabled', v); }}
              />
              {backupEnabled ? (
                <SettingsBlockToggleRow
                  icon="arrow.triangle.2.circlepath"
                  title={t('backup.auto.title')}
                  subtitle={t('backup.auto.subtitle')}
                  value={autoBackup}
                  onValueChange={(v) => { setPref('autoBackupOnPull', v); }}
                />
              ) : null}
            </SettingsBlockSection>

            {/* Automatic backup interval — the control that decides how much
                time the retained archives actually cover. */}
            {backupEnabled && autoBackup ? (
              <View className="gap-2">
                <SettingsBlockSectionHeader title={t('backup.auto.intervalHeader')} />
                <View className="px-4">
                  <SettingsSegmented
                    value={String(selectedInterval)}
                    options={intervalOptions}
                    onChange={(value) => {
                      setPref('autoBackupIntervalHours', Number(value));
                    }}
                  />
                </View>
                <Text className="px-4 text-[12px] text-text3">
                  {t('backup.auto.intervalFooter', { kept: MAX_RETAINED_BACKUPS })}
                </Text>
              </View>
            ) : null}

            <SettingsBlockSection title={t('backup.sync.title')} footer={t('backup.sync.footer')}>
              <SettingsBlockRow icon="arrow.triangle.2.circlepath" title={t('backup.sync.now')}
                showsChevron={false} disabled={!backupEnabled || sync.status === 'syncing'}
                onPress={() => { void syncNow(); }} />
              <SettingsBlockInfoRow icon="icloud"
                title={sync.detail === 'icloud-download'
                  ? t('backup.sync.downloading')
                  : t(`backup.sync.${sync.status}`)}
                value={sync.lastCheckedAt ? new Date(sync.lastCheckedAt).toLocaleTimeString() : ''} />
            </SettingsBlockSection>
            {conflicts.choices.length > 0 ? (
              <SettingsBlockSection title={t('backup.sync.conflicts')} footer={t('backup.sync.conflictsFooter')}>
                {conflicts.choices.map((choice) => {
                  // One label for both the row and the confirm dialog. Passing
                  // the raw token to the dialog put the untranslated internal
                  // enum ("deleted" / "avatar") inside an irreversible
                  // destructive prompt, one line under its localized title.
                  const label =
                    choice.summary === 'deleted'
                      ? t('backup.sync.deleted')
                      : choice.summary === 'avatar'
                        ? t('backup.sync.avatar')
                        : choice.summary;
                  return (
                    <SettingsBlockRow key={`${choice.key}:${choice.index}`} icon="doc.text"
                      title={label}
                      subtitle={`${choice.key} · ${choice.digest}`}
                      onPress={() => { void resolveConflict(choice.key, choice.index, label); }} />
                  );
                })}
              </SettingsBlockSection>
            ) : null}

            {/* Actions */}
            <SettingsBlockSection title={t('backup.section.actions')} footer={lastBackupText}>
              <SettingsBlockRow
                icon="icloud.and.arrow.up"
                title={t('backup.now')}
                trailingText={isBackingUp ? t('backup.working') : undefined}
                showsChevron={false}
                disabled={backupDisabled}
                onPress={() => { void onBackupNow(); }}
              />
              <SettingsBlockRow
                icon="arrow.counterclockwise.icloud"
                title={t('backup.restoreLatest')}
                subtitle={download ? t('backup.download.cancelHint') : undefined}
                trailingText={downloadTrailing}
                showsChevron={false}
                onPress={() => {
                  if (download) { downloadAbort.current?.abort(); return; }
                  void onRestore();
                }}
              />
            </SettingsBlockSection>

            {/* Status — its own footer, not a second copy of the sync
                paragraph: when iCloud is unavailable this is the only place
                that tells the user what to actually do about it. */}
            <SettingsBlockSection
              title={t('backup.section.status')}
              footer={
                iCloudAvailable
                  ? t('backup.status.connectedFooter')
                  : t('backup.status.unavailableFooter')
              }>
              <SettingsBlockInfoRow
                icon={iCloudAvailable ? 'checkmark.icloud.fill' : 'externaldrive.fill'}
                title={iCloudAvailable ? t('backup.status.connected') : t('backup.status.unavailable')}
                value=""
              />
            </SettingsBlockSection>
          </View>
        ) : (
          /* History — dated explicit choice (plan G6). 3-state: loading /
             error / list (empty list = honest "none" footer, no placeholder). */
          <View className="gap-6">
            <SettingsBlockSection
              title={t('backup.archives.title')}
              footer={
                archives === 'loading'
                  ? undefined
                  : archives === 'error'
                    ? t('backup.archives.loadError')
                    : archives.length === 0
                      ? t('backup.archives.none')
                      : t('backup.archives.footer', { kept: MAX_RETAINED_BACKUPS })
              }
            >
              {typeof archives !== 'string'
                ? archives.map((a) => (
                    <ArchiveHistoryRow
                      key={a.name}
                      archive={a}
                      download={download}
                      onRestore={onRestore}
                      onDownload={onDownloadAndRestore}
                      onCancel={() => { downloadAbort.current?.abort(); }}
                    />
                  ))
                : null}
            </SettingsBlockSection>

            {lastBackupText ? (
              <Text className="px-4 text-[12px] text-text3">{lastBackupText}</Text>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One dated archive. The row this screen is downloading shows live progress
 * and a cancel — whichever way the transfer started (a tap on a cold row, or
 * "Restore from Backup" discovering the latest archive is not here yet, in
 * which case the row was listed as ready). A cold row is tappable; only a
 * row whose header was read and found unreadable stays disabled.
 */
function ArchiveHistoryRow({
  archive,
  download,
  onRestore,
  onDownload,
  onCancel,
}: {
  readonly archive: BackupArchiveInfo;
  readonly download: { readonly name: string; readonly percent: number | null } | null;
  readonly onRestore: (name: string, date: string) => Promise<void>;
  readonly onDownload: (name: string, date: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const date = new Date(archive.timestampMs).toLocaleString();
  const live = download?.name === archive.name;
  const onDevice = archive.availability === 'ready';
  // A transfer iCloud is running on its own (a sync pass asked for the file)
  // shows what the listing saw; tapping it attaches this screen's progress.
  const transferring = live || archive.availability === 'downloading';
  const percent = live ? download.percent : archive.percent;
  const subtitle = transferring
    ? percent === null
      ? t('backup.archives.downloading')
      : t('backup.archives.downloadingPercent', { percent })
    : onDevice
      ? archive.version === 2
        ? t('backup.archives.portable')
        : archive.version === 1
          ? t('backup.archives.legacy')
          : t('backup.archives.unknown')
      : t('backup.archives.cloudOnly');
  const unreadable = onDevice && archive.version === null;
  const otherRowBusy = download !== null && !live;
  return (
    <SettingsBlockRow
      icon={transferring || !onDevice ? 'icloud.and.arrow.down' : archive.version === 2 ? 'icloud' : 'doc.text'}
      title={date}
      subtitle={subtitle}
      trailingText={live ? t('backup.download.cancel') : undefined}
      showsChevron={false}
      disabled={otherRowBusy || (unreadable && !live)}
      onPress={() => {
        if (live) { onCancel(); return; }
        void (onDevice ? onRestore(archive.name, date) : onDownload(archive.name, date));
      }}
    />
  );
}
