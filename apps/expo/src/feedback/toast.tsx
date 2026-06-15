/**
 * Toast manager — mirrors Swift ToastManager + ToastView.
 *
 * Zustand-backed queue; toasts stack at the top of the screen and slide
 * down on enter / up on exit. Each toast auto-dismisses after `ms`
 * (default 3000). Slide + fade transitions are Reanimated 4 worklets to
 * keep animation off the JS thread when many toasts fire in quick
 * succession (proximity exchange flow).
 *
 * Identical consecutive messages are deduped: re-pushing the same
 * (message, tone) within the live window resets its timer instead of
 * stacking a second copy. Prevents the "press a stub button twice and
 * suddenly two toasts look like text inputs" UX bug.
 *
 * Visual parity with Swift v1.3.1 ToastView:
 *   • cardBg surface, 16-pt corner radius, soft elevation shadow
 *   • leading tone-coloured circle icon (success: terminalGreen ✓,
 *     error: destructive ✕, warning: warning ⚠, info: text2 i)
 *   • first line bold (title), remaining lines tone="secondary" (body)
 *   • trailing close button (xmark) — taps pop the toast early
 */
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

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
  push: (message, tone = 'info', ms = 3000) => {
    set((s) => {
      const last = s.toasts[s.toasts.length - 1];
      if (last && last.message === message && last.tone === tone) {
        const refreshed: Toast = { id: nextId++, message, tone, ms };
        return { toasts: [...s.toasts.slice(0, -1), refreshed] };
      }
      return { toasts: [...s.toasts, { id: nextId++, message, tone, ms }] };
    });
  },
  pop: (id) => { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
}));

export function pushToast(
  message: string,
  tone: ToastTone = 'info',
  ms = 3000
): void {
  useToastStore.getState().push(message, tone, ms);
}

interface ToneStyle {
  readonly iconName: 'checkmark.circle.fill' | 'xmark.circle.fill' | 'exclamationmark.triangle.fill' | 'info.circle';
  readonly iconColor: string;
}

function toneStyle(tone: ToastTone): ToneStyle {
  switch (tone) {
    case 'success':
      return { iconName: 'checkmark.circle.fill', iconColor: Colors.terminalGreen };
    case 'error':
      return { iconName: 'xmark.circle.fill', iconColor: Colors.destructive };
    case 'warning':
      return { iconName: 'exclamationmark.triangle.fill', iconColor: Colors.warning };
    default:
      return { iconName: 'info.circle', iconColor: Colors.text2 };
  }
}

function splitTitleBody(message: string): { title: string; body: string | null } {
  const newlineIndex = message.indexOf('\n');
  if (newlineIndex === -1) return { title: message, body: null };
  return {
    title: message.slice(0, newlineIndex).trim(),
    body: message.slice(newlineIndex + 1).trim(),
  };
}

function ToastItem({ toast }: { readonly toast: Toast }): ReactNode {
  const pop = useToastStore((s) => s.pop);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-20);
  const style = toneStyle(toast.tone);
  const { title, body } = splitTitleBody(toast.message);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    translateY.value = withTiming(0, { duration: 250 });
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 200 });
      translateY.value = withTiming(-20, { duration: 250 });
      setTimeout(() => { pop(toast.id); }, 250);
    }, toast.ms);
    return () => { clearTimeout(timer); };
  }, [opacity, pop, toast.id, toast.ms, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const handleClose = () => {
    opacity.value = withTiming(0, { duration: 150 });
    translateY.value = withTiming(-20, { duration: 200 });
    setTimeout(() => { pop(toast.id); }, 200);
  };

  return (
    <Animated.View
      style={[animStyle, styles.card]}
      className="bg-cardBg mx-4 mt-2 rounded-2xl"
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <SfIcon name={style.iconName} size={22} color={style.iconColor} />
        </View>
        <View style={styles.content}>
          <ThemedText variant="bodyMedium" style={styles.title}>
            {title}
          </ThemedText>
          {body ? (
            <ThemedText variant="caption" tone="secondary" style={styles.body}>
              {body}
            </ThemedText>
          ) : null}
        </View>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
          style={styles.close}
        >
          <SfIcon name="xmark" size={14} color={Colors.text3} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

/** Mount once near the top of your layout (`_layout.tsx`). */
export function ToastOverlay(): ReactNode {
  const toasts = useToastStore((s) => s.toasts);
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { top: insets.top + 4 }]}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  card: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '600',
  },
  body: {
    lineHeight: 18,
  },
  close: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
