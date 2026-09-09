/**
 * iCloud download state — the user-facing half. The behaviour is pinned in
 * archiveDownload.test.ts (poller) and icloudBackupRoundtrip.test.ts
 * (provider + restore mapping); this only pins that the screen, the sync
 * status and the locales actually SAY it, and that the native surface the TS
 * side relies on exists on both platforms.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const DOWNLOAD_COPY = [
  'backup.archives.cloudOnly',
  'backup.archives.downloading',
  'backup.archives.downloadingPercent',
  'backup.download.trailing',
  'backup.download.trailingPercent',
  'backup.download.cancel',
  'backup.download.cancelHint',
  'backup.restore.downloadFailed',
  'backup.sync.downloading',
  'backup.sync.downloadingToast',
] as const;

describe('iCloud download state surface', () => {
  it('the Backup screen downloads with progress instead of calling an undelivered archive unreadable', () => {
    const screen = source('../../app/settings/backup.tsx');

    expect(screen).toContain('ensureArchiveDownloaded(');
    expect(screen).toContain("err.kind === 'download-pending'");
    expect(screen).toContain("t('backup.archives.cloudOnly')");
    expect(screen).toContain("t('backup.archives.downloadingPercent', { percent })");
    expect(screen).toContain("t('backup.sync.downloading')");
    expect(screen).toContain('isDownloadPendingError(error)');
    // A cold row is tappable (the tap starts the transfer), the live row can
    // cancel, and leaving the screen aborts the wait (the transfer continues).
    expect(screen).toContain('onDownload(archive.name, date)');
    expect(screen).toContain("t('backup.download.cancel')");
    expect(screen).toContain('downloadAbort.current?.abort()');
  });

  it('sync reports an undelivered peer revision as pending, never as an error of this device', () => {
    const sync = source('../../src/backup/cloudSync.ts');

    expect(sync).toContain("detail: waitingForDownload ? 'icloud-download' : null");
    expect(sync).toContain("status: interrupted || waitingForDownload ? 'pending' : 'error'");
    // A new pass, or a local edit, must clear the detail — otherwise the row
    // keeps saying "waiting for iCloud" while a sync is actively running.
    expect(sync).toContain("setState({ status: 'syncing', detail: null })");
    expect(sync).toContain("setState({ status: 'pending', detail: null })");
  });

  it('both locales carry every piece of download copy', () => {
    const enMap = en as Record<string, string>;
    const zhMap = zhHant as Record<string, string>;
    for (const key of DOWNLOAD_COPY) {
      expect(typeof enMap[key]).toBe('string');
      expect(enMap[key]?.length ?? 0).toBeGreaterThan(0);
      expect(typeof zhMap[key]).toBe('string');
      expect(zhMap[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('the native spec exposes transfer state, and both platforms implement it', () => {
    const spec = source('../../../../nitro-modules/keystone/src/specs/CloudKit.nitro.ts');
    expect(spec).toContain('getFileBackupDownloadState(filename: string): Promise<FileBackupDownloadState>');
    expect(spec).toContain('startFileBackupDownload(filename: string): Promise<void>');

    const swift = source('../../../../nitro-modules/keystone/ios/HybridCloudKit+FileBackup.swift');
    expect(swift).toContain(
      'func getFileBackupDownloadState(filename: String) throws -> Promise<FileBackupDownloadState>',
    );
    expect(swift).toContain('NSMetadataUbiquitousItemPercentDownloadedKey');
    expect(swift).toContain('startDownloadingUbiquitousItem');
    // The fail-fast read is unchanged: sync must never block a native executor.
    expect(swift).toContain('icloud_download_pending');

    const kotlin = source(
      '../../../../nitro-modules/keystone/android/src/main/java/com/margelo/nitro/gg/solidarity/keystone/HybridCloudKit.kt',
    );
    expect(kotlin).toContain(
      'override fun getFileBackupDownloadState(filename: String): Promise<FileBackupDownloadState>',
    );
    expect(kotlin).toContain('override fun startFileBackupDownload(filename: String): Promise<Unit>');
  });
});
