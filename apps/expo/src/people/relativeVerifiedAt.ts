/**
 * Pure relative-time bucketing for a Verified Page snapshot's `verifiedAt`
 * ISO timestamp (People tab "Verified Pages" section, Task A2.3b — the
 * fast-follow that surfaces `src/people/profileSnapshots.ts` snapshots in
 * `app/(tabs)/people/index.tsx`).
 *
 * Deliberately split from i18n: this module only does the millisecond math
 * and returns a `{unit, count}` bucket, so it's unit-testable without
 * bootstrapping i18next. The caller (`VerifiedPagesSection`) maps the
 * bucket to a localized string via `t()`.
 */
export type VerifiedAtRelativeUnit = 'justNow' | 'minutes' | 'hours' | 'days';

export interface VerifiedAtRelative {
  readonly unit: VerifiedAtRelativeUnit;
  readonly count: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * `now` is injectable for deterministic tests; defaults to `Date.now()`.
 * An invalid/future timestamp clamps to `justNow` rather than going
 * negative — a snapshot can never be verified "in the future" from the
 * viewer's clock, and an unparseable ISO string is closer to "just
 * happened" than to any specific bucket.
 */
export function verifiedAtRelative(iso: string, now: number = Date.now()): VerifiedAtRelative {
  const then = Date.parse(iso);
  const deltaMs = Number.isNaN(then) ? 0 : Math.max(0, now - then);
  if (deltaMs < MINUTE_MS) return { unit: 'justNow', count: 0 };
  if (deltaMs < HOUR_MS) return { unit: 'minutes', count: Math.floor(deltaMs / MINUTE_MS) };
  if (deltaMs < DAY_MS) return { unit: 'hours', count: Math.floor(deltaMs / HOUR_MS) };
  return { unit: 'days', count: Math.floor(deltaMs / DAY_MS) };
}
