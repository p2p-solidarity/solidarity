/**
 * Toast manager — mirrors Swift ToastManager + ToastView.
 *
 * Zustand-backed queue; one toast visible at a time. Each toast auto-
 * dismisses after `ms` (default 3000). Slide + fade transitions are
 * Reanimated 4 worklets to keep animation off the JS thread when many
 * toasts fire in quick succession (proximity exchange flow).
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { create } from 'zustand';

import { ThemedText } from '@/components/themed';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
  readonly ms: number;
}

interface ToastStore {
  readonly toasts: readonly Toast[];
  readonly push: (message: string, tone?: ToastTone, ms?: number) => void;
  readonly pop: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, tone = 'info', ms = 3000) =>
    { set((s) => ({ toasts: [...s.toasts, { id: nextId++, message, tone, ms }] })); },
  pop: (id) => { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
}));

export function pushToast(
  message: string,
  tone: ToastTone = 'info',
  ms = 3000
): void {
  useToastStore.getState().push(message, tone, ms);
}

const TONE_CLASS: Readonly<Record<ToastTone, string>> = {
  info: 'bg-cardBg border-divider',
  success: 'bg-cardBg border-accentRose',
  warning: 'bg-cardBg border-destructive',
  error: 'bg-destructive',
};

function ToastItem({ toast }: { readonly toast: Toast }): ReactNode {
  const pop = useToastStore((s) => s.pop);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    translateY.value = withTiming(0, { duration: 250 });
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(20, { duration: 250 });
      setTimeout(() => { pop(toast.id); }, 250);
    }, toast.ms);
    return () => { clearTimeout(timer); };
  }, [opacity, pop, toast.id, toast.ms, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={animStyle}
      className={`mx-4 mb-2 rounded-2xl border px-4 py-3 ${TONE_CLASS[toast.tone]}`}
    >
      <ThemedText variant="bodyMedium" tone={toast.tone === 'error' ? 'primary' : 'primary'}>
        {toast.message}
      </ThemedText>
    </Animated.View>
  );
}

/** Mount once near the top of your layout (`_layout.tsx`). */
export function ToastOverlay(): ReactNode {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
  },
});
