/**
 * FloatingTabBar — 1:1 port of CustomFloatingTabBar from
 * solidarity/Views/Common/TabBarComponents.swift.
 *
 * Flat (not pill — name is preserved from Swift) bottom tab bar with:
 *   • 0.5pt top divider in `divider`
 *   • `pageBg` background
 *   • 3 evenly spaced icon + label columns
 *   • active foreground = text1, inactive = text3
 *   • soft impact haptic on switch (skipped when re-tapping current tab)
 *
 * To wire: import in `apps/expo/app/(tabs)/_layout.tsx` and pass to Tabs:
 *
 *   import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
 *   import { FloatingTabBar } from '@/components/tabs/FloatingTabBar';
 *   …
 *   <Tabs tabBar={(p: BottomTabBarProps) => <FloatingTabBar {...p} />}>
 *
 * Not wired here — _layout currently uses the default Tabs bar so
 * dropping in this component is a single follow-up commit.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

interface TabRoute {
  readonly key: string;
  readonly name: string;
}

type TabDescriptors = Readonly<Record<string, {
  readonly options: {
    readonly title?: string;
    readonly tabBarLabel?: string;
  };
}>>;

interface TabNavigationLike {
  readonly emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
    readonly defaultPrevented: boolean;
  };
  readonly navigate: (target: { name: string; merge: true }) => void;
}

interface TabStateLike {
  readonly index: number;
  readonly routes: readonly TabRoute[];
}

export interface FloatingTabBarProps {
  readonly state: TabStateLike;
  readonly descriptors: TabDescriptors;
  readonly navigation: TabNavigationLike;
}

const TAB_ICONS: Readonly<Record<string, 'person.2' | 'dot.radiowaves.left.and.right' | 'person.crop.circle'>> = {
  'people/index': 'person.2',
  'share/index': 'dot.radiowaves.left.and.right',
  'me/index': 'person.crop.circle',
};

const TAB_LABELS: Readonly<Record<string, string>> = {
  'people/index': 'People',
  'share/index': 'Share',
  'me/index': 'Me',
};

export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: FloatingTabBarProps): ReactNode {
  const insets = useSafeAreaInsets();

  return (
    <View>
      <View
        style={{
          height: 0.5,
          backgroundColor: Colors.divider,
        }}
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: Math.max(insets.bottom, 16) + 34,
          backgroundColor: Colors.pageBg,
        }}
      >
        {state.routes.map((route, index) => {
          const isSelected = state.index === index;
          const label =
            descriptors[route.key]?.options.title ??
            TAB_LABELS[route.name] ??
            route.name;
          const icon = TAB_ICONS[route.name];

          const onPress = (): void => {
            if (isSelected) return;
            haptic('tap');
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!event.defaultPrevented) {
              navigation.navigate({ name: route.name, merge: true });
            }
          };

          return (
            <FlatTabButton
              key={route.key}
              label={label}
              icon={icon}
              isSelected={isSelected}
              onPress={onPress}
            />
          );
        })}
      </View>
    </View>
  );
}

interface FlatTabButtonProps {
  readonly label: string;
  readonly icon?: 'person.2' | 'dot.radiowaves.left.and.right' | 'person.crop.circle';
  readonly isSelected: boolean;
  readonly onPress: () => void;
}

function FlatTabButton({
  label,
  icon,
  isSelected,
  onPress,
}: FlatTabButtonProps): ReactNode {
  const tint = isSelected ? Colors.text1 : Colors.text3;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', rowGap: 3 }}
      hitSlop={8}
    >
      <View style={{ height: 24, alignItems: 'center', justifyContent: 'center' }}>
        {icon ? <SfIcon name={icon} size={20} color={tint} /> : null}
      </View>
      <Text style={{ fontSize: 11, fontWeight: '500', color: tint }}>{label}</Text>
    </Pressable>
  );
}
