/**
 * Themed shoutout charts — pure `react-native-svg` (no extra deps).
 *
 * Renders three small analytics surfaces above the gallery:
 *   • TopicBarChart  — horizontal bars, top 5 topics + Other.
 *   • AuthorDonut    — donut chart, top 5 authors + Other.
 *   • ActivityLine   — 30-day daily count line.
 *
 * Visual contract:
 *   • Accent fill / line: Colors.accentRose.
 *   • Axis labels: Colors.text2, segment labels: Colors.text1.
 *   • Grid / divider: Colors.divider.
 *
 * Accessibility: every surface has an `accessibilityRole="image"`
 * plus an `accessibilityLabel` describing the data shape, and
 * individual segments expose their own readable label.
 *
 * Why the eslint-disable: react-native-svg's `Rect` and `Text`
 * declare `x`/`y` via SVG-standard prop tables (`RectProps`,
 * `TextProps`) that inherit *from* `TransformProps` where the
 * legacy RN transform `x`/`y` lives marked `@deprecated`. The
 * combined override is what every SVG consumer in the repo uses
 * (see DecorativeBlobs cx/cy + Wordmark width/height), but the
 * `@typescript-eslint/no-deprecated` rule flags the inherited
 * symbol regardless. Disabling at the file level keeps the SVG
 * positioning idiomatic.
 */
/* eslint-disable @typescript-eslint/no-deprecated */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import type {
  AuthorCount,
  TimeSeriesPoint,
  TopicCount,
} from '@/shoutouts/chartData';
import type { ShoutoutChartData } from '@/shoutouts/store';

const DEFAULT_WIDTH = 320;
const BAR_HEIGHT = 28;
const BAR_GAP = 8;
const LABEL_WIDTH = 100;
const DONUT_SIZE = 200;
const DONUT_STROKE = 28;
const LINE_HEIGHT = 140;
const LINE_PADDING = 16;

/** Palette for donut slices — accentRose at 100 %, then mauve / blob ramp. */
const SLICE_COLORS: readonly string[] = [
  Colors.accentRose,
  Colors.primaryMauve,
  Colors.dustyMauve,
  Colors.featuredCardBg,
  Colors.blobCenter,
  Colors.divider,
];

// ----- TopicBarChart -----------------------------------------------------

export interface TopicBarChartProps {
  readonly data: readonly TopicCount[];
  readonly containerWidth?: number;
}

export function TopicBarChart({
  data,
  containerWidth = DEFAULT_WIDTH,
}: TopicBarChartProps): ReactNode {
  const total = data.reduce((acc, d) => acc + d.count, 0);
  const max = Math.max(1, ...data.map((d) => d.count));
  const barAreaWidth = Math.max(40, containerWidth - LABEL_WIDTH - 40);
  const height = Math.max(1, data.length) * (BAR_HEIGHT + BAR_GAP) + BAR_GAP;

  if (data.length === 0) {
    return <EmptyChart label="No topics yet" width={containerWidth} height={64} />;
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Top topics chart, ${String(data.length)} categories, ${String(total)} total shoutouts`}
    >
      <Svg width={containerWidth} height={height}>
        {data.map((d, i) => {
          const y = BAR_GAP + i * (BAR_HEIGHT + BAR_GAP);
          const w = Math.max(2, (d.count / max) * barAreaWidth);
          return (
            <G key={d.topic}>
              <SvgText
                x={0}
                y={y + BAR_HEIGHT / 2 + 4}
                fontSize={12}
                fill={Colors.text1}
              >
                {truncate(d.topic, 14)}
              </SvgText>
              <Rect
                x={LABEL_WIDTH}
                y={y}
                width={w}
                height={BAR_HEIGHT}
                rx={6}
                fill={Colors.accentRose}
                opacity={0.85}
              />
              <SvgText
                x={LABEL_WIDTH + w + 6}
                y={y + BAR_HEIGHT / 2 + 4}
                fontSize={12}
                fill={Colors.text2}
              >
                {String(d.count)}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

// ----- AuthorDonut -------------------------------------------------------

export interface AuthorDonutProps {
  readonly data: readonly AuthorCount[];
  readonly containerWidth?: number;
}

export function AuthorDonut({
  data,
  containerWidth = DEFAULT_WIDTH,
}: AuthorDonutProps): ReactNode {
  const total = data.reduce((acc, d) => acc + d.count, 0);
  const size = Math.min(containerWidth, DONUT_SIZE);

  if (total === 0) {
    return <EmptyChart label="No authors yet" width={containerWidth} height={size} />;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - DONUT_STROKE) / 2;
  let cursor = -Math.PI / 2; // start at 12 o'clock

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Top authors donut, ${String(data.length)} segments, ${String(total)} total shoutouts`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}
    >
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke={Colors.divider} strokeWidth={DONUT_STROKE} fill="none" />
        {data.map((d, i) => {
          const fraction = d.count / total;
          const start = cursor;
          const end = cursor + fraction * Math.PI * 2;
          cursor = end;
          return (
            <Path
              key={d.author}
              d={arcPath(cx, cy, r, start, end)}
              stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
              strokeWidth={DONUT_STROKE}
              fill="none"
              strokeLinecap="butt"
              accessibilityLabel={`${d.author}: ${String(d.count)}`}
            />
          );
        })}
        <SvgText
          x={cx}
          y={cy - 2}
          fontSize={20}
          fontWeight="700"
          fill={Colors.text1}
          textAnchor="middle"
        >
          {String(total)}
        </SvgText>
        <SvgText
          x={cx}
          y={cy + 16}
          fontSize={11}
          fill={Colors.text2}
          textAnchor="middle"
        >
          shoutouts
        </SvgText>
      </Svg>
      <View style={{ flex: 1, gap: 6 }}>
        {data.map((d, i) => (
          <DonutLegendRow
            key={d.author}
            color={SLICE_COLORS[i % SLICE_COLORS.length] ?? Colors.accentRose}
            label={d.author}
            count={d.count}
          />
        ))}
      </View>
    </View>
  );
}

function DonutLegendRow({
  color,
  label,
  count,
}: {
  readonly color: string;
  readonly label: string;
  readonly count: number;
}): ReactNode {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
      <Text
        numberOfLines={1}
        className="text-text1"
        style={{ flex: 1, fontSize: 12 }}
      >
        {label}
      </Text>
      <Text className="text-text2" style={{ fontSize: 12 }}>
        {String(count)}
      </Text>
    </View>
  );
}

// ----- ActivityLine ------------------------------------------------------

export interface ActivityLineProps {
  readonly data: readonly TimeSeriesPoint[];
  readonly containerWidth?: number;
}

export function ActivityLine({
  data,
  containerWidth = DEFAULT_WIDTH,
}: ActivityLineProps): ReactNode {
  const total = data.reduce((acc, d) => acc + d.count, 0);

  if (data.length === 0) {
    return <EmptyChart label="No activity yet" width={containerWidth} height={LINE_HEIGHT} />;
  }

  const max = Math.max(1, ...data.map((d) => d.count));
  const innerW = containerWidth - LINE_PADDING * 2;
  const innerH = LINE_HEIGHT - LINE_PADDING * 2;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const yFor = (count: number): number =>
    LINE_PADDING + innerH - (count / max) * innerH;
  const points = data.map((d, i) => ({
    x: LINE_PADDING + i * stepX,
    y: yFor(d.count),
    count: d.count,
    date: d.date,
  }));
  const path =
    points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
  const areaPath = `${path} L${points[points.length - 1]?.x.toFixed(1) ?? '0'},${(LINE_PADDING + innerH).toFixed(1)} L${points[0]?.x.toFixed(1) ?? '0'},${(LINE_PADDING + innerH).toFixed(1)} Z`;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Activity line, ${String(data.length)} days, ${String(total)} total shoutouts`}
    >
      <Svg width={containerWidth} height={LINE_HEIGHT}>
        <Line
          x1={LINE_PADDING}
          y1={LINE_PADDING + innerH}
          x2={LINE_PADDING + innerW}
          y2={LINE_PADDING + innerH}
          stroke={Colors.divider}
          strokeWidth={0.5}
        />
        <Path d={areaPath} fill={Colors.accentRose} opacity={0.18} />
        <Path
          d={path}
          stroke={Colors.accentRose}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.length > 0 ? (
          <Circle
            cx={points[points.length - 1]?.x}
            cy={points[points.length - 1]?.y}
            r={3}
            fill={Colors.accentRose}
          />
        ) : null}
        <SvgText
          x={LINE_PADDING}
          y={LINE_HEIGHT - 2}
          fontSize={10}
          fill={Colors.text2}
        >
          {data[0]?.date.slice(5) ?? ''}
        </SvgText>
        <SvgText
          x={containerWidth - LINE_PADDING}
          y={LINE_HEIGHT - 2}
          fontSize={10}
          fill={Colors.text2}
          textAnchor="end"
        >
          {data[data.length - 1]?.date.slice(5) ?? ''}
        </SvgText>
      </Svg>
    </View>
  );
}

// ----- helpers -----------------------------------------------------------

function arcPath(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number
): string {
  // Full circle ⇒ split into two arcs so SVG can render it.
  if (end - start >= Math.PI * 2 - 1e-6) {
    return [
      arcPath(cx, cy, r, start, start + Math.PI),
      arcPath(cx, cy, r, start + Math.PI, end),
    ].join(' ');
  }
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r.toFixed(2)},${r.toFixed(2)} 0 ${String(largeArc)} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function EmptyChart({
  label,
  width,
  height,
}: {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}): ReactNode {
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width,
        height,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: Colors.divider,
        borderRadius: 8,
        borderStyle: 'dashed',
      }}
    >
      <Text className="text-text3" style={{ fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

// ----- StatsSection (Feed / Stats tab toggle + body) ---------------------

const STATS_CARD_INNER_WIDTH = 280;

export function SectionTabButton({
  label,
  active,
  onPress,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: active ? `${Colors.accentRose}33` : Colors.searchBg,
      }}
    >
      <Text
        className={active ? 'text-text1' : 'text-text2'}
        style={{ fontSize: 13, fontWeight: active ? '600' : '500' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export interface StatsSectionProps {
  readonly chart: ShoutoutChartData;
}

/** Stats body — loading / empty / ready, Rule 8 compliant. */
export function StatsSection({ chart }: StatsSectionProps): ReactNode {
  if (!chart.hydrated) {
    return (
      <View className="px-4" style={{ gap: 16 }} accessibilityLabel="Stats loading">
        <StatsCard title="Loading stats…">
          <View
            style={{
              height: 64,
              borderRadius: 8,
              backgroundColor: Colors.searchBg,
            }}
          />
        </StatsCard>
      </View>
    );
  }
  if (chart.totalCount === 0) {
    return (
      <View className="items-center" style={{ marginTop: 60, gap: 12 }}>
        <SfIcon name="chart.bar" size={36} color={Colors.text2} />
        <Text className="text-text2" style={{ fontSize: 16 }}>
          No stats yet
        </Text>
        <Text className="text-text3" style={{ fontSize: 12 }}>
          Send or receive a sakura to see analytics
        </Text>
      </View>
    );
  }
  return (
    <View className="px-4" style={{ gap: 16 }}>
      <StatsCard title="Top topics">
        <TopicBarChart data={chart.topics} containerWidth={STATS_CARD_INNER_WIDTH} />
      </StatsCard>
      <StatsCard title="Top authors">
        <AuthorDonut data={chart.authors} containerWidth={STATS_CARD_INNER_WIDTH} />
      </StatsCard>
      <StatsCard title="Activity (30 days)">
        <ActivityLine data={chart.activity} containerWidth={STATS_CARD_INNER_WIDTH} />
      </StatsCard>
    </View>
  );
}

function StatsCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <View
      className="bg-cardBg"
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Colors.divider,
        padding: 16,
        gap: 12,
      }}
    >
      <Text className="text-text1" style={{ fontSize: 15, fontWeight: '600' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}
