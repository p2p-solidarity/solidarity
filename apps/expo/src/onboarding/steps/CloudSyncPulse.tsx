/**
 * Gentle breathing iCloud glyph shown while the T7 wait gate polls for the
 * user's synced signing key (user-requested: the up-to-15s wait needs
 * motion, not a bare spinner). Pure decoration — no state, no data.
 */
import { useEffect, type ReactNode } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';

export function CloudSyncPulse(): ReactNode {
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [phase]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + phase.value * 0.55,
    transform: [{ scale: 0.92 + phase.value * 0.12 }],
  }));

  return (
    <Animated.View style={pulseStyle}>
      <SfIcon name="icloud" size={44} color={Colors.primaryBlue} />
    </Animated.View>
  );
}
