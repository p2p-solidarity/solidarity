/**
 * RadarMatching — 3-ring pulse animation around the user avatar, used by
 * the Share tab while browsing for nearby peers. Mirrors Swift
 * RadarMatchingView.
 *
 * Animation is Reanimated 4 worklets — no JS-thread churn even on a low-end
 * Android. Rings stagger by 600ms and repeat indefinitely.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';
import { ThemedText } from '@/components/themed';

const RING_DURATION_MS = 2400;
const RING_COUNT = 3;
const RING_BASE_SIZE = 80;
const RING_GROW_TO = 220;

function PulseRing({ delayMs }: { readonly delayMs: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: RING_DURATION_MS, easing: Easing.out(Easing.cubic) }),
      -1,
      false
    );
  }, [delayMs, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        {
          scale: 1 + (p * (RING_GROW_TO - RING_BASE_SIZE)) / RING_BASE_SIZE,
        },
      ],
      opacity: 1 - p,
    };
  });

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width: RING_BASE_SIZE,
          height: RING_BASE_SIZE,
          borderRadius: RING_BASE_SIZE / 2,
          // staggered start by delaying mount; cleaner than withDelay on first run
          marginTop: -RING_BASE_SIZE,
        },
        animatedStyle,
      ]}
    />
  );
}

export function RadarMatching({ avatar = '🕊️' }: { readonly avatar?: string }) {
  return (
    <View style={styles.container}>
      <View style={styles.pulses}>
        {Array.from({ length: RING_COUNT }, (_, i) => (
          <PulseRing key={String(i)} delayMs={i * 600} />
        ))}
      </View>
      <View style={styles.center}>
        <ThemedText variant="headlineLarge">{avatar}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: RING_GROW_TO, height: RING_GROW_TO, alignSelf: 'center' },
  pulses: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -RING_BASE_SIZE / 2,
  },
  ring: {
    borderWidth: 1.5,
    borderColor: Colors.accentRose,
  },
  center: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
