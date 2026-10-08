/**
 * Drag-to-reorder mechanics shared by the Page tab's row lists.
 *
 * One controller per contiguous section; every row in the section derives its
 * transform from the same three shared values, so the picked-up row carries
 * the WHOLE row under the finger (not just its grip), neighbours step aside
 * live as the drag crosses their slot, crossings tick, and release settles
 * the row into its destination slot before the reorder commits.
 *
 * Runtime contract: everything the pan worklets call synchronously runs on
 * the UI runtime and must be a worklet (`rubberClamp`, `settleBack`, and
 * `dragDestinationIndex` from pageRowStyles). Dropping a `'worklet'`
 * directive here is the release-build crash "[Worklets] Tried to
 * synchronously call a non-worklet function on the UI thread" — guarded at
 * the artifact level by `__tests__/unit/pageRowStylesWorklet.test.ts`.
 *
 * Commit protocol: `onMove` runs on the JS thread and must end by calling
 * `resetRowDrag` in the same task as the state commit, so the reordered
 * layout and the identity transforms paint on the same frame (row keys
 * include the index, so a committed reorder remounts rows clean).
 */
import { useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { SCALE, SPRING } from '@/feedback/motion';

import { dragDestinationIndex } from './pageRowStyles';

export interface RowDragController {
  /** Section index of the row being carried; -1 when idle. */
  readonly activeIndex: SharedValue<number>;
  /** The carried row's live vertical offset from its own slot. */
  readonly dragY: SharedValue<number>;
  /** Slot the drag currently resolves to; -1 when idle. */
  readonly destination: SharedValue<number>;
}

export function useRowDragController(): RowDragController {
  const activeIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const destination = useSharedValue(-1);
  return useMemo(
    () => ({ activeIndex, dragY, destination }),
    [activeIndex, dragY, destination],
  );
}

/** JS-thread reset — call in the same task as the reorder commit (or a
 * refused move) so the new layout never paints under stale transforms. */
export function resetRowDrag(controller: RowDragController): void {
  controller.activeIndex.value = -1;
  controller.destination.value = -1;
  controller.dragY.value = 0;
}

/** Resist travel past the list's ends instead of stopping dead — the drag
 * keeps answering the finger, just heavier, the way iOS lists overshoot. */
function rubberClamp(value: number, min: number, max: number): number {
  'worklet';
  if (value < min) return min + (value - min) * 0.2;
  if (value > max) return max + (value - max) * 0.2;
  return value;
}

/** Spring the carried row home after a no-move release or a cancelled
 * gesture, and only then drop the carry so the lift settles with it. */
function settleBack(controller: RowDragController): void {
  'worklet';
  controller.destination.value = -1;
  controller.dragY.value = withSpring(0, SPRING.press, () => {
    controller.activeIndex.value = -1;
  });
}

/** Animated wrapper for one reorderable row. `stride` is the row's travel
 * per slot (height + gap) — import it from pageRowStyles, never re-derive. */
export function DraggableRow({
  controller,
  index,
  stride,
  style,
  children,
}: {
  readonly controller: RowDragController;
  readonly index: number;
  readonly stride: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}): ReactNode {
  const shift = useSharedValue(0);
  const lift = useSharedValue(1);

  // Neighbours re-target only when the resolved slot changes, so the step
  // aside is one clean spring instead of one restarted every drag frame.
  useAnimatedReaction(
    () => {
      const active = controller.activeIndex.value;
      if (active === -1 || active === index) return 0;
      const destination = controller.destination.value;
      if (index > active && index <= destination) return -stride;
      if (index < active && index >= destination) return stride;
      return 0;
    },
    (target, previous) => {
      if (target !== previous) shift.value = withSpring(target, SPRING.gentle);
    },
  );

  useAnimatedReaction(
    () => controller.activeIndex.value === index,
    (carried, previous) => {
      if (carried === previous) return;
      lift.value = carried
        ? withSpring(SCALE.rowLift, SPRING.zoom)
        : withSpring(1, SPRING.press);
    },
  );

  const animatedStyle = useAnimatedStyle(() => {
    const carried = controller.activeIndex.value === index;
    return {
      zIndex: carried ? 2 : 0,
      transform: [
        { translateY: carried ? controller.dragY.value : shift.value },
        { scale: lift.value },
      ],
    };
  });

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/** 44pt grip that drives the section's drag. Also exposes the reorder to
 * assistive tech as an adjustable (increment / decrement move one slot). */
export function RowDragHandle({
  controller,
  index,
  itemCount,
  stride,
  height,
  label,
  disabled = false,
  onMove,
}: {
  readonly controller: RowDragController;
  readonly index: number;
  readonly itemCount: number;
  readonly stride: number;
  readonly height: number;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onMove: (destination: number) => void;
}): ReactNode {
  const pan = useMemo(
    () => Gesture.Pan()
      .enabled(!disabled)
      .activateAfterLongPress(120)
      .onStart(() => {
        controller.activeIndex.value = index;
        controller.destination.value = index;
        controller.dragY.value = 0;
        scheduleOnRN(haptic, 'soft');
      })
      .onUpdate((event) => {
        controller.dragY.value = rubberClamp(
          event.translationY,
          -index * stride,
          (itemCount - 1 - index) * stride,
        );
        const destination = dragDestinationIndex(index, event.translationY, itemCount, stride);
        if (destination !== controller.destination.value) {
          controller.destination.value = destination;
          scheduleOnRN(haptic, 'selection');
        }
      })
      .onEnd((event) => {
        const destination = dragDestinationIndex(index, event.translationY, itemCount, stride);
        if (destination !== index) {
          // Land in the destination slot first; the JS commit then repaints
          // the same geometry with identity transforms (see module header).
          controller.dragY.value = withSpring((destination - index) * stride, SPRING.press);
          scheduleOnRN(onMove, destination);
          return;
        }
        settleBack(controller);
      })
      .onFinalize((_event, success) => {
        if (!success) settleBack(controller);
      }),
    [controller, disabled, index, itemCount, onMove, stride],
  );

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityActions={[
          { name: 'decrement', label },
          { name: 'increment', label },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'decrement' && index > 0) onMove(index - 1);
          if (event.nativeEvent.actionName === 'increment' && index < itemCount - 1) onMove(index + 1);
        }}
        style={{
          width: 44,
          height,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
        }}>
        <Svg width={18} height={24} viewBox="0 0 18 24" fill="none">
          {[6, 12, 18].flatMap((cy) => [6, 12].map((cx) => (
            <Circle
              key={`${String(cx)}-${String(cy)}`}
              cx={cx}
              cy={cy}
              r={1.4}
              fill={Colors.text3}
            />
          )))}
        </Svg>
      </View>
    </GestureDetector>
  );
}
