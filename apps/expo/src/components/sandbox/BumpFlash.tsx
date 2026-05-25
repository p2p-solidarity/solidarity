/**
 * BumpFlash — 200ms full-screen white flash with a 400ms fade-out for
 * the NFC-tap-feel cue at the UWB bump `confirmed` transition.
 *
 * Docs: dev-sandbox-identity-graph.md §3.3.1 ("visual: full-screen
 * white flash 200ms, fade out 400ms"). Lives in components/sandbox/
 * because it's never rendered on the public surface.
 *
 * Reanimated 4 SharedValue keeps the opacity off the React render path
 * (CLAUDE.md rule §9). The view does NOT block touches even during the
 * fade — pointerEvents='none' — so any in-flight gesture keeps working.
 */
import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export interface BumpFlashProps {
  /** Set true to trigger a single flash; reset to false in the parent after the cycle. */
  readonly visible: boolean;
}

export function BumpFlash({ visible }: BumpFlashProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withSequence(
        withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 400, easing: Easing.in(Easing.cubic) })
      );
    }
  }, [visible, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' },
        style,
      ]}
    />
  );
}
