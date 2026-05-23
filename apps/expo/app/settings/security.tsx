/**
 * Security settings — biometric gating toggle + key management entry.
 * Mirrors Swift SecuritySettingsView.
 */
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ToggleRow } from '@/components/settings/SettingRow';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { isBiometricAvailable } from '@/keychain';
import { usePreferences } from '@/settings/preferences';

export default function SecuritySettings() {
  const biometric = usePreferences((s) => s.biometricSensitiveOps);
  const setPref = usePreferences((s) => s.set);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    void isBiometricAvailable().then(setAvailable);
  }, []);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Security</ThemedText>
      </View>

      <ToggleRow
        label="Require Face ID for sensitive ops"
        value={biometric}
        onChange={(v) => { setPref('biometricSensitiveOps', v); }}
      />

      <ThemedSurface variant="card" padded className="mx-4 mt-4">
        <ThemedText variant="caption" tone="tertiary">BIOMETRIC HARDWARE</ThemedText>
        <ThemedText variant="bodyLarge">
          {available ? 'Available' : 'Unavailable or not enrolled'}
        </ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          When enabled, signing / exporting / presenting / deleting credentials
          requires Face ID or device passcode.
        </ThemedText>
      </ThemedSurface>
    </ScrollView>
  );
}
