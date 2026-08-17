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
 * The v2 tab order and fallback presentation come from `primaryTabs` so the
 * custom bar cannot drift from the Expo Router layout.
 */
import { type ReactNode, useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { useThemeColors } from '@/constants/useThemeColors';
import { haptic } from '@/feedback/haptics';
import { SPRING } from '@/feedback/motion';
import { primaryTabForRoute, type PrimaryTabIcon } from '@/navigation/primaryTabs';

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

export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: FloatingTabBarProps): ReactNode {
  const insets = useSafeAreaInsets();
  // useThemeColors subscribes via useColorScheme() so the bar re-renders on
  // theme flips and reads the scheme-correct values (Colors Proxy alone was
  // returning the light pageBg here even in dark mode — observed on Android).
  const c = useThemeColors();

  return (
    // Outer wrapper carries the bg too so the safe-area inset region under
    // the labels can't bleed through as cream when the dark scheme is active.
    <View style={{ backgroundColor: c.pageBg }}>
      <View
        style={{
          height: 0.5,
          backgroundColor: c.divider,
        }}
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingTop: 12,
          // iOS home indicator (`insets.bottom` ≈ 34) and Android gesture /
          // 3-button nav pill must not overlap the icons. Floor with 12pt so
          // legacy iPhones without a home-indicator inset still keep breathing
          // room under the labels.
          paddingBottom: Math.max(insets.bottom, 12),
          backgroundColor: c.pageBg,
        }}
      >
        {state.routes.map((route, index) => {
          const isSelected = state.index === index;
          const tab = primaryTabForRoute(route.name);
          const label =
            descriptors[route.key]?.options.title ??
            tab?.fallbackLabel ??
            route.name;
          const icon = tab?.icon;

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
              activeColor={c.text1}
              inactiveColor={c.text3}
            />
          );
        })}
      </View>
    </View>
  );
}

interface FlatTabButtonProps {
  readonly label: string;
  readonly icon?: PrimaryTabIcon;
  readonly isSelected: boolean;
  readonly onPress: () => void;
  readonly activeColor: string;
  readonly inactiveColor: string;
}

function FlatTabButton({
  label,
  icon,
  isSelected,
  onPress,
  activeColor,
  inactiveColor,
}: FlatTabButtonProps): ReactNode {
  const tint = isSelected ? activeColor : inactiveColor;

  // The icon shrinks under the finger and "pops" the moment its tab becomes
  // active (overdamped settle → crisp, no wobble), so switching tabs reads as
  // a deliberate selection rather than an instant cut.
  const iconScale = useSharedValue(1);
  const iconAnim = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));

  useEffect(() => {
    if (isSelected) {
      iconScale.value = withSequence(
        withTiming(1.18, { duration: 130 }),
        withSpring(1, SPRING.press),
      );
    }
  }, [isSelected, iconScale]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => {
        iconScale.value = withTiming(0.86, { duration: 90 });
      }}
      onPressOut={() => {
        iconScale.value = withSpring(1, SPRING.press);
      }}
      style={{ flex: 1, alignItems: 'center', rowGap: 3 }}
      hitSlop={8}
    >
      <Animated.View
        style={[{ height: 24, alignItems: 'center', justifyContent: 'center' }, iconAnim]}
      >
        {icon ? <SfIcon name={icon} size={20} color={tint} /> : null}
      </Animated.View>
      <Text style={{ fontSize: 11, fontWeight: '500', color: tint }}>{label}</Text>
    </Pressable>
  );
}
