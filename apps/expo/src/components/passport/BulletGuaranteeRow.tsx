/**
 * BulletGuaranteeRow — 1:1 port of Swift PassportOnboardingFlowView+Steps.swift
 * `BulletGuaranteeRow` (Figma 756:3327). 15pt label + 18pt terminalGreen
 * circle with white check, inside mutedSurface 8pt-rounded container.
 */
import { Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export function BulletGuaranteeRow({ text }: { text: string }) {
  return (
    <View className="flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-4">
      <Text className="flex-1 text-text1 text-[15px]">{text}</Text>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: Colors.terminalGreen,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SfIcon name="checkmark" size={10} weight="bold" color="#FFFFFF" />
      </View>
    </View>
  );
}
