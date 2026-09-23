/**
 * SlideUpSheet — the Me tab's transparent bottom sheet frame (share sheet,
 * publish preview). The sheet rises from 100% of its own height over a fading
 * backdrop on `TIMING.enter`, and it has a real closing state: it slides back
 * down on the faster `TIMING.exit` and only THEN unmounts the `Modal` and
 * reports `onClose`. A bare `Modal` with `animationType="none"` hard-cuts on
 * the way out, which reads as a glitch next to an animated entrance.
 *
 * Reduced motion keeps the fades and drops the travel: the sheet fades in
 * place instead of sliding.
 *
 * Every dismissal inside the sheet goes through the `close` it hands its
 * children (`close(after?)`): animate out → unmount → `onClose()` → `after()`.
 * A parent that flips `visible` to false itself gets the same exit animation.
 * The content keeps its props through the exit, so nothing inside it resets
 * (selection, QR state) while it is still on screen.
 *
 * No drag-to-dismiss: neither sheet ever had a drag gesture, and the publish
 * preview is deliberately not dismissible by accident.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors } from '@/constants/Colors';
import { TIMING } from '@/feedback/motion';

/** Animate the sheet out, then unmount it, call `onClose`, then `after`. */
export type SheetClose = (after?: () => void) => void;

type SheetPhase = 'closed' | 'open' | 'closing';

export interface SlideUpSheetProps {
  readonly visible: boolean;
  /** Called once the exit animation has finished and the sheet is gone. */
  readonly onClose: () => void;
  readonly children: (close: SheetClose) => ReactNode;
}

export function SlideUpSheet({ visible, onClose, children }: SlideUpSheetProps): ReactNode {
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(false);
  // 0 = off screen, 1 = resting. Drives both the backdrop and the sheet.
  const progress = useSharedValue(0);
  // Seeded with the window height so the first frame, before the sheet is
  // measured, is guaranteed to sit off screen.
  const sheetHeight = useSharedValue(windowHeight);
  const phase = useRef<SheetPhase>('closed');
  const enterPending = useRef(false);
  const afterExit = useRef<(() => void) | null>(null);

  const finishExit = useCallback((): void => {
    phase.current = 'closed';
    setMounted(false);
    const after = afterExit.current;
    afterExit.current = null;
    after?.();
  }, []);

  const runExit = useCallback((after: (() => void) | null): void => {
    phase.current = 'closing';
    enterPending.current = false;
    afterExit.current = after;
    progress.value = withTiming(0, TIMING.exit, (finished) => {
      'worklet';
      if (finished) scheduleOnRN(finishExit);
    });
  }, [finishExit, progress]);

  useEffect(() => {
    if (visible) {
      if (phase.current === 'closing') {
        // Reopened mid-exit: turn around from wherever the sheet is now.
        phase.current = 'open';
        afterExit.current = null;
        progress.value = withTiming(1, TIMING.enter);
      } else if (phase.current === 'closed') {
        phase.current = 'open';
        enterPending.current = true;
        progress.value = 0;
        setMounted(true);
      }
      return;
    }
    // The parent closed the sheet itself: same exit, nothing to report back.
    if (phase.current === 'open') runExit(null);
  }, [progress, runExit, visible]);

  const close: SheetClose = (after) => {
    if (phase.current !== 'open') return;
    runExit(() => {
      onClose();
      after?.();
    });
  };

  const onSheetLayout = (event: LayoutChangeEvent): void => {
    sheetHeight.value = event.nativeEvent.layout.height;
    // Start the rise only once the real height is known, so the travel is
    // exactly one sheet height and never jumps mid-flight.
    if (enterPending.current) {
      enterPending.current = false;
      progress.value = withTiming(1, TIMING.enter);
    }
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const sheetStyle = useAnimatedStyle(() => (
    reduceMotion
      ? { opacity: progress.value, transform: [{ translateY: 0 }] }
      : { opacity: 1, transform: [{ translateY: (1 - progress.value) * sheetHeight.value }] }
  ));

  return (
    <Modal
      visible={mounted}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => {
        close();
      }}>
      <View style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: Colors.overlayBg }, backdropStyle]}
        />
        <Animated.View onLayout={onSheetLayout} style={sheetStyle}>
          {children(close)}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
});
