/**
 * motion — shared Reanimated spring / scale / timing presets so the app's
 * interaction "feel" is tuned in one place. The motion sibling of
 * `feedback/haptics.ts`.
 *
 * The press spring is intentionally over-damped (damping ≫ critical) so a
 * control shrinks on touch-down and settles straight back with weight and
 * **no wobble** — the app's "damped & crisp" interaction language. It
 * mirrors the spring already baked into ThemedButton so every tappable
 * surface presses the same way. Reach for `SPRING.gentle` on entrances /
 * larger travel and `SPRING.zoom` for the long-press lift.
 */
import { Easing, withDelay, withTiming } from 'react-native-reanimated';
import type {
  EntryExitAnimationFunction,
  WithSpringConfig,
  WithTimingConfig,
} from 'react-native-reanimated';

/** Spring presets. `press` is over-damped → crisp, zero overshoot. */
export const SPRING: Readonly<Record<'press' | 'gentle' | 'zoom', WithSpringConfig>> = {
  /** Touch-down / release on rows, tiles, icon buttons. Mirrors ThemedButton. */
  press: { damping: 100, stiffness: 600, mass: 1 },
  /** Softer settle for entrances and larger movements. */
  gentle: { damping: 22, stiffness: 220, mass: 1 },
  /** Long-press "pick up" lift — a hair springier so the zoom reads as alive. */
  zoom: { damping: 18, stiffness: 240, mass: 1 },
};

/** Scale targets for press feedback. `1` = rest. */
export const SCALE = {
  /** Row / list-item touch-down. */
  press: 0.97,
  /** Tile / card touch-down — a touch more travel than a row. */
  tile: 0.96,
  /** Icon-only button touch-down. Kept inside the 0.95–0.98 press band: a
   * deeper dip on a small target reads as a flinch, not a press. */
  icon: 0.95,
  /** Long-press "zoom / lift" target (scales up, not down). */
  longPress: 1.05,
  /** Whole-row drag "carry" — subtler than `longPress` so a full-width row
   * lifts without spilling past the list gutters. */
  rowLift: 1.02,
} as const;

/**
 * The app's one ease-out curve (Emil Kowalski's strong ease-out): movement
 * starts at full speed so the UI answers the finger at once, then settles.
 * Never use ease-in on UI — it delays the exact frame the user is watching.
 */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Durations (ms). UI motion stays under 300 ms, and a surface leaves faster
 * than it arrives: the user is deciding on the way in, the system is
 * responding on the way out.
 */
export const DURATION = {
  /** Press / state feedback. */
  press: 140,
  /** Sheets, rows and sections arriving. */
  enter: 240,
  /** The same surfaces leaving. */
  exit: 160,
} as const;

export const TIMING: Readonly<Record<'fast' | 'base' | 'enter' | 'exit', WithTimingConfig>> = {
  fast: { duration: DURATION.press, easing: EASE_OUT },
  base: { duration: DURATION.enter, easing: EASE_OUT },
  enter: { duration: DURATION.enter, easing: EASE_OUT },
  exit: { duration: DURATION.exit, easing: EASE_OUT },
};

/** Per-item stagger step (ms) for list / section entrance animations. */
export const STAGGER_MS = 40;

/** How far a row / section rises on its way in. Small on purpose: the eye
 * reads the fade; the travel only says "this just arrived". */
const ENTER_RISE_PX = 8;

/**
 * List / section entrance: fade in while rising a few points, on `EASE_OUT`,
 * delayed `index × STAGGER_MS` so a stack cascades instead of popping in as a
 * block. With `reduceMotion` the rise is dropped and only the fade remains —
 * reduced motion means gentler, not none. Pass `useReducedMotion()` from the
 * caller. Worklet: it only touches the captured timing config.
 */
export function fadeUpIn(index: number, reduceMotion = false): EntryExitAnimationFunction {
  const config: WithTimingConfig = { duration: DURATION.enter, easing: EASE_OUT };
  const delay = Math.max(0, index) * STAGGER_MS;
  const rise = reduceMotion ? 0 : ENTER_RISE_PX;
  return function fadeUpInEntering() {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: rise }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, config)),
        transform: [{ translateY: withDelay(delay, withTiming(0, config)) }],
      },
    };
  };
}

/**
 * Sheet entrance: fade in while settling from a slight zoom, both on one
 * ease-out curve. Reanimated's `ZoomIn` only animates `transform`, so a fade
 * has to be a custom entering animation — passing `opacity: 0` through
 * `ZoomIn.withInitialValues` never animated it, and Reanimated 4.5 rejects the
 * key at the type level. The returned function is a worklet (it runs on the UI
 * runtime), so it only touches the captured timing config — keep it that way.
 */
export function zoomFadeIn(durationMs: number): EntryExitAnimationFunction {
  const config: WithTimingConfig = { duration: durationMs, easing: Easing.out(Easing.cubic) };
  return function zoomFadeInEntering() {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.97 }] },
      animations: {
        opacity: withTiming(1, config),
        transform: [{ scale: withTiming(1, config) }],
      },
    };
  };
}
