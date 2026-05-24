/**
 * ProfileHeaderCard — Figma 737:2545. Swift parity:
 *   • 56pt warmCream avatar circle (photo / animal / initial)
 *   • 24pt medium name + DID pill (key icon 9pt + 10pt text inside
 *     0.5pt pillBorder, corner radius 2)
 *   • Edit button: 28pt tall, 13pt medium, invertedButton colours,
 *     corner radius 2, horizontal pad 16
 *   • Card: mutedSurface, corner radius 3, horiz pad 12, top pad 16,
 *     bottom pad 24, outer horiz pad 16
 * Source: solidarity/Views/MeViews/MeTabComponents.swift (ProfileHeaderCard).
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export type ProfileHeaderCardProps = {
  name: string;
  did: string;
  /** Pre-rendered avatar contents (image, animal, or initial). */
  avatar: ReactNode;
  onEdit: () => void;
};

export function ProfileHeaderCard({
  name,
  did,
  avatar,
  onEdit,
}: ProfileHeaderCardProps) {
  return (
    <View className="mx-4 rounded-sm3 bg-mutedSurface px-3 pt-4 pb-6">
      <View className="flex-row items-start gap-6">
        <View className="flex-1 flex-row items-start gap-4">
          <View
            className="overflow-hidden rounded-full bg-warmCream"
            style={{ width: 56, height: 56 }}
          >
            {avatar}
          </View>

          <View className="flex-1 gap-2">
            <Text
              numberOfLines={1}
              className="text-text1 text-[24px] font-medium"
            >
              {name}
            </Text>

            <View className="flex-row items-center gap-1 self-start rounded-sm2 border border-pillBorder px-1 py-0.5">
              <View
                style={{ width: 12, height: 12, alignItems: 'center', justifyContent: 'center' }}
              >
                <SfIcon name="key" size={9} color={Colors.text2} />
              </View>
              <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                className="text-text2 text-[10px]"
              >
                {did}
              </Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          className="rounded-sm2 bg-invertedButtonBg px-4 active:opacity-80"
          style={{ height: 28, justifyContent: 'center' }}
        >
          <Text className="text-invertedButtonText text-[13px] font-medium">
            Edit
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
