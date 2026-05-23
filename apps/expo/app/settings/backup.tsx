/**
 * Backup settings — choose between iCloud (iOS only) and Google Drive,
 * trigger a manual backup, view last-backed-up timestamp.
 * Mirrors Swift BackupSettingsView + DataSyncSettingsView.
 */
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';

import { SettingRow, ToggleRow } from '@/components/settings/SettingRow';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import {
  backupMtime,
  performBackupNow,
  setGoogleAccessToken,
  setProvider,
  signInForDrive,
} from '@/backup';
import { usePreferences } from '@/settings/preferences';

export default function BackupSettings() {
  const provider = usePreferences((s) => s.backupProvider);
  const autoBackup = usePreferences((s) => s.autoBackupOnPull);
  const setPref = usePreferences((s) => s.set);

  const [lastBackup, setLastBackup] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void backupMtime().then(setLastBackup).catch(() => null);
  }, [provider]);

  const switchToDrive = async () => {
    try {
      const session = await signInForDrive();
      setGoogleAccessToken(session.accessToken);
      setProvider('googleDrive');
      setPref('backupProvider', 'googleDrive');
    } catch (err) {
      Alert.alert('Sign-in failed', String((err as Error).message ?? err));
    }
  };

  const switchToICloud = () => {
    setProvider('iCloud');
    setPref('backupProvider', 'iCloud');
  };

  const onBackupNow = async () => {
    setBusy(true);
    try {
      const result = await performBackupNow(provider);
      setLastBackup(new Date(result.exportedAt));
      Alert.alert('Backup complete', `${String(result.cards.length)} cards · ${String(result.contacts.length)} contacts`);
    } catch (err) {
      Alert.alert('Backup failed', String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Backup</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          End-to-end encrypted. Your provider only sees ciphertext.
        </ThemedText>
      </View>

      <SettingRow
        label="iCloud"
        value={provider === 'iCloud' ? 'Selected' : Platform.OS === 'ios' ? '' : 'iOS only'}
        onPress={Platform.OS === 'ios' ? switchToICloud : undefined}
      />
      <SettingRow
        label="Google Drive"
        value={provider === 'googleDrive' ? 'Selected' : ''}
        onPress={() => void switchToDrive()}
      />

      <View className="px-4 pt-6">
        <ToggleRow
          label="Auto-backup on pull-down"
          value={autoBackup}
          onChange={(v) => setPref('autoBackupOnPull', v)}
        />
      </View>

      <ThemedSurface variant="card" padded className="mx-4 mt-6">
        <ThemedText variant="caption" tone="tertiary">LAST BACKUP</ThemedText>
        <ThemedText variant="bodyLarge">
          {lastBackup ? lastBackup.toLocaleString() : 'Never'}
        </ThemedText>
      </ThemedSurface>

      <View className="px-4 mt-6 mb-10">
        <ThemedButton
          label={busy ? 'Backing up…' : 'Back up now'}
          fullWidth
          loading={busy}
          onPress={() => void onBackupNow()}
        />
      </View>
    </ScrollView>
  );
}
