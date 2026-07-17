import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { SfIcon } from '@/components/icons/SfIcon';
import { useThemeColors, type ThemeColors } from '@/constants/useThemeColors';

export type PublishAnimationPhase =
  | 'ready'
  | 'provisioning'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'error';

export type RelayNodeStatus = 'pending' | 'accepted' | 'rejected';

export interface PublishingConstellationProps {
  readonly phase: PublishAnimationPhase;
  readonly relayStatuses?: readonly RelayNodeStatus[];
}

const WIDTH = 236;
const HEIGHT = 176;
const CENTER = { x: 118, y: 88 };
const ENDPOINTS = [
  { x: 118, y: 24 },
  { x: 42, y: 145 },
  { x: 194, y: 145 },
] as const;

export function PublishingConstellation({
  phase,
  relayStatuses = [],
}: PublishingConstellationProps): ReactNode {
  const reduceMotion = useReducedMotion();
  const c = useThemeColors();
  const travel = useSharedValue(0);
  const dotOpacity = useSharedValue(0);
  const pulse = useSharedValue(1);
  const reveal = useSharedValue(1);
  const busy = phase === 'provisioning' || phase === 'publishing';

  useEffect(() => {
    cancelAnimation(travel);
    cancelAnimation(dotOpacity);
    cancelAnimation(pulse);
    cancelAnimation(reveal);
    travel.value = 0;
    dotOpacity.value = 0;
    pulse.value = 1;
    reveal.value = 1;

    if (!reduceMotion && busy) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.055, { duration: 520, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
      );
    }
    if (phase === 'publishing') {
      dotOpacity.value = reduceMotion
        ? 1
        : withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
      if (!reduceMotion) {
        travel.value = withRepeat(
          withTiming(1, { duration: 1_150, easing: Easing.linear }),
          -1,
          false,
        );
      }
    }
    if (!reduceMotion && (phase === 'published' || phase === 'partial')) {
      reveal.value = 0.9;
      reveal.value = withSpring(1, { damping: 12, stiffness: 210, mass: 0.85 });
    }
    return () => {
      cancelAnimation(travel);
      cancelAnimation(dotOpacity);
      cancelAnimation(pulse);
      cancelAnimation(reveal);
    };
  }, [busy, dotOpacity, phase, pulse, reduceMotion, reveal, travel]);

  const centerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value * reveal.value }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: WIDTH, height: HEIGHT, alignSelf: 'center' }}>
      {ENDPOINTS.map((endpoint, index) => (
        <ConnectionLine key={`line-${String(index)}`} from={CENTER} to={endpoint} color={c.divider} />
      ))}

      {ENDPOINTS.map((endpoint, index) => (
        <TravelDot
          key={`dot-${String(index)}`}
          progress={travel}
          opacity={dotOpacity}
          from={CENTER}
          to={endpoint}
          offset={index / ENDPOINTS.length}
          reduceMotion={reduceMotion}
          color={c.primaryBlue}
        />
      ))}

      {ENDPOINTS.map((endpoint, index) => (
        <RelayNode
          key={`node-${String(index)}`}
          index={index}
          point={endpoint}
          status={relayStatuses[index] ?? 'pending'}
          active={phase === 'publishing'}
          reduceMotion={reduceMotion}
          colors={c}
        />
      ))}

      <Animated.View
        style={[
          {
            position: 'absolute',
            left: CENTER.x - 27,
            top: CENTER.y - 27,
            width: 54,
            height: 54,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.cardBg,
            borderWidth: 1,
            borderColor:
              phase === 'published'
                ? c.terminalGreen
                : phase === 'partial' || phase === 'error'
                  ? c.warning
                  : c.primaryBlue,
            shadowColor: phase === 'published' ? c.terminalGreen : c.primaryBlue,
            shadowOpacity: busy || phase === 'published' ? 0.22 : 0.08,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          },
          centerStyle,
        ]}>
        <SfIcon
          name={centerIcon(phase)}
          size={24}
          color={centerColor(phase, c)}
          weight="semibold"
        />
      </Animated.View>
    </View>
  );
}

function ConnectionLine({
  from,
  to,
  color,
}: {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly color: string;
}): ReactNode {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = `${String((Math.atan2(dy, dx) * 180) / Math.PI)}deg`;
  return (
    <View
      style={{
        position: 'absolute',
        left: (from.x + to.x) / 2 - length / 2,
        top: (from.y + to.y) / 2,
        width: length,
        height: 1,
        backgroundColor: color,
        transform: [{ rotate: angle }],
      }}
    />
  );
}

function TravelDot({
  progress,
  opacity,
  from,
  to,
  offset,
  reduceMotion,
  color,
}: {
  readonly progress: SharedValue<number>;
  readonly opacity: SharedValue<number>;
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly offset: number;
  readonly reduceMotion: boolean;
  readonly color: string;
}): ReactNode {
  const style = useAnimatedStyle(() => {
    const position = reduceMotion ? 0.6 : (progress.value + offset) % 1;
    return {
      opacity:
        opacity.value *
        (reduceMotion ? 0.65 : interpolate(position, [0, 0.14, 0.82, 1], [0, 1, 1, 0])),
      transform: [
        { translateX: interpolate(position, [0, 1], [from.x - 4, to.x - 4]) },
        { translateY: interpolate(position, [0, 1], [from.y - 4, to.y - 4]) },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          top: 0,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

function RelayNode({
  index,
  point,
  status,
  active,
  reduceMotion,
  colors,
}: {
  readonly index: number;
  readonly point: { readonly x: number; readonly y: number };
  readonly status: RelayNodeStatus;
  readonly active: boolean;
  readonly reduceMotion: boolean;
  readonly colors: ThemeColors;
}): ReactNode {
  const reveal = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(reveal);
    if (reduceMotion) {
      reveal.value = 1;
      return;
    }
    reveal.value = 0.86;
    reveal.value = withDelay(
      index * 45,
      withSpring(1, { damping: 16, stiffness: 230, mass: 0.8 })
    );
  }, [active, index, reduceMotion, reveal, status]);

  const nodeStyle = useAnimatedStyle(() => ({
    opacity: 0.74 + reveal.value * 0.26,
    transform: [{ scale: reveal.value }],
  }));

  const color =
    status === 'accepted'
      ? colors.terminalGreen
      : status === 'rejected'
        ? colors.destructive
        : active
          ? colors.primaryBlue
          : colors.text3;
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: point.x - 17,
          top: point.y - 17,
          width: 34,
          height: 34,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.searchBg,
          borderWidth: 1,
          borderColor: color,
        },
        nodeStyle,
      ]}>
      <SfIcon
        name={
          status === 'accepted'
            ? 'checkmark'
            : status === 'rejected'
              ? 'xmark'
              : 'dot.radiowaves.left.and.right'
        }
        size={14}
        color={color}
      />
    </Animated.View>
  );
}

function centerIcon(phase: PublishAnimationPhase): SFSymbolName {
  switch (phase) {
    case 'provisioning':
      return 'faceid';
    case 'publishing':
      return 'arrow.up.forward.app';
    case 'published':
      return 'checkmark.seal.fill';
    case 'partial':
    case 'error':
      return 'exclamationmark.triangle';
    default:
      return 'lock.shield';
  }
}

type SFSymbolName = Parameters<typeof SfIcon>[0]['name'];

function centerColor(phase: PublishAnimationPhase, colors: ThemeColors): string {
  if (phase === 'published') return colors.terminalGreen;
  if (phase === 'partial' || phase === 'error') return colors.warning;
  return colors.primaryBlue;
}
