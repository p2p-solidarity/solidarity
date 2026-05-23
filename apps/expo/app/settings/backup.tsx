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
import { Alert, ScrollView, View } from 'react-native';
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
  performBackupNow,
  restoreFromBackup,
} from '@/backup';
import { pushToast } from '@/feedback/toast';
import { usePreferences } from '@/settings/preferences';

export default function BackupSettings() {
  const insets = useSafeAreaInsets();
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
    pushToast('Encrypting and uploading to iCloud', 'info', 2000);
    try {
      const result = await performBackupNow(provider);
      setLastBackup(new Date(result.exportedAt));
      pushToast('Your data is safely backed up', 'success');
    } catch (err) {
      const msg = (err as Error).message;
      pushToast(msg, 'error');
      Alert.alert('Error', msg);
    } finally {
      setIsBackingUp(false);
    }
  };

  const onRestore = () => {
    Alert.alert(
      'Restore from Backup?',
      'This will replace your current cards and contacts with the backed up data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: () => { void performRestoreNow(); },
        },
      ]
    );
  };

  const performRestoreNow = async () => {
    try {
      const r = await restoreFromBackup();
      if (!r) {
        Alert.alert('Error', 'No backup found.');
        return;
      }
      router.back();
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
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
              onPress={onRestore}
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
