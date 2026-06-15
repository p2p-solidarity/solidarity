/**
 * PressableScale — the standard touch-feedback wrapper for anything tappable
 * that isn't a CTA (rows, tiles, icon buttons, list cells). CTAs still go
 * through `ThemedButton` (apps/expo rule 1); this is its lighter sibling for
 * everything else that used to rely on a bare `active:opacity-*` class.
 *
 * Touch-down springs the whole surface to `scaleTo` and release springs it
 * back, using the over-damped `SPRING.press` so the motion is crisp with no
 * wobble. A haptic fires on press (default `tap`; pass `haptic={false}` to
 * silence on noisy / repeated controls).
 *
 * Layout: the scale lives on an outer `Animated.View` (so the surface's own
 * background + border scale, not just its contents — same shape as
 * ThemedButton). Pass `fill` for `flex: 1` parents (tiles in a row), and
 * keep the visual classes (`bg-*`, padding, radius) on `className` / `style`
 * which forward to the inner Pressable.
 */
import type { ReactNode } from 'react';
import {
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from 'react-native-reanimated';

import { haptic as fireHaptic, type HapticKind } from '@/feedback/haptics';
import { SCALE, SPRING } from '@/feedback/motion';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  readonly children: ReactNode;
  /** Touch-down scale target. Default `SCALE.press` (0.97). */
  readonly scaleTo?: number;
  /** Spring used for both directions. Default `SPRING.press` (crisp). */
  readonly springConfig?: WithSpringConfig;
  /** Haptic fired on press. Default `'tap'`; pass `false` to silence. */
  readonly haptic?: HapticKind | false;
  /** Stretch the animated wrapper to fill its flex parent (`flex: 1`). */
  readonly fill?: boolean;
  /** Visual style for the inner Pressable (bg, padding, border, radius). */
  readonly style?: StyleProp<ViewStyle>;
  /** Extra style for the animated wrapper (margins, alignSelf). */
  readonly containerStyle?: StyleProp<ViewStyle>;
  /** NativeWind classes for the inner Pressable. */
  readonly className?: string;
}

export function PressableScale({
  children,
  scaleTo = SCALE.press,
  springConfig = SPRING.press,
  haptic = 'tap',
  fill = false,
  style,
  containerStyle,
  className,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps): ReactNode {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePressIn = (e: GestureResponderEvent) => {
    scale.value = withSpring(scaleTo, springConfig);
    onPressIn?.(e);
  };
  const handlePressOut = (e: GestureResponderEvent) => {
    scale.value = withSpring(1, springConfig);
    onPressOut?.(e);
  };
  const handlePress = (e: GestureResponderEvent) => {
    if (haptic !== false) fireHaptic(haptic);
    onPress?.(e);
  };

  return (
    <Animated.View style={[fill ? styles.fill : undefined, containerStyle, animStyle]}>
      <Pressable
        style={style}
        className={className}
        disabled={disabled}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        {...rest}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
