/**
 * RadarMatching — 1:1 port of solidarity/Views/SharingViews/RadarMatchingView.swift.
 *
 * Layout (centred in `size×size`):
 *   • 3 static concentric rings at 85% / 60% / 35% diameter (radarRing).
 *   • Soft radial-gradient glow sphere (radarGlow), 36% diameter.
 *   • Centre orb (16% diameter) with white→featureAccent radial gradient
 *     + 1pt featureAccent border.
 *   • When `isMatching`, 3 expanding pulse rings (scale 0.3→1.0, opacity
 *     0.6→0.0, 3s easeOut, staggered 1s) using featureAccent.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { Colors } from '@/constants/Colors';

const PULSE_DURATION_MS = 3000;
const PULSE_STAGGER_MS = 1000;
const PULSE_COUNT = 3;
const PULSE_SCALE_FROM = 0.3;
const PULSE_OPACITY_FROM = 0.6;

interface Props {
  readonly size?: number;
  readonly isMatching?: boolean;
}

function PulseRing({ size, delayMs }: { readonly size: number; readonly delayMs: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.out(Easing.cubic) }),
        -1,
        false,
      ),
    );
    return () => { cancelAnimation(progress); };
  }, [delayMs, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [{ scale: PULSE_SCALE_FROM + p * (1 - PULSE_SCALE_FROM) }],
      opacity: PULSE_OPACITY_FROM * (1 - p),
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulseRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        animatedStyle,
      ]}
    />
  );
}

export function RadarMatching({ size = 260, isMatching = false }: Props) {
  const half = size / 2;
  const glowR = size * 0.18;   // 36% diameter → 18% radius
  const orbR = size * 0.08;    // 16% diameter → 8% radius

  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      {isMatching ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: PULSE_COUNT }, (_, i) => (
            <PulseRing key={String(i)} size={size} delayMs={i * PULSE_STAGGER_MS} />
          ))}
        </View>
      ) : null}

      <Svg
        pointerEvents="none"
        width={size}
        height={size}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <RadialGradient id="radar-glow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%" stopColor={Colors.radarGlow} stopOpacity={1} />
            <Stop offset="60%" stopColor={Colors.radarGlow} stopOpacity={0.3} />
            <Stop offset="100%" stopColor={Colors.radarGlow} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="radar-orb" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.8} />
            <Stop offset="60%" stopColor={Colors.featureAccent} stopOpacity={0.3} />
            <Stop offset="100%" stopColor={Colors.featureAccent} stopOpacity={0.1} />
          </RadialGradient>
        </Defs>

        {/* Static concentric rings (radii in % of size) */}
        <Circle cx={half} cy={half} r={size * 0.425} stroke={Colors.radarRing} strokeWidth={1} fill="none" />
        <Circle cx={half} cy={half} r={size * 0.300} stroke={Colors.radarRing} strokeWidth={1} fill="none" />
        <Circle cx={half} cy={half} r={size * 0.175} stroke={Colors.radarRing} strokeWidth={1} fill="none" />

        {/* Soft glow halo around the orb */}
        <Circle cx={half} cy={half} r={glowR} fill="url(#radar-glow)" />

        {/* Centre orb */}
        <Circle cx={half} cy={half} r={orbR} fill="url(#radar-orb)" />
        <Circle
          cx={half}
          cy={half}
          r={orbR}
          stroke={Colors.featureAccent}
          strokeOpacity={0.4}
          strokeWidth={1}
          fill="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  pulseRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 1.5,
    borderColor: Colors.featureAccent,
  },
});
