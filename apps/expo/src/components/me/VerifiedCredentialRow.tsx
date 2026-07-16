/**
 * VerifiedCredentialRow — Figma 743:2981. Swift parity:
 *   • Card: mutedSurface, corner 8, pad 12, horiz mx 16
 *   • Top row: 14pt icon + 15pt title + chevron.right (12pt semibold)
 *   • Divider: 0.5pt
 *   • Bottom row: checkmark.seal.fill (11pt) + level text 11pt +
 *     issuerType.capitalized 11pt tertiary, right-aligned
 *   • Trust levels:
 *       L3+ → "Level 3+ - Passport ZK + AA" / Color.Theme.terminalGreen
 *       L3  → "Level 3 - Passport ZK (No AA)" / Color.Theme.primaryBlue
 *       L1  → "Level 1 - Fallback / Non-ZK" / textTertiary
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (VerifiedCredentialRow).
 */
import type { SFSymbol } from 'expo-symbols';
import { View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  credentialTrustLabelForLevel,
  credentialTrustToneForLevel,
  type TrustDisplayTone,
} from '@/credentials/trustDisplay';
import type { TrustLevel as StoredTrustLevel } from '@/credentials/store';

export interface VerifiedCredentialRowProps {
  readonly icon: SFSymbol;
  readonly title: string;
  readonly trustLevel: StoredTrustLevel;
  readonly issuerType: string;
  readonly onPress?: () => void;
}

export function VerifiedCredentialRow({
  icon,
  title,
  trustLevel,
  issuerType,
  onPress,
}: VerifiedCredentialRowProps) {
  const levelText = credentialTrustLabelForLevel(trustLevel);
  const levelColor = levelColorForTone(credentialTrustToneForLevel(trustLevel));

  return (
    <PressableScale
      haptic="tap"
      onPress={onPress}
      accessibilityRole="button"
      containerStyle={{ marginHorizontal: 16 }}>
      <ThemedSurface variant="inset" className="rounded-none p-3">
        <View className="flex-row items-center gap-2 pb-3">
          <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
            <SfIcon name={icon} size={14} color={Colors.text1} />
          </View>
          <ThemedText variant="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </ThemedText>
          <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
            <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
          </View>
        </View>

        <View style={{ height: 0.5, backgroundColor: Colors.divider, marginBottom: 8 }} />

        <View className="flex-row items-center gap-1 py-1">
          <View style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}>
            <SfIcon name="checkmark.seal.fill" size={11} color={levelColor} />
          </View>
          <ThemedText variant="caption" style={{ color: levelColor }}>
            {levelText}
          </ThemedText>
          <View className="flex-1" />
          <ThemedText variant="caption" tone="tertiary">
            {capitalize(issuerType)}
          </ThemedText>
        </View>
      </ThemedSurface>
    </PressableScale>
  );
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function levelColorForTone(tone: TrustDisplayTone): string {
  switch (tone) {
    case 'green':
      return Colors.terminalGreen;
    case 'blue':
      return Colors.primaryBlue;
    default:
      return Colors.text3;
  }
}
