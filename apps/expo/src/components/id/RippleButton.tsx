/**
 * RippleButton — port of Swift RippleButton (the "Core" of IDView). A large
 * tappable circle with concentric pulse rings, two states:
 *   • idle       — solid accentRose circle inviting the user to "Create ZK
 *                  Identity" (no commitment) or shows the short commitment
 *                  (member of a group). Rings pulse softly.
 *   • processing — dimmed circle + activity indicator + faster ring pulse.
 *
 * Long-press triggers the group-manager (Swift `handleCoreLongPress`).
 * Tap → `onTap` (create identity or refresh).
 *
 * Animation is Reanimated 4 worklets so it stays smooth on Android.
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';
import { ON_DARK } from '@/components/themed';

export type RippleButtonState = 'idle' | 'processing';

const RING_BASE_SIZE = 110;
const RING_GROW_TO = 280;
const CORE_SIZE = 180;

interface PulseRingProps {
  readonly delayMs: number;
  readonly state: RippleButtonState;
}

function PulseRing({ delayMs, state }: PulseRingProps): ReactNode {
  const progress = useSharedValue(0);

  useEffect(() => {
    const duration = state === 'processing' ? 1400 : 2600;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, {
        duration,
        easing: Easing.out(Easing.cubic),
      }),
      -1,
      false
    );
  }, [delayMs, progress, state]);

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
        },
        animatedStyle,
      ]}
    />
  );
}

export interface RippleButtonProps {
  readonly state: RippleButtonState;
  readonly commitment: string | undefined;
  readonly onTap: () => void;
  readonly onLongPress: () => void;
}

export function RippleButton({
  state,
  commitment,
  onTap,
  onLongPress,
}: RippleButtonProps): ReactNode {
  const isProcessing = state === 'processing';
  const label = labelFor(commitment);

  return (
    <View style={styles.container}>
      <View style={styles.pulses} pointerEvents="none">
        {[0, 1, 2].map((i) => (
          <PulseRing key={String(i)} delayMs={i * 800} state={state} />
        ))}
      </View>

      <Pressable
        onPress={onTap}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={label.spoken}
        delayLongPress={500}
        style={({ pressed }) => [
          styles.core,
          {
            opacity: isProcessing ? 0.85 : pressed ? 0.9 : 1,
          },
        ]}
      >
        {isProcessing ? (
          <ActivityIndicator color={ON_DARK} size="large" />
        ) : (
          <View style={styles.coreContent}>
            <Text style={styles.coreTitle} numberOfLines={1}>
              {label.title}
            </Text>
            {label.subtitle.length > 0 ? (
              <Text style={styles.coreSubtitle} numberOfLines={1}>
                {label.subtitle}
              </Text>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

interface CoreLabel {
  readonly title: string;
  readonly subtitle: string;
  readonly spoken: string;
}

function labelFor(commitment: string | undefined): CoreLabel {
  if (!commitment) {
    return {
      title: 'Create',
      subtitle: 'ZK Identity',
      spoken: 'Create ZK identity',
    };
  }
  return {
    title: 'Active',
    subtitle: shortCommitment(commitment),
    spoken: `Active identity ${shortCommitment(commitment)}`,
  };
}

function shortCommitment(c: string): string {
  if (c.length <= 14) return c;
  return `${c.slice(0, 6)}…${c.slice(-6)}`;
}

const styles = StyleSheet.create({
  container: {
    width: RING_GROW_TO,
    height: RING_GROW_TO,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulses: {
    position: 'absolute',
    width: RING_BASE_SIZE,
    height: RING_BASE_SIZE,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: Colors.accentRose,
  },
  core: {
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
    backgroundColor: Colors.accentRose,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accentRose,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  coreContent: { alignItems: 'center' },
  coreTitle: {
    color: ON_DARK,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  coreSubtitle: {
    color: ON_DARK,
    opacity: 0.85,
    fontSize: 13,
    fontFamily: 'Menlo',
    marginTop: 6,
  },
});
