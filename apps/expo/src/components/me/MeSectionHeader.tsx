/**
 * MeSectionHeader — section title row. Swift parity: 14pt text, foreground
 * `Color.Theme.textPrimary`, padded horizontal 16, left-aligned.
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (MeSectionHeader).
 */
import { Text, View } from 'react-native';

export function MeSectionHeader({ title }: { title: string }) {
  return (
    <View className="px-4">
      <Text className="text-text1 text-[14px]">{title}</Text>
    </View>
  );
}
