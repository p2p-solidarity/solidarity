/**
 * DisclosureRowView — Figma 724:22770. Swift parity:
 *   • 14pt terminalGreen leading icon (18pt frame)
 *   • 15pt title + 11pt tertiary source line (e.g. "Src:Profile")
 *   • Show button: 13pt medium, text1 fill, pageBg label, corner 2,
 *     min width 56, min height 28
 *   • Card: mutedSurface, corner 8, pad horiz 12 vert 16, horiz mx 16
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (DisclosureRowView).
 */
import type { SFSymbol } from 'expo-symbols';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export type DisclosureRowViewProps = {
  icon: SFSymbol;
  title: string;
  /** Already-formatted, e.g. "Src:Profile". */
  source: string;
  actionTitle?: string;
  isLoading?: boolean;
  isDisabled?: boolean;
  onPresent: () => void;
};

export function DisclosureRowView({
  icon,
  title,
  source,
  actionTitle = 'Show',
  isLoading = false,
  isDisabled = false,
  onPresent,
}: DisclosureRowViewProps) {
  return (
    <View className="mx-4 flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-4">
      <View
        style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
      >
        <SfIcon name={icon} size={14} color={Colors.terminalGreen} />
      </View>

      <View className="flex-1 gap-1">
        <Text className="text-text1 text-[15px]">{title}</Text>
        <Text className="text-text3 text-[11px]">{source}</Text>
      </View>

      <Pressable
        onPress={onPresent}
        disabled={isDisabled}
        accessibilityRole="button"
        className="rounded-sm2"
        style={{
          minWidth: 56,
          minHeight: 28,
          backgroundColor: Colors.invertedButtonBg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 8,
          opacity: isDisabled && !isLoading ? 0.5 : 1,
        }}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.pageBg} />
        ) : (
          <Text
            style={{ color: Colors.pageBg }}
            className="text-[13px] font-medium"
          >
            {actionTitle}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
