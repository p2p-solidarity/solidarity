/**
 * Notification settings — enable/disable push + per-category toggles.
 * Mirrors Swift NotificationSettingsView.
 */
import { ScrollView, View } from 'react-native';

import { ToggleRow } from '@/components/settings/SettingRow';
import { ThemedText } from '@/components/themed';
import { usePreferences } from '@/settings/preferences';

export default function NotificationSettings() {
  const enabled = usePreferences((s) => s.notificationsEnabled);
  const setPref = usePreferences((s) => s.set);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Notifications</ThemedText>
      </View>
      <ToggleRow
        label="Enable push notifications"
        value={enabled}
        onChange={(v) => setPref('notificationsEnabled', v)}
      />
    </ScrollView>
  );
}
