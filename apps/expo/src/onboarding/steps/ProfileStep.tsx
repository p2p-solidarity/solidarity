/**
 * Profile setup — name + handle input. Mirrors Swift DarkProfileSetupForm.
 */
import { useCallback } from 'react';
import { TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed';

export interface ProfileStepProps {
  readonly name: string;
  readonly handle: string;
  readonly onChange: (next: { name: string; handle: string }) => void;
}

export function ProfileStep({ name, handle, onChange }: ProfileStepProps) {
  const setName = useCallback(
    (v: string) => { onChange({ name: v, handle }); },
    [handle, onChange]
  );
  const setHandle = useCallback(
    (v: string) => { onChange({ name, handle: v.replace(/[^A-Za-z0-9_]/gu, '') }); },
    [name, onChange]
  );

  return (
    <View>
      <View>
        <ThemedText variant="caption" tone="tertiary">NAME</ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Ada Lovelace"
          placeholderTextColor="#9C9C9C"
          autoCapitalize="words"
          autoCorrect={false}
          className="bg-cardBg text-text1 border-divider mt-1 rounded-2xl border px-4 py-3"
        />
      </View>
      <View className="mt-4">
        <ThemedText variant="caption" tone="tertiary">HANDLE</ThemedText>
        <TextInput
          value={handle}
          onChangeText={setHandle}
          placeholder="ada"
          placeholderTextColor="#9C9C9C"
          autoCapitalize="none"
          autoCorrect={false}
          className="bg-cardBg text-text1 border-divider mt-1 rounded-2xl border px-4 py-3"
        />
        <ThemedText variant="caption" tone="tertiary" className="mt-1">
          Letters, numbers, and _ only.
        </ThemedText>
      </View>
    </View>
  );
}
