/**
 * BadgeGroupRow — port of Swift `groupRow(group:)` from
 * solidarity/Views/IDViews/IDViewHelpers.swift (section 3, "The Badge").
 *
 * Visual: 44pt accent-tinted circle + name (with "CloudKit" pill) + member
 * count + chevron.right. Used inside the dev-mode badge section.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { ON_DARK } from '@/components/themed';

export interface BadgeGroupRowProps {
  readonly name: string;
  readonly memberCount: number;
  readonly providerLabel?: string;
  readonly onPress: () => void;
}

export function BadgeGroupRow({
  name,
  memberCount,
  providerLabel,
  onPress,
}: BadgeGroupRowProps): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: 12,
        borderRadius: 12,
        backgroundColor: Colors.cardBg,
        borderWidth: 1,
        borderColor: Colors.divider,
      }}
      className="active:opacity-80"
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: `${Colors.accentRose}26`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <SfIcon name="person.3.fill" size={18} color={Colors.accentRose} />
      </View>

      <View style={{ flex: 1 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Text className="text-text1 text-[15px] font-medium" numberOfLines={1}>
            {name}
          </Text>
          {providerLabel ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 8,
                backgroundColor: `${Colors.primaryBlue}CC`,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: ON_DARK,
                }}
              >
                {providerLabel}
              </Text>
            </View>
          ) : null}
        </View>
        <Text className="text-text2 text-[12px] mt-0.5">
          {`${String(memberCount)} ${memberCount === 1 ? 'member' : 'members'}`}
        </Text>
      </View>

      <SfIcon
        name="chevron.right"
        size={12}
        weight="semibold"
        color={Colors.text3}
      />
    </Pressable>
  );
}
