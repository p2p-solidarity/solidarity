/**
 * Shoutout chart aggregations — top-N + "other" buckets + 30-day series.
 *
 * Sibling of `chartService.ts` (raw bucket counts). Mirrors the
 * "count by topic / count by author / time series" surface described
 * in the Swift ShoutoutChartService discovery roadmap (the contact
 * radar 3D scoring is intentionally not ported — see chartService.ts).
 *
 * All three helpers are pure: given the same `items` reference they
 * produce identical output, suitable for a `useMemo` consumer.
 *
 * Day-of-month boundary: we use the *local* calendar so the rendered
 * "today" bar lines up with the user's wall clock. Swift's
 * `Calendar.current.dateComponents([.year,.month,.day], from:)` does
 * the same.
 */
import type { Shoutout } from './store';

export interface TopicCount {
  readonly topic: string;
  readonly count: number;
}

export interface AuthorCount {
  readonly author: string;
  readonly count: number;
}

export interface TimeSeriesPoint {
  /** ISO `YYYY-MM-DD` in the local timezone. */
  readonly date: string;
  /** Number of shoutouts created on that day (local). */
  readonly count: number;
}

/** "Other" bucket label — visible to assistive tech. */
export const OTHER_BUCKET_LABEL = 'Other';

const DEFAULT_TOP_N = 5;
const DEFAULT_DAYS = 30;

/**
 * Group shoutouts by their `subject` field (the "topic"), keep the
 * `topN` most-frequent topics, and roll the remainder into an `Other`
 * bucket so the chart axis stays bounded.
 *
 * Blank / whitespace-only subjects are skipped (no synthetic topic).
 */
export function aggregateByTopic(
  shoutouts: readonly Shoutout[],
  topN: number = DEFAULT_TOP_N
): readonly TopicCount[] {
  const counts = new Map<string, number>();
  for (const s of shoutouts) {
    const topic = s.subject.trim();
    if (topic.length === 0) continue;
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return rollUpTopN(counts, topN, 'topic');
}

/**
 * Group shoutouts by `counterpartName` (the "author" of an incoming
 * shoutout, the recipient of an outgoing one — Swift treats both as
 * the visible counterpart). Top-N + "Other" bucket as above.
 */
export function aggregateByAuthor(
  shoutouts: readonly Shoutout[],
  topN: number = DEFAULT_TOP_N
): readonly AuthorCount[] {
  const counts = new Map<string, number>();
  for (const s of shoutouts) {
    const author = s.counterpartName.trim();
    if (author.length === 0) continue;
    counts.set(author, (counts.get(author) ?? 0) + 1);
  }
  return rollUpTopN(counts, topN, 'author');
}

/**
 * Daily count series for the last `days` calendar days (default 30),
 * inclusive of *today*. Returns an array of length `days`, oldest
 * day first, so the consumer can index `points[i].count` against the
 * X axis directly.
 *
 * Uses local time (Calendar.current) to match Swift parity.
 */
export function timeSeriesDaily(
  shoutouts: readonly Shoutout[],
  days: number = DEFAULT_DAYS,
  now: Date = new Date()
): readonly TimeSeriesPoint[] {
  const today = startOfLocalDay(now);
  const buckets = new Map<string, number>();
  const cutoff = today.getTime() - (days - 1) * MS_PER_DAY;

  for (const s of shoutouts) {
    const day = startOfLocalDay(s.createdAt);
    if (day.getTime() < cutoff || day.getTime() > today.getTime()) continue;
    const key = formatLocalDate(day);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const out: TimeSeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * MS_PER_DAY);
    const key = formatLocalDate(d);
    out.push({ date: key, count: buckets.get(key) ?? 0 });
  }
  return out;
}

// ----- helpers ----------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, '0');
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type TopicOrAuthor<K extends 'topic' | 'author'> = K extends 'topic'
  ? TopicCount
  : AuthorCount;

function rollUpTopN<K extends 'topic' | 'author'>(
  counts: ReadonlyMap<string, number>,
  topN: number,
  key: K
): readonly TopicOrAuthor<K>[] {
  const sorted = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const top = sorted.slice(0, Math.max(0, topN));
  const rest = sorted.slice(Math.max(0, topN));
  const out = top.map(([label, count]) =>
    (key === 'topic'
      ? { topic: label, count }
      : { author: label, count }) as TopicOrAuthor<K>
  );
  if (rest.length > 0) {
    const otherCount = rest.reduce((acc, [, n]) => acc + n, 0);
    out.push(
      (key === 'topic'
        ? { topic: OTHER_BUCKET_LABEL, count: otherCount }
        : { author: OTHER_BUCKET_LABEL, count: otherCount }) as TopicOrAuthor<K>
    );
  }
  return out;
}
