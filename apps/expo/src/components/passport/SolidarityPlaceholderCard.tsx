/**
 * SolidarityPlaceholderCard — 1:1 port of Swift Views/Common/
 * SolidarityScreenPlaceholders.swift's section header card. Shows
 * "Screen <ID>" label + title + subtitle in mutedSurface.
 *
 * Used as the persistent header for the Passport Setup multi-step flow,
 * so the user always knows which step they're on (e.g. "Passport · MRZ").
 */
import { Text, View } from 'react-native';

import { Colors } from '@/constants/Colors';

export type SolidarityPlaceholderCardProps = {
  screenID: string;
  title: string;
  subtitle: string;
};

export function SolidarityPlaceholderCard({
  screenID,
  title,
  subtitle,
}: SolidarityPlaceholderCardProps) {
  return (
    <View className="rounded-xl bg-mutedSurface px-4 py-3 gap-1">
      <Text
        style={{ color: Colors.text3 }}
        className="text-[11px] font-medium uppercase"
      >
        {`Screen ${screenID}`}
      </Text>
      <Text className="text-text1 text-[15px] font-semibold">{title}</Text>
      <Text className="text-text2 text-[13px]">{subtitle}</Text>
    </View>
  );
}
