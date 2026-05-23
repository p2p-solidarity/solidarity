/**
 * RippleButton — 1:1 port of Swift RippleButton.
 *
 * Identity dashboard hero CTA. Concentric outer rings + gradient centre.
 * States:
 *   - idle:       gray (no commitment) or accentRose (active)
 *   - processing: dual rotating arcs (blue + purple) + ProgressView
 *   - success:    accentRose with checkmark
 *   - syncNeeded: orange→red gradient + orange rings + "Sync Needed" pill
 *
 * Long-press 1.5s triggers `onLongPress` after progressively activating
 * the three rings (every 0.5s). Light tap dispatches `onTap`.
 *
 * Centre button shows "ID" + commitment hash (truncated 6…6) or
 * "Tap to create" when no commitment exists.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgLg, Stop } from 'react-native-svg';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

export type RippleButtonState = 'idle' | 'processing' | 'success' | 'syncNeeded';

interface RippleButtonProps {
  readonly state: RippleButtonState;
  readonly commitment?: string;
  readonly size?: number;
  readonly onTap: () => void;
  readonly onLongPress: () => void;
}

const LONG_PRESS_MS = 1500;
const RING_STAGE_MS = 500;

function shortenCommitment(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

export function RippleButton({
  state,
  commitment,
  size = 280,
  onTap,
  onLongPress,
}: RippleButtonProps) {
  const [isPressing, setPressing] = useState(false);
  const [ringActive, setRingActive] = useState(0);
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotation = useSharedValue(0);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    if (state === 'processing') {
      rotation.value = withRepeat(
        withTiming(360, { duration: 2000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      rotation.value = 0;
    }
  }, [state, rotation]);

  useEffect(() => {
    pressScale.value = withSpring(isPressing ? 0.95 : 1, { damping: 6, stiffness: 240 });
  }, [isPressing, pressScale]);

  const startPress = () => {
    if (state === 'processing') return;
    setPressing(true);
    setRingActive(1);
    haptic('tap');
    ringTimerRef.current = setInterval(() => {
      setRingActive((c) => {
        const next = Math.min(3, c + 1);
        if (next >= 3 && ringTimerRef.current) clearInterval(ringTimerRef.current);
        return next;
      });
    }, RING_STAGE_MS);
    longPressTimerRef.current = setTimeout(() => {
      haptic('success');
      onLongPress();
      cleanup(false);
    }, LONG_PRESS_MS);
  };

  const cleanup = (reset: boolean) => {
    setPressing(false);
    if (ringTimerRef.current) clearInterval(ringTimerRef.current);
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    ringTimerRef.current = null;
    longPressTimerRef.current = null;
    if (reset) setRingActive(0);
  };

  const endPress = () => {
    cleanup(false);
  };

  useEffect(() => () => cleanup(false), []);

  const centerSize = size * 0.36;
  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(rotation.value)}deg` }],
  }));
  const counterRotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(-rotation.value * 1.5)}deg` }],
  }));
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {state === 'processing' ? (
        <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={[{ position: 'absolute' }, rotationStyle]}>
            <ArcRing size={size * 0.85} color={Colors.accentRose} />
          </Animated.View>
          <Animated.View style={[{ position: 'absolute' }, counterRotationStyle]}>
            <ArcRing size={size * 0.85 * 0.7} color={Colors.featureAccent} />
          </Animated.View>
        </View>
      ) : (
        renderStaticRings(size, ringActive, state === 'syncNeeded')
      )}

      <Animated.View style={[{ position: 'absolute' }, pressStyle]}>
        <Pressable
          onPress={() => {
            if (state === 'processing') return;
            onTap();
          }}
          onPressIn={startPress}
          onPressOut={endPress}
          accessibilityRole="button"
        >
          {renderCenterButton({ size: centerSize, state, commitment })}
        </Pressable>
      </Animated.View>

      <View style={{ position: 'absolute', bottom: 0, alignItems: 'center' }}>
        {renderStatusLabel(state, commitment)}
      </View>
    </View>
  );
}

function renderStaticRings(base: number, active: number, syncNeeded: boolean) {
  return (
    <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
      <Ring size={base * 0.8} index={3} active={active} syncNeeded={syncNeeded} />
      <Ring size={base * 0.62} index={2} active={active} syncNeeded={syncNeeded} />
      <Ring size={base * 0.46} index={1} active={active} syncNeeded={syncNeeded} />
    </View>
  );
}

function Ring({
  size,
  index,
  active,
  syncNeeded,
}: {
  readonly size: number;
  readonly index: number;
  readonly active: number;
  readonly syncNeeded: boolean;
}) {
  const baseColor = syncNeeded ? Colors.destructive : Colors.text3;
  const litColor = syncNeeded ? Colors.destructive : Colors.accentRose;
  const color =
    index === 1
      ? `${baseColor}33`
      : index <= active
        ? litColor
        : `${baseColor}1A`;
  return (
    <View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 8,
        borderColor: color,
      }}
    />
  );
}

function ArcRing({ size, color }: { readonly size: number; readonly color: string }) {
  const r = size / 2 - 4;
  const circumference = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <SvgLg id={`arc-${color}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </SvgLg>
      </Defs>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={`url(#arc-${color})`}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${String(circumference * 0.7)} ${String(circumference)}`}
      />
    </Svg>
  );
}

function renderCenterButton({
  size,
  state,
  commitment,
}: {
  readonly size: number;
  readonly state: RippleButtonState;
  readonly commitment?: string;
}) {
  const gradient = pickGradient(state, commitment);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        shadowColor: pickShadow(state),
        shadowOpacity: 0.3,
        shadowRadius: 10,
      }}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 }}
      >
        {renderCenterContent({ size, state, commitment })}
      </LinearGradient>
    </View>
  );
}

function renderCenterContent({
  size,
  state,
  commitment,
}: {
  readonly size: number;
  readonly state: RippleButtonState;
  readonly commitment?: string;
}) {
  if (state === 'success') {
    return <SfIcon name="checkmark" size={size * 0.4} color="#FFF" />;
  }
  if (state === 'processing') {
    return <SfIcon name="hourglass" size={size * 0.4} color="#FFF" />;
  }
  const trimmed = commitment?.trim();
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 22 }}>ID</Text>
      {trimmed && trimmed.length > 0 ? (
        <>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>Commitment</Text>
          <Text
            style={{
              color: '#FFF',
              fontFamily: 'Menlo',
              fontSize: 12,
              paddingHorizontal: 8,
              paddingVertical: 4,
              backgroundColor: 'rgba(0,0,0,0.2)',
              borderRadius: 6,
            }}
          >
            {shortenCommitment(trimmed)}
          </Text>
        </>
      ) : (
        <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>Tap to create</Text>
      )}
    </View>
  );
}

function pickGradient(state: RippleButtonState, commitment?: string): readonly [string, string] {
  if (state === 'processing') return ['#007AFF', '#5856D6'] as const;
  if (state === 'success') return [Colors.accentRose, '#D4BDE7'] as const;
  if (state === 'syncNeeded') return ['#FFA500', Colors.destructive] as const;
  if (!commitment || commitment.trim().length === 0)
    return [Colors.text3, `${Colors.text3}CC`] as const;
  return [Colors.accentRose, '#A6678D'] as const;
}

function pickShadow(state: RippleButtonState): string {
  if (state === 'syncNeeded') return '#FFA500';
  return Colors.accentRose;
}

function renderStatusLabel(state: RippleButtonState, commitment?: string) {
  const text = labelFor(state, commitment);
  const color = labelColor(state, commitment);
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: Colors.pillSurface,
      }}
    >
      <Text style={{ color, fontSize: 12, fontWeight: '500' }}>{text}</Text>
    </View>
  );
}

function labelFor(state: RippleButtonState, commitment?: string): string {
  switch (state) {
    case 'processing':
      return 'Processing...';
    case 'success':
      return 'Success!';
    case 'syncNeeded':
      return 'Sync Needed';
    case 'idle':
      return commitment ? 'Identity Active' : 'Identity Not Created';
  }
}

function labelColor(state: RippleButtonState, commitment?: string): string {
  switch (state) {
    case 'syncNeeded':
      return '#FFA500';
    case 'success':
    case 'idle':
      return commitment ? Colors.accentRose : Colors.text2;
    case 'processing':
      return Colors.text1;
  }
}
