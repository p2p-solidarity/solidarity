/**
 * MatchingOrbit — 1:1 port of MatchingOrbitView.swift (which is a thin
 * wrapper around MatchingView, which is a wrapper around MatchingRootView).
 * In Expo we keep the same name for symmetry with the Swift import map.
 *
 * Renders three concentric rings of satellites that rotate independently
 * (outer 14s, middle 10s, inner 7s) plus a central tappable "Nearby N"
 * disk. The tap callback is delegated upward so callers can mount the
 * NearbyPeersSheet.
 *
 * Animation lives in Reanimated 4 shared values to keep the rotation off
 * the JS thread — important when several MatchingOrbit instances may be
 * mounted simultaneously on the Share tab + a peer detail sheet.
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';

export interface MatchingOrbitProps {
  /** Size of the outermost ring. */
  readonly size?: number;
  /** Number to render in the centre disk. */
  readonly nearbyCount: number;
  readonly onCenterTap?: () => void;
}

interface RingSpec {
  readonly padding: number;
  readonly satelliteSize: number;
  readonly durationMs: number;
  readonly reverse: boolean;
}

const RINGS: readonly RingSpec[] = [
  { padding: 4, satelliteSize: 18, durationMs: 14_000, reverse: false },
  { padding: 44, satelliteSize: 16, durationMs: 10_000, reverse: true },
  { padding: 84, satelliteSize: 14, durationMs: 7_000, reverse: false },
];

export function MatchingOrbit({
  size = 260,
  nearbyCount,
  onCenterTap,
}: MatchingOrbitProps): ReactNode {
  return (
    <View style={[styles.root, { width: size, height: size }]}>
      {RINGS.map((ring, idx) => (
        <View
          key={String(idx)}
          pointerEvents="none"
          style={[
            styles.ringStroke,
            {
              top: ring.padding,
              left: ring.padding,
              right: ring.padding,
              bottom: ring.padding,
              borderRadius: (size - ring.padding * 2) / 2,
            },
          ]}
        />
      ))}

      {RINGS.map((ring, idx) => (
        <OrbitRing
          key={`orbit-${String(idx)}`}
          size={size}
          spec={ring}
        />
      ))}

      <Pressable
        onPress={onCenterTap}
        accessibilityRole="button"
        accessibilityLabel="View nearby peers"
        style={styles.center}
      >
        <View style={styles.centerDisk}>
          <Text style={styles.centerLabel}>Nearby</Text>
          <Text style={styles.centerCount}>{String(nearbyCount)}</Text>
        </View>
      </Pressable>
    </View>
  );
}

function OrbitRing({ size, spec }: { readonly size: number; readonly spec: RingSpec }): ReactNode {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(spec.reverse ? -360 : 360, {
        duration: spec.durationMs,
        easing: Easing.linear,
      }),
      -1,
      false
    );
  }, [rotation, spec.durationMs, spec.reverse]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(rotation.value)}deg` }],
  }));

  const radius = size / 2 - spec.padding;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, animStyle]}
    >
      <Satellite size={spec.satelliteSize} x={radius} y={0} parent={size} />
      <Satellite size={spec.satelliteSize} x={0} y={radius} parent={size} />
      <Satellite size={spec.satelliteSize} x={-radius * 0.9} y={-radius * 0.4} parent={size} />
      <Satellite size={spec.satelliteSize} x={radius * 0.4} y={-radius * 0.85} parent={size} />
    </Animated.View>
  );
}

function Satellite({
  size,
  x,
  y,
  parent,
}: {
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly parent: number;
}): ReactNode {
  return (
    <View
      style={[
        styles.satellite,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          left: parent / 2 - size / 2 + x,
          top: parent / 2 - size / 2 + y,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  ringStroke: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Colors.divider,
  },
  center: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  centerDisk: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.cardSurface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  centerLabel: { color: Colors.text1, fontSize: 12, fontWeight: '600' },
  centerCount: { color: Colors.text1, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  satellite: {
    position: 'absolute',
    backgroundColor: `${Colors.featureAccent}99`,
  },
});
