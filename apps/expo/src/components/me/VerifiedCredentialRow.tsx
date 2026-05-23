/**
 * VerifiedCredentialRow — Figma 743:2981. Swift parity:
 *   • Card: mutedSurface, corner 8, pad 12, horiz mx 16
 *   • Top row: 14pt icon + 15pt title + chevron.right (12pt semibold)
 *   • Divider: 0.5pt
 *   • Bottom row: checkmark.seal.fill (11pt) + level text 11pt +
 *     issuerType.capitalized 11pt tertiary, right-aligned
 *   • Trust levels:
 *       green  → "Level 3 - ZK Verified" / Color.Theme.terminalGreen
 *       blue   → "Level 2 - Fallback"    / Color.Theme.primaryBlue
 *       else   → "Level 1 - Self-attested" / textTertiary
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (VerifiedCredentialRow).
 */
import type { SFSymbol } from 'expo-symbols';
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export type TrustLevel = 'green' | 'blue' | 'other';

export type VerifiedCredentialRowProps = {
  icon: SFSymbol;
  title: string;
  trustLevel: TrustLevel;
  issuerType: string;
  onPress?: () => void;
};

export function VerifiedCredentialRow({
  icon,
  title,
  trustLevel,
  issuerType,
  onPress,
}: VerifiedCredentialRowProps) {
  const levelText =
    trustLevel === 'green'
      ? 'Level 3 - ZK Verified'
      : trustLevel === 'blue'
      ? 'Level 2 - Fallback'
      : 'Level 1 - Self-attested';
  const levelColor =
    trustLevel === 'green'
      ? Colors.terminalGreen
      : trustLevel === 'blue'
      ? Colors.primaryBlue
      : Colors.text3;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className="mx-4 rounded-lg bg-mutedSurface p-3 active:opacity-80"
    >
      <View>
        <View className="flex-row items-center gap-2 pb-3">
          <View
            style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}
          >
            <SfIcon name={icon} size={14} color={Colors.text1} />
          </View>
          <Text
            numberOfLines={1}
            className="text-text1 text-[15px] flex-1"
          >
            {title}
          </Text>
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

        <View
          style={{ height: 0.5, backgroundColor: Colors.divider, marginBottom: 8 }}
        />

        <View className="flex-row items-center gap-1 py-1">
          <View
            style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}
          >
            <SfIcon name="checkmark.seal.fill" size={11} color={levelColor} />
          </View>
          <Text style={{ color: levelColor }} className="text-[11px]">
            {levelText}
          </Text>
          <View className="flex-1" />
          <Text className="text-text3 text-[11px]">
            {capitalize(issuerType)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
