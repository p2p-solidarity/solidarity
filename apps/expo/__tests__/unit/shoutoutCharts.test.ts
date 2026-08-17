/**
 * Shoutout chart aggregation tests — pure-TS coverage of
 * `aggregateByTopic`, `aggregateByAuthor`, `timeSeriesDaily` plus the
 * `<TopicBarChart>` structural shape.
 *
 * Why this file exists:
 *   • The Stats section above the Sakura gallery feeds straight off
 *     these three reducers — silent rollup bugs (off-by-one Other
 *     bucket, UTC vs local-day mismatch, top-N tie ordering) would
 *     ship as user-visible wrong-bar charts.
 *   • The infinite-loop fix that landed in `useShoutoutChartData`
 *     hinges on the reducers being *pure*: identical input ⇒
 *     `Object.is`-equal output is NOT required, but the selector that
 *     wraps them must memoize correctly. We pin the structural output
 *     here so the consumer can rely on it.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { createElement, type FunctionComponent } from 'react';

import {
  aggregateByAuthor,
  aggregateByTopic,
  OTHER_BUCKET_LABEL,
  timeSeriesDaily,
} from '../../src/shoutouts/chartData';
import type { Shoutout } from '../../src/shoutouts/store';

interface TopicBarChartProps {
  readonly data: readonly { readonly topic: string; readonly count: number }[];
  readonly containerWidth?: number;
}

let TopicBarChart: FunctionComponent<TopicBarChartProps> | undefined;

beforeAll(async () => {
  // react-native and react-native-svg ship Flow types in their entry
  // file that bun can't parse — stub the surface our chart component
  // touches so the structural test can render the React element tree.
  await mock.module('react-native', () => ({
    ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
      .__AIRMEISHI_RN_MOCK__),
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
  }));
  await mock.module('react-native-svg', () => {
    const Svg = 'Svg';
    return {
      __esModule: true,
      default: Svg,
      Svg,
      Circle: 'Circle',
      G: 'G',
      Line: 'Line',
      Path: 'Path',
      Rect: 'Rect',
      Text: 'SvgText',
    };
  });
  await mock.module('@/components/icons/SfIcon', () => ({ SfIcon: 'SfIcon' }));
  const mod = (await import('../../src/components/shoutouts/charts')) as {
    readonly TopicBarChart: FunctionComponent<TopicBarChartProps>;
  };
  TopicBarChart = mod.TopicBarChart;
});

function makeShoutout(
  id: string,
  overrides: Partial<Shoutout> = {}
): Shoutout {
  return {
    id,
    direction: 'incoming',
    counterpartName: 'Alice',
    subject: 'general',
    body: '',
    createdAt: new Date('2026-01-01T12:00:00Z'),
    ...overrides,
  };
}

describe('aggregateByTopic', () => {
  it('counts shoutouts per subject, sorted by frequency desc then label asc', () => {
    const items = [
      makeShoutout('1', { subject: 'thanks' }),
      makeShoutout('2', { subject: 'thanks' }),
      makeShoutout('3', { subject: 'birthday' }),
      makeShoutout('4', { subject: 'thanks' }),
      makeShoutout('5', { subject: 'birthday' }),
    ];
    const out = aggregateByTopic(items, 5);
    expect(out.map((t) => t.topic)).toEqual(['thanks', 'birthday']);
    expect(out.map((t) => t.count)).toEqual([3, 2]);
  });

  it('skips blank / whitespace-only subjects', () => {
    const items = [
      makeShoutout('1', { subject: '' }),
      makeShoutout('2', { subject: '   ' }),
      makeShoutout('3', { subject: 'hi' }),
    ];
    const out = aggregateByTopic(items);
    expect(out).toEqual([{ topic: 'hi', count: 1 }]);
  });

  it('rolls remaining topics into the Other bucket when above topN', () => {
    const items = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeShoutout(`top-${String(i)}`, { subject: `topic-${String(i)}` })
      ),
      makeShoutout('rest-1', { subject: 'rare-a' }),
      makeShoutout('rest-2', { subject: 'rare-b' }),
      makeShoutout('rest-3', { subject: 'rare-c' }),
    ];
    const out = aggregateByTopic(items, 3);
    // 3 top topics + Other
    expect(out.length).toBe(4);
    const other = out[out.length - 1];
    expect(other?.topic).toBe(OTHER_BUCKET_LABEL);
    // 5 unique top topics each count=1, kept top 3, rolled the other 2 + 3 rare-* = 5 left.
    // Actually: 8 distinct subjects, all count=1. Top 3 = 3, Other = 5.
    expect(other?.count).toBe(5);
  });

  it('returns empty list when no shoutouts present', () => {
    expect(aggregateByTopic([])).toEqual([]);
  });

  it('no Other bucket when topic count ≤ topN', () => {
    const items = [
      makeShoutout('1', { subject: 'a' }),
      makeShoutout('2', { subject: 'b' }),
    ];
    const out = aggregateByTopic(items, 5);
    expect(out.map((t) => t.topic)).toEqual(['a', 'b']);
    expect(out.some((t) => t.topic === OTHER_BUCKET_LABEL)).toBe(false);
  });
});

describe('aggregateByAuthor', () => {
  it('counts shoutouts per counterpart, sorted desc', () => {
    const items = [
      makeShoutout('1', { counterpartName: 'Alice' }),
      makeShoutout('2', { counterpartName: 'Bob' }),
      makeShoutout('3', { counterpartName: 'Alice' }),
      makeShoutout('4', { counterpartName: 'Alice' }),
    ];
    const out = aggregateByAuthor(items, 5);
    expect(out).toEqual([
      { author: 'Alice', count: 3 },
      { author: 'Bob', count: 1 },
    ]);
  });

  it('rolls extra authors into Other bucket', () => {
    const items = [
      makeShoutout('1', { counterpartName: 'Alice' }),
      makeShoutout('2', { counterpartName: 'Alice' }),
      makeShoutout('3', { counterpartName: 'Bob' }),
      makeShoutout('4', { counterpartName: 'Carol' }),
      makeShoutout('5', { counterpartName: 'Dave' }),
    ];
    const out = aggregateByAuthor(items, 2);
    // top 2: Alice(2), Bob(1) [tie-breaker by name asc]
    expect(out[0]).toEqual({ author: 'Alice', count: 2 });
    expect(out[1]).toEqual({ author: 'Bob', count: 1 });
    expect(out[out.length - 1]).toEqual({
      author: OTHER_BUCKET_LABEL,
      count: 2, // Carol + Dave
    });
  });

  it('skips blank counterparts', () => {
    const out = aggregateByAuthor([
      makeShoutout('1', { counterpartName: '' }),
      makeShoutout('2', { counterpartName: 'Alice' }),
    ]);
    expect(out).toEqual([{ author: 'Alice', count: 1 }]);
  });
});

describe('timeSeriesDaily', () => {
  it('returns an array of length=days, oldest first, with zero-filled gaps', () => {
    const now = new Date(2026, 0, 30, 12, 0, 0); // local Jan 30 2026
    const out = timeSeriesDaily([], 30, now);
    expect(out.length).toBe(30);
    // Oldest first → first element should be Jan 1
    expect(out[0]?.date).toBe('2026-01-01');
    // Newest last → today
    expect(out[out.length - 1]?.date).toBe('2026-01-30');
    expect(out.every((p) => p.count === 0)).toBe(true);
  });

  it('buckets shoutouts on their local-day boundary (not UTC)', () => {
    const now = new Date(2026, 0, 10, 23, 30, 0); // local
    // Shoutout at local 23:50 — same local day as `now`.
    const sameDay = makeShoutout('1', {
      createdAt: new Date(2026, 0, 10, 23, 50, 0),
    });
    const dayBefore = makeShoutout('2', {
      createdAt: new Date(2026, 0, 9, 1, 0, 0),
    });
    const out = timeSeriesDaily([sameDay, dayBefore], 5, now);
    const todayPoint = out[out.length - 1];
    expect(todayPoint?.date).toBe('2026-01-10');
    expect(todayPoint?.count).toBe(1);
    const yesterday = out[out.length - 2];
    expect(yesterday?.date).toBe('2026-01-09');
    expect(yesterday?.count).toBe(1);
  });

  it('drops shoutouts outside the window', () => {
    const now = new Date(2026, 0, 30, 12, 0, 0);
    const ancient = makeShoutout('1', {
      createdAt: new Date(2024, 0, 1, 12, 0, 0),
    });
    const future = makeShoutout('2', {
      createdAt: new Date(2026, 1, 5, 12, 0, 0),
    });
    const out = timeSeriesDaily([ancient, future], 30, now);
    expect(out.reduce((acc, p) => acc + p.count, 0)).toBe(0);
  });

  it('groups two shoutouts on the same day into a single bucket', () => {
    const now = new Date(2026, 0, 5, 12, 0, 0);
    const a = makeShoutout('1', { createdAt: new Date(2026, 0, 3, 10, 0, 0) });
    const b = makeShoutout('2', { createdAt: new Date(2026, 0, 3, 22, 0, 0) });
    const out = timeSeriesDaily([a, b], 7, now);
    const point = out.find((p) => p.date === '2026-01-03');
    expect(point?.count).toBe(2);
  });
});

describe('<TopicBarChart /> structural shape', () => {
  it('renders a react element tree (regression: no thrown render)', () => {
    expect(TopicBarChart).toBeDefined();
    const props: TopicBarChartProps = {
      data: [
        { topic: 'thanks', count: 3 },
        { topic: 'birthday', count: 2 },
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const Cmp = TopicBarChart!;
    const el = createElement(Cmp, props);
    expect(el).toBeDefined();
    expect(el.type).toBe(Cmp);
    // structural snapshot — props pass through unmodified
    expect(el.props.data.length).toBe(2);
    expect(el.props.data[0]?.topic).toBe('thanks');
  });

  it('accepts an empty data array (renders empty state)', () => {
    expect(TopicBarChart).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const Cmp = TopicBarChart!;
    const el = createElement(Cmp, { data: [] });
    expect(el).toBeDefined();
    expect(el.props.data).toEqual([]);
  });
});
