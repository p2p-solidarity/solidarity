/**
 * SettingsBlockSection — section wrapper used in dev-mode "Developer" block
 * on the Me tab. Swift parity:
 *   • Section header (14pt textPrimary, horiz pad 16)
 *   • Rows stacked with 8pt gap, inset in mutedSurface card with rounded 8
 *
 * SettingsBlockRow — single row: icon (18pt frame) + title (15pt) +
 * optional trailing text (13pt tertiary) + chevron.right (12pt semibold).
 *
 * Source: solidarity/Views/Common/SettingsBlockComponents.swift.
 */
import type { SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

import { MeSectionHeader } from './MeSectionHeader';

export function SettingsBlockSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <MeSectionHeader title={title} />
      <View className="mx-4 overflow-hidden rounded-lg bg-mutedSurface">
        {children}
      </View>
    </View>
  );
}

export type SettingsBlockRowProps = {
  icon: SFSymbol;
  title: string;
  trailingText?: string;
  onPress?: () => void;
  /** Hide bottom divider — useful for last row in section. */
  isLast?: boolean;
};

export function SettingsBlockRow({
  icon,
  title,
  trailingText,
  onPress,
  isLast = false,
}: SettingsBlockRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="active:opacity-80"
    >
      <View className="flex-row items-center gap-2 px-3 py-4">
        <View
          style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name={icon} size={14} color={Colors.text1} />
        </View>
        <Text className="text-text1 text-[15px] flex-1">{title}</Text>
        {trailingText ? (
          <Text className="text-text3 text-[13px]">{trailingText}</Text>
        ) : null}
        <View
          style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon
            name="chevron.right"
            size={12}
            weight="semibold"
            color={Colors.text3}
          />
        </View>
      </View>
      {!isLast ? (
        <View
          style={{
            height: 0.5,
            backgroundColor: Colors.divider,
            marginLeft: 44,
          }}
        />
      ) : null}
    </Pressable>
  );
}
