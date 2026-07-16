/**
 * IDNavBar — shared 44pt navigation bar for IDViews screens. Mirrors the
 * Swift `.navigationTitle(...).navigationBarTitleDisplayMode(.inline)`
 * layout used across PersonalIdentityView / GroupIdentityView /
 * ZKSettingsView / GroupDetailView.
 *
 * Layout: chevron.left (leading) + inline 17pt semibold title + optional
 * trailing slot for toolbar buttons (refresh / qrcode / gearshape).
 */
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

export interface IDNavBarProps {
  readonly title: string;
  readonly leadingLabel?: string;
  readonly onLeading?: () => void;
  readonly trailing?: ReactNode;
}

export function IDNavBar({ title, leadingLabel, onLeading, trailing }: IDNavBarProps): ReactNode {
  const insets = useSafeAreaInsets();
  const handleLeading = (): void => {
    if (onLeading) {
      onLeading();
      return;
    }
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={{ paddingTop: insets.top }} className="bg-pageBg">
      <View className="h-11 flex-row items-center px-4">
        <PressableScale
          onPress={handleLeading}
          accessibilityRole="button"
          accessibilityLabel={leadingLabel ?? 'Back'}
          hitSlop={8}
          containerStyle={{ marginLeft: -4 }}
          className="flex-row items-center px-1 py-1">
          <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
          {leadingLabel ? (
            <ThemedText variant="bodyMedium" className="ml-1">
              {leadingLabel}
            </ThemedText>
          ) : null}
        </PressableScale>
        <View className="flex-1 items-center">
          <ThemedText variant="titleMedium" numberOfLines={1}>
            {title}
          </ThemedText>
        </View>
        <View
          style={{
            minWidth: 24,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
          }}>
          {trailing}
        </View>
      </View>
    </View>
  );
}
