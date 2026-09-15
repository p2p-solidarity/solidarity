/**
 * Backup settings — one screen, one switch.
 *
 * The switch turns on encrypted cloud backup AND cross-device sync, and "on"
 * means automatic: an archive is written when the data changed and the fixed
 * interval has passed (`backupPolicy.ts`); sync runs by itself while the app
 * is open (`cloudSync.ts`). Under it: "Back up now", the live sync status,
 * and History — the dated archives, each restorable with a tap.
 *
 * Deliberately NOT here (cut 2026-09-10 so the screen stays simple): a
 * separate automatic-backup toggle, the interval picker, "Sync now", a
 * "Restore latest" row and a second tab. History is the one place restore
 * lives. Sync conflicts still surface, but only while there are any.
 */
import { chooseSyncConflict, readSyncConflicts, useCloudSyncStatus } from '@/backup/cloudSync';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import {
  ArchiveDownloadError,
  backupMtime,
  BackupRestoreError,
  ensureArchiveDownloaded,
  listBackupArchives,
  MAX_RETAINED_BACKUPS,
  requestBackup,
  restoreFromBackup,
  type BackupArchiveInfo,
} from '@/backup';
import { appAlert, showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

export default function BackupSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const provider = usePreferences((s) => s.backupProvider);
  const backupEnabled = usePreferences((s) => s.backupEnabled);
  const setPref = usePreferences((s) => s.set);
  const sync = useCloudSyncStatus();
  const [conflicts, setConflicts] = useState<ReturnType<typeof readSyncConflicts>>({ revision: '', choices: [] });

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
    // History shares the screen, so it loads with it. A manual backup
    // re-reads the list below; an archive the schedule writes meanwhile shows
    // on the next visit.
    void reloadArchives();
  }, [provider, reloadArchives]);

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

  /** History row tap: confirm, then restore that dated archive. */
  const onRestore = async (archiveName: string, archiveDate: string) => {
    const ok = await confirmDialog({
      title: t('backup.archives.restoreThis.title'),
      message: t('backup.archives.restoreThis.message', { date: archiveDate }),
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

  const performRestoreNow = async (archiveName: string, afterDownload = false) => {
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
      // The archive was listed as here but iCloud has evicted it since. The
      // read already asked for it; show the transfer, then retry once — the
      // user has confirmed already, so no second dialog.
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

  const resolveConflict = async (key: string, index: number, summary: string) => {
    const accepted = await confirmDialog({ title: t('backup.sync.choose'),
      message: t('backup.sync.chooseMessage', { summary }), confirmLabel: t('backup.sync.choose') });
    if (!accepted) return;
    try { await chooseSyncConflict(conflicts.revision, key, index); setConflicts(readSyncConflicts()); }
    catch (error) { showError({ context: 'Cloud sync conflict', summary: t('backup.sync.failed'), error }); }
  };

  // One footer under the switch: what "on" does, then the one status line
  // that matters — when iCloud is unavailable this is the only place that
  // tells the user what to do about it; otherwise the last backup time.
  const lastBackupText = lastBackup
    ? t('backup.lastBackup', { date: lastBackup.toLocaleString() })
    : undefined;
  const cloudFooter = [
    t('backup.section.icloudFooter'),
    iCloudAvailable ? lastBackupText : t('backup.status.unavailableFooter'),
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('backup.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          <SettingsBlockSection title={t('backup.section.icloud')} footer={cloudFooter}>
            <SettingsBlockToggleRow
              icon="icloud"
              title={t('backup.sync.enable')}
              value={backupEnabled}
              onValueChange={(v) => { setPref('backupEnabled', v); }}
            />
            <SettingsBlockRow
              icon="icloud.and.arrow.up"
              title={t('backup.now')}
              trailingText={isBackingUp ? t('backup.working') : undefined}
              showsChevron={false}
              disabled={!backupEnabled || isBackingUp}
              onPress={() => { void onBackupNow(); }}
            />
            {backupEnabled ? (
              // Sync has no button — it runs on its own while the app is open —
              // but a pass that cannot finish must still be visible somewhere.
              <SettingsBlockInfoRow
                icon="arrow.triangle.2.circlepath"
                title={sync.detail === 'icloud-download'
                  ? t('backup.sync.downloading')
                  : t(`backup.sync.${sync.status}`)}
                value={sync.lastCheckedAt ? new Date(sync.lastCheckedAt).toLocaleTimeString() : ''}
              />
            ) : null}
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

          {/* History — dated explicit choice (plan G6). 3-state: loading /
              error / list (empty list = honest "none" footer, no placeholder). */}
          <SettingsBlockSection
            title={t('backup.history.title')}
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
            {archives === 'loading' ? (
              <SettingsBlockInfoRow icon="icloud" title={t('backup.history.loading')} value="" />
            ) : typeof archives !== 'string' ? (
              archives.map((a) => (
                <ArchiveHistoryRow
                  key={a.name}
                  archive={a}
                  download={download}
                  onRestore={onRestore}
                  onDownload={onDownloadAndRestore}
                  onCancel={() => { downloadAbort.current?.abort(); }}
                />
              ))
            ) : null}
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * One dated archive. The row this screen is downloading shows live progress
 * and a cancel — whether the transfer started from a tap on a cold row, or
 * from a restore discovering that a row listed as ready has been evicted
 * since. A cold row is tappable; only a row whose header was read and found
 * unreadable stays disabled.
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
