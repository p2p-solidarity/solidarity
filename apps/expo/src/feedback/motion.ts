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
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

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
  /** Icon-only button touch-down — small target reads better with more travel. */
  icon: 0.9,
  /** Long-press "zoom / lift" target (scales up, not down). */
  longPress: 1.05,
} as const;

export const TIMING: Readonly<Record<'fast' | 'base', WithTimingConfig>> = {
  fast: { duration: 140 },
  base: { duration: 240 },
};

/** Per-item stagger step (ms) for list / section entrance animations. */
export const STAGGER_MS = 40;
