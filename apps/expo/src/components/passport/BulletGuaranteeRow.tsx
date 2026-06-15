/**
 * BulletGuaranteeRow — 1:1 port of Swift PassportOnboardingFlowView+Steps.swift
 * `BulletGuaranteeRow` (Figma 756:3327). 15pt label + 18pt trailing badge,
 * inside mutedSurface 8pt-rounded container.
 *
 * `checked` (default `true`) controls the trailing badge: a terminalGreen
 * filled circle with a white check when the item is satisfied/disclosed, or
 * a grey-bordered hollow circle when it is NOT — used by the passport proof
 * step to show which fields the real `DEFAULT_DISCLOSURE_POLICY` keeps
 * hidden (e.g. Name) without faking a green check it didn't earn.
 */
import { Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export function BulletGuaranteeRow({
  text,
  checked = true,
}: {
  text: string;
  checked?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2 rounded-lg bg-mutedSurface px-3 py-4">
      <Text className="flex-1 text-text1 text-[15px]">{text}</Text>
      {checked ? (
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
      ) : (
        <View
          style={{
            width: 18,
            height: 18,
            borderRadius: 9,
            borderWidth: 1.5,
            borderColor: Colors.text3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SfIcon name="xmark" size={9} weight="bold" color={Colors.text3} />
        </View>
      )}
    </View>
  );
}
