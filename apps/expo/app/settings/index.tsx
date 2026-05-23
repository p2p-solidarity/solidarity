/**
 * Settings hub — mirrors Swift SettingsView. Each row deep-links to a
 * dedicated screen so the entry stays scannable.
 */
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { SettingRow } from '@/components/settings/SettingRow';
import { ThemedText } from '@/components/themed';
import { usePreferences } from '@/settings/preferences';

export default function SettingsHub() {
  const provider = usePreferences((s) => s.backupProvider);
  const themeMode = usePreferences((s) => s.themeMode);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Settings</ThemedText>
      </View>

      <SettingRow
        label="Backup"
        value={provider === 'iCloud' ? 'iCloud' : 'Google Drive'}
        onPress={() => router.push('/settings/backup')}
      />
      <SettingRow
        label="Security"
        value="Face ID + Keychain"
        onPress={() => router.push('/settings/security')}
      />
      <SettingRow
        label="Privacy"
        onPress={() => router.push('/settings/privacy')}
      />
      <SettingRow
        label="Appearance"
        value={themeMode === 'auto' ? 'Auto' : themeMode === 'dark' ? 'Dark' : 'Light'}
        onPress={() => router.push('/settings/appearance')}
      />
      <SettingRow
        label="Notifications"
        onPress={() => router.push('/settings/notifications')}
      />
      <SettingRow
        label="Developer mode"
        onPress={() => router.push('/settings/developer')}
      />
    </ScrollView>
  );
}
