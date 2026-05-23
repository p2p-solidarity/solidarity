/**
 * Terminal welcome — typewriter intro + Solidarity wordmark. Mirrors
 * Swift TerminalWelcomeScreen.
 *
 * Animations:
 *   - Char reveal: pure JS setInterval (low frequency, no need for worklet)
 *   - Cursor blink: Reanimated 4 SharedValue + repeating withTiming on the
 *     opacity. Worklet runs off the JS thread so the cursor stays smooth
 *     even while the typewriter setInterval fires.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Wordmark } from '@/components/brand/Wordmark';
import { Colors } from '@/constants/Colors';
import { ThemedText } from '@/components/themed';

const LINES = [
  '> Solidarity 1.3.1',
  '> initialising secure enclave…',
  '> ready.',
] as const;

const CHARS_PER_SECOND = 32;

export function TerminalWelcomeStep() {
  const fullText = LINES.join('\n');
  const [revealed, setRevealed] = useState('');
  const cursorOpacity = useSharedValue(1);

  useEffect(() => {
    cursorOpacity.value = withRepeat(withTiming(0, { duration: 500 }), -1, true);
  }, [cursorOpacity]);

  useEffect(() => {
    let i = 0;
    const intervalMs = 1000 / CHARS_PER_SECOND;
    const timer = setInterval(() => {
      i++;
      setRevealed(fullText.slice(0, i));
      if (i >= fullText.length) clearInterval(timer);
    }, intervalMs);
    return () => { clearInterval(timer); };
  }, [fullText]);

  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));

  return (
    <View>
      <View className="mb-6">
        <Wordmark />
      </View>
      <View style={styles.wrap}>
        <ThemedText variant="bodyMedium" tone="accent" style={styles.mono}>
          {revealed}
        </ThemedText>
        <Animated.View style={[styles.cursor, cursorStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end' },
  mono: { fontFamily: 'Menlo', fontSize: 14, lineHeight: 22 },
  cursor: {
    width: 8,
    height: 18,
    backgroundColor: Colors.accentRose,
    marginLeft: 2,
    marginBottom: 2,
  },
});
