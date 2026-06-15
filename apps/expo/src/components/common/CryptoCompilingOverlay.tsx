/**
 * CryptoCompilingOverlay — terminal-style proof progress overlay.
 *
 * Driven by REAL pipeline milestones (CLAUDE.md rule 8 — no fake states):
 * the parent maps proof events to `stage`:
 *   'init'    → "Initializing…" while the prover/witness is being prepared
 *   'proving' → real status text per circuit + decorative hash scroll
 *   'done'    → "[ VERIFIED ]" badge — rendered ONLY after the proof
 *               bundle actually completed; auto-hands control back via
 *               `onDone` after a short celebration delay.
 *
 * The visual language (Menlo, hash terminal, spring badge, haptics) is the
 * 1:1 Swift port; only the fake 0.8s/3.5s/5s timeline was removed.
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

type Stage = 'init' | 'proving' | 'done';

interface CryptoCompilingOverlayProps {
  readonly visible: boolean;
  /** Real pipeline stage — drives phases 1:1; no internal timeline. */
  readonly stage: Stage;
  /** Real progress text from the proof runner (e.g. "Generating dsc_chain proof…"). */
  readonly statusText: string;
  /** Fired ~1.2s after `stage` becomes 'done' (celebration delay AFTER real completion). */
  readonly onDone?: () => void;
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

const STATUS_COLOR: Readonly<Record<Stage, string>> = {
  init: Colors.text1,
  proving: Colors.primaryBlue,
  done: Colors.terminalGreen,
};

export function CryptoCompilingOverlay({
  visible,
  stage,
  statusText,
  onDone,
}: CryptoCompilingOverlayProps) {
  const [hashes, setHashes] = useState<readonly string[]>([]);
  const scrollRef = useRef<ScrollView | null>(null);
  const cursorOpacity = useSharedValue(0);
  const verifiedScale = useSharedValue(0.5);
  const verifiedOpacity = useSharedValue(0);

  // Mount: haptic + cursor blink while work is actually running.
  useEffect(() => {
    if (!visible) return;
    setHashes([]);
    verifiedScale.value = 0.5;
    verifiedOpacity.value = 0;
    haptic('tap');
    cursorOpacity.value = withRepeat(
      withTiming(1, { duration: 300, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [visible, cursorOpacity, verifiedOpacity, verifiedScale]);

  // 'done' = REAL completion: spring the badge, success haptic, then hand
  // control back to the parent. This is the only timer left and it runs
  // strictly AFTER the work finished.
  useEffect(() => {
    if (!visible || stage !== 'done') return;
    cursorOpacity.value = 0;
    verifiedScale.value = withSpring(1, { damping: 6, stiffness: 120 });
    verifiedOpacity.value = withTiming(1, { duration: 200 });
    haptic('success');
    const doneT = setTimeout(() => {
      onDone?.();
    }, 1200);
    return () => clearTimeout(doneT);
  }, [visible, stage, cursorOpacity, verifiedOpacity, verifiedScale, onDone]);

  // Decorative hash scroll ONLY while a circuit is actually proving.
  useEffect(() => {
    if (!visible || stage !== 'proving') return;
    const id = setInterval(() => {
      setHashes((prev) => {
        const next = [...prev, randomHash()];
        if (next.length > 40) next.shift();
        return next;
      });
      if (Math.random() < 0.25) haptic('tap');
    }, 50);
    return () => clearInterval(id);
  }, [visible, stage]);

  useEffect(() => {
    if (stage === 'proving') {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [hashes, stage]);

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
              color: STATUS_COLOR[stage],
            }}
          >
            {stage === 'done' ? 'Proof Accepted.' : statusText}
          </Text>
          {stage !== 'done' ? (
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

        {stage === 'proving' ? (
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

        {stage === 'done' ? (
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
