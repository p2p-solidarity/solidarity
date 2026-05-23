/**
 * SakuraIcon — port of solidarity/Views/Common/SakuraIconView.swift.
 *
 * Five ellipse petals laid out around a centre circle. When `animating`,
 * petals breathe (opacity + scale loop) via Reanimated 4 so the JS thread
 * stays free for scrolls and gestures.
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export interface SakuraIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly animating?: boolean;
}

const PETAL_COUNT = 5;

export function SakuraIcon({
  size = 32,
  color = '#FFFFFF',
  animating = false,
}: SakuraIconProps): ReactNode {
  const progress = useSharedValue(animating ? 1 : 0);

  useEffect(() => {
    if (animating) {
      progress.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
    return () => {
      cancelAnimation(progress);
    };
  }, [animating, progress]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: 0.85 + progress.value * 0.1,
    transform: [{ scale: 0.95 + progress.value * 0.05 }],
  }));

  const petalWidth = size * 0.28;
  const petalHeight = size * 0.48;
  const petalRadius = size * 0.28;
  const centerSize = size * 0.18;

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={[styles.center, { width: size, height: size }, animStyle]}
      >
        {Array.from({ length: PETAL_COUNT }, (_, index) => {
          const angle = (index * 360) / PETAL_COUNT;
          return (
            <View
              key={index}
              style={[
                styles.petal,
                {
                  width: petalWidth,
                  height: petalHeight,
                  borderRadius: petalWidth,
                  backgroundColor: color,
                  transform: [
                    { rotate: `${String(angle)}deg` },
                    { translateY: -petalRadius },
                  ],
                },
              ]}
            />
          );
        })}
      </Animated.View>
      <View
        style={[
          styles.dot,
          {
            width: centerSize,
            height: centerSize,
            borderRadius: centerSize / 2,
            backgroundColor: color,
            opacity: 0.8,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  petal: { position: 'absolute' },
  dot: { position: 'absolute' },
});
