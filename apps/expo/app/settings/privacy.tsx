/**
 * Privacy settings — entry into sharing defaults + selective disclosure.
 * Mirrors Swift PrivacySettingsView.
 */
import { ScrollView, View } from 'react-native';

import { SettingRow } from '@/components/settings/SettingRow';
import { ThemedText } from '@/components/themed';

export default function PrivacySettings() {
  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Privacy</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Control what you reveal at each sharing level.
        </ThemedText>
      </View>
      <SettingRow label="Default sharing level" value="Professional" />
      <SettingRow label="Selective disclosure" value="3 fields hidden" />
      <SettingRow label="Allow forwarding" value="On" />
    </ScrollView>
  );
}
