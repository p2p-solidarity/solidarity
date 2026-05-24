import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';

const HEADLINE = 'Welcome to\nyour new social\nexperiment';
const SUBTITLE = "It's good to have you here <3\nLet's set up your profile...";
const CHARS_PER_SECOND = 32;
const CURSOR_BLINK_MS = 500;

export interface TerminalWelcomeScreenProps {
  readonly onBegin?: () => void;
}

export function TerminalWelcomeScreen({ onBegin }: TerminalWelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const [revealed, setRevealed] = useState('');
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [showBegin, setShowBegin] = useState(false);
  const [cursorOn, setCursorOn] = useState(true);
  const typingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cursorRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let i = 0;
    const intervalMs = 1000 / CHARS_PER_SECOND;
    typingRef.current = setInterval(() => {
      i += 1;
      setRevealed(HEADLINE.slice(0, i));
      if (i >= HEADLINE.length) {
        if (typingRef.current) clearInterval(typingRef.current);
        setShowSubtitle(true);
        setTimeout(() => { setShowBegin(true); }, 500);
      }
    }, intervalMs);
    cursorRef.current = setInterval(() => {
      setCursorOn((c) => !c);
    }, CURSOR_BLINK_MS);
    return () => {
      if (typingRef.current) clearInterval(typingRef.current);
      if (cursorRef.current) clearInterval(cursorRef.current);
    };
  }, []);

  const skip = () => {
    if (showBegin) return;
    if (typingRef.current) clearInterval(typingRef.current);
    setRevealed(HEADLINE);
    setShowSubtitle(true);
    setShowBegin(true);
  };

  const handleBegin = () => {
    haptic('success');
    onBegin?.();
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
          <Text style={{ color: cursorOn ? Colors.text1 : 'transparent' }}>_</Text>
        </Text>
        {showSubtitle ? (
          <Text
            className="text-text2 text-[14px]"
            style={{ fontFamily: 'Menlo' }}
          >
            {SUBTITLE}
          </Text>
        ) : null}
      </View>

      {showBegin && onBegin ? (
        <View style={{ paddingHorizontal: 32, paddingBottom: 24 }}>
          <ThemedButton
            label="Begin"
            fullWidth
            variant="inverted"
            haptic={false}
            onPress={handleBegin}
          />
        </View>
      ) : null}
    </Pressable>
  );
}
