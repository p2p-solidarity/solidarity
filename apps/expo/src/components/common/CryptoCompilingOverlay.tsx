/**
 * CryptoCompilingOverlay — 1:1 port of Swift CryptoCompilingOverlay.
 *
 * Three-phase animation that simulates ZK proof generation:
 *   1. preparing (0–0.8s)  → "Initializing Circuit..." in textPrimary
 *   2. compiling (0.8–3.5s) → "Generating ZK Proof..." in primaryBlue
 *                              + scrolling pseudo-hash list at 20Hz
 *   3. verified  (3.5–5.0s) → "[ VERIFIED ]" badge in terminalGreen,
 *                              spring entrance, glow shadow
 *
 * Auto-dismisses at 5.0s and invokes `onCompletion`.
 *
 * Haptics mirror Swift: rigid impact on mount, soft impacts during
 * compile (≈25% probability per tick), success notification at verify.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

type Phase = 'preparing' | 'compiling' | 'verified';

interface CryptoCompilingOverlayProps {
  readonly visible: boolean;
  readonly onCompletion?: () => void;
}

const HEX = '0123456789abcdef';

function randomHash(): string {
  const len = 24 + Math.floor(Math.random() * 25);
  let out = '0x';
  for (let i = 0; i < len; i += 1) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

const STATUS_TEXT: Readonly<Record<Phase, string>> = {
  preparing: 'Initializing Circuit...',
  compiling: 'Generating ZK Proof...',
  verified: 'Proof Accepted.',
};

const STATUS_COLOR: Readonly<Record<Phase, string>> = {
  preparing: Colors.text1,
  compiling: Colors.primaryBlue,
  verified: Colors.terminalGreen,
};

export function CryptoCompilingOverlay({
  visible,
  onCompletion,
}: CryptoCompilingOverlayProps) {
  const [phase, setPhase] = useState<Phase>('preparing');
  const [hashes, setHashes] = useState<readonly string[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);
  const cursorOpacity = useSharedValue(0);
  const verifiedScale = useSharedValue(0.5);
  const verifiedOpacity = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    setPhase('preparing');
    setHashes([]);
    verifiedScale.value = 0.5;
    verifiedOpacity.value = 0;
    cursorOpacity.value = 0;
    haptic('tap');

    const compileT = setTimeout(() => {
      setPhase('compiling');
      cursorOpacity.value = withRepeat(
        withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    }, 800);

    const verifyT = setTimeout(() => {
      setPhase('verified');
      cursorOpacity.value = 0;
      verifiedScale.value = withSpring(1, { damping: 6, stiffness: 120 });
      verifiedOpacity.value = withTiming(1, { duration: 200 });
      haptic('success');
    }, 3500);

    const closeT = setTimeout(() => {
      onCompletion?.();
    }, 5000);

    return () => {
      clearTimeout(compileT);
      clearTimeout(verifyT);
      clearTimeout(closeT);
    };
  }, [visible, cursorOpacity, verifiedOpacity, verifiedScale, onCompletion]);

  useEffect(() => {
    if (phase !== 'compiling') return;
    const id = setInterval(() => {
      setHashes((prev) => {
        const next = [...prev, randomHash()];
        if (next.length > 40) next.shift();
        return next;
      });
      if (Math.random() < 0.25) haptic('tap');
    }, 50);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'compiling') {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [hashes, phase]);

  const cursorStyle = useAnimatedStyle(() => ({
    opacity: cursorOpacity.value,
  }));
  const verifiedStyle = useAnimatedStyle(() => ({
    opacity: verifiedOpacity.value,
    transform: [{ scale: verifiedScale.value }],
  }));

  if (!visible) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(251,249,242,0.95)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        zIndex: 100,
      }}
    >
      <View style={{ gap: 32, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text
            style={{
              fontFamily: 'Menlo',
              fontSize: 24,
              fontWeight: '700',
              color: STATUS_COLOR[phase],
            }}
          >
            {STATUS_TEXT[phase]}
          </Text>
          {phase !== 'verified' ? (
            <Animated.View
              style={[
                {
                  width: 12,
                  height: 24,
                  backgroundColor: Colors.primaryBlue,
                },
                cursorStyle,
              ]}
            />
          ) : null}
        </View>

        {phase === 'compiling' ? (
          <View
            style={{
              height: 200,
              width: '100%',
              backgroundColor: '#000',
              borderWidth: 1,
              borderColor: Colors.divider,
            }}
          >
            <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16 }}>
              {hashes.map((h, i) => (
                <Text
                  key={`${String(i)}-${h.slice(0, 6)}`}
                  numberOfLines={1}
                  style={{
                    fontFamily: 'Menlo',
                    fontSize: 14,
                    color: Colors.text3,
                  }}
                >
                  {h}
                </Text>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {phase === 'verified' ? (
          <Animated.Text
            style={[
              {
                fontFamily: 'Menlo',
                fontSize: 48,
                fontWeight: '900',
                color: Colors.terminalGreen,
                textShadowColor: 'rgba(76,175,81,0.6)',
                textShadowOffset: { width: 0, height: 0 },
                textShadowRadius: 10,
              },
              verifiedStyle,
            ]}
          >
            [ VERIFIED ]
          </Animated.Text>
        ) : null}
      </View>
    </View>
  );
}
