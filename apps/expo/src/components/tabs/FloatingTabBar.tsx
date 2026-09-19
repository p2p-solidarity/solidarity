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
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed';
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
        {icon ? <PrimaryTabGlyph name={icon} size={22} color={tint} /> : null}
      </Animated.View>
      <ThemedText variant="caption" style={{ color: tint, fontSize: 11, lineHeight: 14 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Exact Figma paths from creds-design/design/figma/icons. Keeping these
 * local to the tab renderer preserves the shared icon system's name→glyph
 * boundary without falling back to SF Symbols on either platform. */
function PrimaryTabGlyph({
  name,
  size,
  color,
}: {
  readonly name: PrimaryTabIcon;
  readonly size: number;
  readonly color: string;
}): ReactNode {
  const glyph = TAB_GLYPHS[name];
  return (
    <Svg width={size} height={size} viewBox={glyph.viewBox} fill="none">
      <Path
        d={glyph.d}
        stroke={color}
        strokeWidth={glyph.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const TAB_GLYPHS: Readonly<Record<PrimaryTabIcon, {
  readonly viewBox: string;
  readonly strokeWidth: number;
  readonly d: string;
}>> = {
  'tab-page': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    d: 'M5.3163 19.4384C5.92462 18.0052 7.34492 17 9 17H15C16.6551 17 18.0754 18.0052 18.6837 19.4384M16 9.5C16 11.7091 14.2091 13.5 12 13.5C9.79086 13.5 8 11.7091 8 9.5C8 7.29086 9.79086 5.5 12 5.5C14.2091 5.5 16 7.29086 16 9.5ZM22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z',
  },
  'tab-present': {
    viewBox: '0 0 22 22',
    strokeWidth: 1.5,
    d: 'M19.25 13.75V14.85C19.25 16.3901 19.25 17.1602 18.9503 17.7485C18.6866 18.2659 18.2659 18.6866 17.7485 18.9503C17.1602 19.25 16.3901 19.25 14.85 19.25H7.15C5.60986 19.25 4.83978 19.25 4.25153 18.9503C3.73408 18.6866 3.31338 18.2659 3.04973 17.7485C2.75 17.1602 2.75 16.3901 2.75 14.85V13.75M6.41667 7.33333L11 2.75L15.5833 7.33333M11 2.75V13.75',
  },
  'tab-contacts': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    d: 'M18 15.8369C19.4559 16.5683 20.7041 17.742 21.6152 19.2096C21.7956 19.5003 21.8858 19.6456 21.917 19.8468C21.9804 20.2558 21.7008 20.7585 21.3199 20.9204C21.1325 21 20.9216 21 20.5 21M16 11.5322C17.4817 10.7959 18.5 9.26686 18.5 7.5C18.5 5.73314 17.4817 4.20411 16 3.46776M14 7.5C14 9.98528 11.9852 12 9.49996 12C7.01468 12 4.99996 9.98528 4.99996 7.5C4.99996 5.01472 7.01468 3 9.49996 3C11.9852 3 14 5.01472 14 7.5ZM2.55919 18.9383C4.1535 16.5446 6.66933 15 9.49996 15C12.3306 15 14.8464 16.5446 16.4407 18.9383C16.79 19.4628 16.9646 19.725 16.9445 20.0599C16.9289 20.3207 16.7579 20.64 16.5495 20.7976C16.2819 21 15.9138 21 15.1776 21H3.82232C3.08613 21 2.71804 21 2.4504 20.7976C2.24201 20.64 2.07105 20.3207 2.05539 20.0599C2.03529 19.725 2.20992 19.4628 2.55919 18.9383Z',
  },
};
