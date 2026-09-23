/**
 * SettingRow — single row with label, optional value, optional control.
 * Mirrors the Swift SettingsBlockRow pattern. A tappable row presses through
 * `PressableScale` (crisp scale + haptic); a read-only row is a plain View.
 */
import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { ThemedText } from '@/components/themed';

export interface SettingRowProps {
  readonly label: string;
  readonly value?: string;
  readonly onPress?: () => void;
  readonly trailing?: ReactNode;
  readonly destructive?: boolean;
}

const ROW_CLASS = 'flex-row items-center justify-between border-b border-divider bg-cardBg px-4 py-3';
const ROW_STYLE = { borderBottomWidth: 0.5, minHeight: 52 } as const;

export function SettingRow({
  label,
  value,
  onPress,
  trailing,
  destructive,
}: SettingRowProps): ReactNode {
  const content = (
    <>
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
    </>
  );

  if (!onPress) {
    return (
      <View className={ROW_CLASS} style={ROW_STYLE}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      className={ROW_CLASS}
      style={ROW_STYLE}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}>
      {content}
    </PressableScale>
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
