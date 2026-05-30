/**
 * MeActionTile — Figma 737:2565. Swift parity:
 *   • 40pt primaryBlue@15% circle + 18pt icon
 *   • 15pt label
 *   • Card: mutedSurface, corner 2, pad horiz 12 vert 16, min height 72
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (MeActionTile).
 */
import type { SFSymbol } from 'expo-symbols';
import { Text, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { SCALE } from '@/feedback/motion';

export type MeActionTileProps = {
  icon: SFSymbol;
  title: string;
  onPress: () => void;
};

export function MeActionTile({ icon, title, onPress }: MeActionTileProps) {
  return (
    <PressableScale
      fill
      haptic="tap"
      scaleTo={SCALE.tile}
      onPress={onPress}
      accessibilityRole="button"
      className="flex-1 flex-row items-center gap-2 rounded-sm2 bg-mutedSurface px-3 py-4"
      style={{ minHeight: 72 }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: `${Colors.primaryBlue}26`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SfIcon name={icon} size={18} color={Colors.primaryBlue} />
      </View>
      <Text
        numberOfLines={2}
        className="text-text1 text-[15px] flex-1"
      >
        {title}
      </Text>
    </PressableScale>
  );
}
