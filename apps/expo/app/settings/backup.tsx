/**
 * Backup — 1:1 port of solidarity/Views/SettingsViews/BackupSettingsView.swift.
 *
 * Three sections:
 *   1. iCloud Backup — Enable toggle. When ON, also shows Auto-backup toggle
 *      with subtitle "Automatically backup when cards change".
 *   2. Actions — "Back Up Now" (shows "Working…" while running) and
 *      "Restore from Backup". Footer = "Last: …" timestamp if available.
 *   3. Status — iCloud connectivity row + footer explaining sync behaviour.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
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
  backupMtime,
  BackupRestoreError,
  requestBackup,
  restoreFromBackup,
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
  const autoBackup = usePreferences((s) => s.autoBackupOnPull);
  const setPref = usePreferences((s) => s.set);

  const [lastBackup, setLastBackup] = useState<Date | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [iCloudAvailable, setICloudAvailable] = useState(true);

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

  const onBackupNow = async () => {
    setIsBackingUp(true);
    pushToast(t('backup.encrypting'), 'info', 2000);
    try {
      const result = await requestBackup('manual');
      if (!result.ran) {
        if (result.skipReason === 'needs-connection') {
          pushToast(t('backup.drive.needsConnection'), 'info', 3000);
        }
        return;
      }
      if (result.payload) setLastBackup(new Date(result.payload.exportedAt));
      pushToast(t('backup.success'), 'success');
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

  const onRestore = async () => {
    const ok = await confirmDialog({
      title: t('backup.restorePrompt.title'),
      message: t('backup.restorePrompt.message'),
      confirmLabel: t('backup.restore.confirm'),
      destructive: true,
    });
    if (!ok) return;
    await performRestoreNow();
  };

  const performRestoreNow = async () => {
    try {
      const r = await restoreFromBackup();
      if (!r) {
        appAlert({
          title: t('backup.restore.notFoundTitle'),
          message: t('backup.restore.notFound'),
        });
        return;
      }
      router.back();
    } catch (err) {
      // A "wrong key" failure (v2 under a different Recovery Phrase, or a v1
      // device-key archive on a device that lacks that key) gets the plain
      // "different key" message; everything else is the generic failure. T5
      // adds per-kind copy (root-key-unavailable / unsupported-version).
      const isWrongKey =
        err instanceof BackupRestoreError &&
        (err.kind === 'portable-key-mismatch' || err.kind === 'legacy-key-unavailable');
      const summary = isWrongKey
        ? t('backup.restore.keyMismatch')
        : t('backup.restore.failedSummary');
      showError({ context: 'Backup › Restore', summary, error: err });
    }
  };

  const actionsFooter = lastBackup
    ? `Last: ${lastBackup.toLocaleString()}`
    : undefined;

  const statusFooter = iCloudAvailable
    ? 'Backups are stored in your iCloud Drive and synced across all your devices.'
    : 'Sign in to iCloud in Settings to sync backups across devices. Local backups are still available.';

  const backupDisabled = !backupEnabled || isBackingUp;

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Backup" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* iCloud Backup */}
          <SettingsBlockSection title="iCloud Backup">
            <SettingsBlockToggleRow
              icon="icloud"
              title="Enable iCloud Backup"
              value={backupEnabled}
              onValueChange={(v) => { setPref('backupEnabled', v); }}
            />
            {backupEnabled ? (
              <SettingsBlockToggleRow
                icon="arrow.triangle.2.circlepath"
                title="Auto-backup"
                subtitle="Automatically backup when cards change"
                value={autoBackup}
                onValueChange={(v) => { setPref('autoBackupOnPull', v); }}
              />
            ) : null}
          </SettingsBlockSection>

          {/* Actions */}
          <SettingsBlockSection title="Actions" footer={actionsFooter}>
            <SettingsBlockRow
              icon="icloud.and.arrow.up"
              title="Back Up Now"
              trailingText={isBackingUp ? 'Working…' : undefined}
              showsChevron={false}
              disabled={backupDisabled}
              onPress={() => { void onBackupNow(); }}
            />
            <SettingsBlockRow
              icon="arrow.counterclockwise.icloud"
              title="Restore from Backup"
              showsChevron={false}
              onPress={() => { void onRestore(); }}
            />
          </SettingsBlockSection>

          {/* Status */}
          <SettingsBlockSection title="Status" footer={statusFooter}>
            <SettingsBlockInfoRow
              icon={iCloudAvailable ? 'checkmark.icloud.fill' : 'externaldrive.fill'}
              title={iCloudAvailable ? 'iCloud connected' : 'iCloud unavailable'}
              value=""
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
