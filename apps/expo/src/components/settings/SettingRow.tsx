/**
 * SettingRow — single row with label, optional value, optional control.
 * Mirrors the Swift SettingsBlockRow pattern.
 */
import type { ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed';

export interface SettingRowProps {
  readonly label: string;
  readonly value?: string;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
  readonly destructive?: boolean;
}

export function SettingRow({
  label,
  value,
  onPress,
  trailing,
  destructive,
}: SettingRowProps): ReactNode {
  return (
    <Pressable
      className="bg-cardBg flex-row items-center justify-between border-b border-divider px-4 py-3"
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
    >
      <ThemedText variant="bodyLarge" tone={destructive ? 'error' : 'primary'}>
        {label}
      </ThemedText>
      <View className="flex-row items-center">
        {value ? (
          <ThemedText variant="bodyMedium" tone="secondary" className="mr-2">
            {value}
          </ThemedText>
        ) : null}
        {trailing}
        {onPress ? (
          <ThemedText variant="bodyMedium" tone="tertiary" className="ml-2">
            ›
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

export interface ToggleRowProps {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
}

export function ToggleRow({ label, value, onChange }: ToggleRowProps): ReactNode {
  return <SettingRow label={label} trailing={<Switch value={value} onValueChange={onChange} />} />;
}
