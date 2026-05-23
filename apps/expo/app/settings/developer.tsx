/**
 * Developer mode — gates debug-only screens. Mirrors Swift DeveloperModeManager.
 */
import { ScrollView, View } from 'react-native';

import { SettingRow, ToggleRow } from '@/components/settings/SettingRow';
import { ThemedText } from '@/components/themed';
import { usePreferences } from '@/settings/preferences';

export default function DeveloperSettings() {
  const enabled = usePreferences((s) => s.developerMode);
  const setPref = usePreferences((s) => s.set);
  const reset = usePreferences((s) => s.reset);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Developer</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Unsupported tools — proceed at your own risk.
        </ThemedText>
      </View>
      <ToggleRow
        label="Developer mode"
        value={enabled}
        onChange={(v) => setPref('developerMode', v)}
      />
      {enabled ? (
        <>
          <SettingRow label="Reset all preferences" destructive onPress={() => reset()} />
        </>
      ) : null}
    </ScrollView>
  );
}
