/**
 * GroupManagementCard — 1:1 port of Swift GroupManagementCardView.
 * (solidarity/Views/SettingsViews/GroupManagementCardView.swift)
 *
 * Visual contract:
 *   • 200pt tall card, rounded 20, divider stroke, cardBg fill, drop shadow
 *   • Background: cover image OR primaryBlue@30% → dustyMauve@30% gradient
 *     with a bottom-up dimmer (pageBg fades over)
 *   • Top row: lock.fill pill (private only, dustyMauve on pageBg@50%) +
 *     destructive-tinted trash button
 *   • Bottom: 28pt mono bold name, optional 14pt description,
 *     12pt monospaced person.2.fill + memberCount, accentRose unsynced badge
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type { GroupModel } from '@/groups/store';

export interface GroupManagementCardProps {
  readonly group: GroupModel;
  readonly onPress: () => void;
  readonly onDelete: () => void;
}

export function GroupManagementCard({
  group,
  onPress,
  onDelete,
}: GroupManagementCardProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={group.name}
      style={{
        height: 200,
        borderRadius: 20,
        backgroundColor: Colors.cardBg,
        borderWidth: 1,
        borderColor: Colors.divider,
        shadowColor: Colors.pageBg,
        shadowOpacity: 0.3,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 5 },
        overflow: 'hidden',
      }}
    >
      {/* Fallback gradient — Swift LinearGradient(primaryBlue.opacity(0.3) → dustyMauve.opacity(0.3)) */}
      <LinearGradient
        colors={['rgba(0,122,255,0.3)', 'rgba(184,155,177,0.3)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 200 }}
      />
      {/* Bottom dimmer — Swift overlay(LinearGradient([.clear, pageBg.opacity(0.6)], top→bottom)) */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', `${Colors.pageBg}99`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 200 }}
      />

      <View className="flex-1 p-4" style={{ height: 200 }}>
        <View className="flex-row items-center">
          {group.isPrivate ? (
            <View
              style={{
                backgroundColor: `${Colors.pageBg}80`,
                borderRadius: 999,
                padding: 6,
              }}
            >
              <SfIcon name="lock.fill" size={12} color={Colors.dustyMauve} />
            </View>
          ) : null}

          <View className="flex-1" />

          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete"
            hitSlop={8}
            style={{
              backgroundColor: `${Colors.destructive}B3`,
              borderRadius: 999,
              padding: 8,
            }}
          >
            <SfIcon name="trash" size={14} color={Colors.text1} />
          </Pressable>
        </View>

        <View className="flex-1" />

        <Text
          numberOfLines={1}
          className="text-text1 text-[28px] font-bold"
        >
          {group.name}
        </Text>

        {group.description.length > 0 ? (
          <Text
            numberOfLines={2}
            className="text-text2 text-[14px] mt-1"
          >
            {group.description}
          </Text>
        ) : null}

        <View className="flex-row items-center gap-3 mt-2">
          <View className="flex-row items-center gap-1">
            <SfIcon name="person.2.fill" size={12} color={Colors.text2} />
            <Text className="text-text2 text-[12px]">
              {String(group.memberCount)}
            </Text>
          </View>

          {!group.isSynced ? (
            <View className="flex-row items-center gap-1">
              <SfIcon
                name="arrow.triangle.2.circlepath"
                size={12}
                color={Colors.accentRose}
              />
              <Text className="text-accentRose text-[12px]">Unsynced</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
