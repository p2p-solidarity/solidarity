/**
 * TerminalWelcomeStep — 1:1 port of Swift TerminalWelcomeScreen.
 *
 *   "Welcome to\nyour new social\nexperiment"   (32pt monospaced bold)
 *   "It's good to have you here <3\nLet's set
 *    up your profile..."                        (14pt regular textSecondary)
 *   "Begin"                                     (18pt monospaced bold
 *                                                inverted button)
 *
 * Typewriter reveal of the headline; tap anywhere to skip the animation
 * and surface the subtitle + Begin button immediately.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedButton } from '@/components/themed';

const HEADLINE = 'Welcome to\nyour new social\nexperiment';
const SUBTITLE = "It's good to have you here <3\nLet's set up your profile...";
const CHARS_PER_SECOND = 32;

export function TerminalWelcomeStep({ onBegin }: { onBegin?: () => void }) {
  const insets = useSafeAreaInsets();
  const [revealed, setRevealed] = useState('');
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [showBegin, setShowBegin] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let i = 0;
    const intervalMs = 1000 / CHARS_PER_SECOND;
    timerRef.current = setInterval(() => {
      i += 1;
      setRevealed(HEADLINE.slice(0, i));
      if (i >= HEADLINE.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        setShowSubtitle(true);
        setTimeout(() => setShowBegin(true), 500);
      }
    }, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const skip = () => {
    if (showBegin) return;
    if (timerRef.current) clearInterval(timerRef.current);
    setRevealed(HEADLINE);
    setShowSubtitle(true);
    setShowBegin(true);
  };

  return (
    <Pressable
      onPress={skip}
      className="flex-1 bg-pageBg"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32, gap: 16 }}>
        <Text
          className="text-text1 text-[32px] font-bold"
          style={{ fontFamily: 'Menlo' }}
        >
          {revealed}
        </Text>
        {showSubtitle ? (
          <Text className="text-text2 text-[14px]">{SUBTITLE}</Text>
        ) : null}
      </View>

      {showBegin && onBegin ? (
        <View style={{ paddingHorizontal: 32, paddingBottom: 24 }}>
          <ThemedButton
            label="Begin"
            fullWidth
            variant="inverted"
            haptic="warning"
            onPress={onBegin}
          />
        </View>
      ) : null}
    </Pressable>
  );
}
