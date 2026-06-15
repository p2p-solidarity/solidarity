/**
 * Shoutout chart aggregations — TS port of
 * solidarity/Services/Utils/ShoutoutChartService.swift.
 *
 * Swift's ShoutoutChartService is a contact-centric 3D scoring engine
 * (eventScore / typeScore / characterScore) that drives the
 * ShoutoutChart radar surface. The Expo client doesn't have that
 * surface yet, but ShoutoutFiltersSheet does need bucket counts so the
 * filter options can show "Sender X (12)" / "Tuesday (7)" beside each
 * row.
 *
 * The functions here are pure: take an array of shoutouts, return
 * `{label, count}[]`. Bucketing matches the Swift surface verbatim:
 *
 *   - `bucketByTag`         : groups by `subject`. Swift uses
 *                             `contact.tags`; in the TS shape the
 *                             closest equivalent is the shoutout
 *                             subject (one-token tag-style label).
 *   - `bucketByDayOfWeek`   : `Sun..Sat`, matching Calendar.weekday.
 *   - `bucketBySender`      : `counterpartName` distribution.
 *
 * The `useShoutoutChart` selector wires these into the zustand store
 * so any consumer (ShoutoutFiltersSheet today, future radar view) can
 * subscribe once and re-render on change.
 */
import { useMemo } from 'react';

import { useShoutoutStore, type Shoutout } from './store';

export interface ShoutoutChartBucket {
  readonly label: string;
  readonly count: number;
}

const DAY_LABELS: readonly string[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];

function bucketize(
  shoutouts: readonly Shoutout[],
  pickLabel: (s: Shoutout) => string | undefined
): readonly ShoutoutChartBucket[] {
  const counts = new Map<string, number>();
  for (const s of shoutouts) {
    const label = pickLabel(s);
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export function bucketByTag(
  shoutouts: readonly Shoutout[]
): readonly ShoutoutChartBucket[] {
  return bucketize(shoutouts, (s) => (s.subject ? s.subject.trim() : undefined));
}

export function bucketByDayOfWeek(
  shoutouts: readonly Shoutout[]
): readonly ShoutoutChartBucket[] {
  const counts = new Map<number, number>();
  for (const s of shoutouts) {
    const day = s.createdAt.getDay();
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  // Stable Sun..Sat order so the consumer can render a fixed-width row.
  return DAY_LABELS.map((label, idx) => ({
    label,
    count: counts.get(idx) ?? 0,
  }));
}

export function bucketBySender(
  shoutouts: readonly Shoutout[]
): readonly ShoutoutChartBucket[] {
  return bucketize(shoutouts, (s) =>
    s.counterpartName ? s.counterpartName.trim() : undefined
  );
}

export interface ShoutoutChartSnapshot {
  readonly byTag: readonly ShoutoutChartBucket[];
  readonly byDayOfWeek: readonly ShoutoutChartBucket[];
  readonly bySender: readonly ShoutoutChartBucket[];
}

/**
 * React hook returning the three bucket arrays for the current store
 * contents. Memoised on the array reference (zustand returns a stable
 * `items` until something changes) so child renders don't recompute.
 */
export function useShoutoutChart(): ShoutoutChartSnapshot {
  const items = useShoutoutStore((s) => s.items);
  return useMemo(
    () => ({
      byTag: bucketByTag(items),
      byDayOfWeek: bucketByDayOfWeek(items),
      bySender: bucketBySender(items),
    }),
    [items]
  );
}
