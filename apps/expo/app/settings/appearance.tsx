/**
 * Appearance settings — light / dark / auto theme toggle.
 * Mirrors Swift AppearanceSettingsView.
 */
import { ScrollView, View } from 'react-native';

import { SettingRow } from '@/components/settings/SettingRow';
import { ThemedText } from '@/components/themed';
import { usePreferences } from '@/settings/preferences';

const OPTIONS = ['auto', 'light', 'dark'] as const;

export default function AppearanceSettings() {
  const mode = usePreferences((s) => s.themeMode);
  const setPref = usePreferences((s) => s.set);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Appearance</ThemedText>
      </View>
      {OPTIONS.map((opt) => (
        <SettingRow
          key={opt}
          label={opt.charAt(0).toUpperCase() + opt.slice(1)}
          value={mode === opt ? '✓' : ''}
          onPress={() => { setPref('themeMode', opt); }}
        />
      ))}
    </ScrollView>
  );
}
