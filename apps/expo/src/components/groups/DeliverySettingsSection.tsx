/**
 * DeliverySettingsSection — 1:1 port of Swift DeliverySettingsSection
 *   (solidarity/Views/IDViews/GroupDetailView/DeliverySettingsSection.swift).
 *
 * Single-row searchBg block that navigates to GroupCredentialDeliverySettings.
 * Label "Delivery Settings" + envelope.badge.gearshape icon, trailing chevron.
 */
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type { GroupModel } from '@/groups/store';

export interface DeliverySettingsSectionProps {
  readonly group: GroupModel;
}

export function DeliverySettingsSection({
  group,
}: DeliverySettingsSectionProps): ReactNode {
  const onPress = (): void => {
    router.push({
      pathname: '/groups/[id]/delivery',
      params: { id: group.id },
    });
  };

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Delivery settings"
    >
      <View
        className="bg-searchBg p-4 flex-row items-center"
        style={{ borderWidth: 1, borderColor: Colors.divider, gap: 10 }}
      >
        <SfIcon
          name="envelope.badge.fill"
          size={16}
          color={Colors.text1}
        />
        <Text className="text-text1 text-[15px] flex-1">Delivery Settings</Text>
        <SfIcon
          name="chevron.right"
          size={12}
          weight="semibold"
          color={Colors.text3}
        />
      </View>
    </PressableScale>
  );
}
