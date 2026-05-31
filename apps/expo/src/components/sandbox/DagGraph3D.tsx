/**
 * DagGraph3D — pseudo-3D force-directed DAG visualization for the DAG
 * Lab and (optionally) any other sandbox screen that wants to see the
 * shape of the chain.
 *
 * Implementation notes:
 *   - Layout is precomputed on the JS thread once per `nodes` array
 *     identity (useMemo). Force-directed simulation runs ~200 iterations
 *     with O(n²) repulsion + O(edges) springs. For ≤ 200 nodes this is
 *     under ~50 ms on a modern phone — acceptable for the sandbox.
 *   - The projection is STATIC (a fixed yaw + tilt) — the force-directed
 *     layout + perspective already read as 3D. An earlier version drove an
 *     auto-rotate via a ~30 fps React `setTick`, which re-rendered the whole
 *     SVG every frame and froze DAG Lab on the A12 ("Maximum update depth
 *     exceeded"). Per CLAUDE rule 9, high-frequency animation must NOT be React
 *     state — re-add rotation via a Reanimated SharedValue + Animated SVG if
 *     it's worth it.
 *   - Author color is deterministic per author pubkey (cheap hash → HSL).
 *   - HEAD nodes render larger + with an outer halo so they stand out.
 *   - `onSelectNode` fires when a node is tapped.
 *
 * No new dependencies — react-native-svg (already pinned in package.json)
 * + react-native-reanimated drive everything. Bundle stays lean.
 *
 * This is sandbox-only; never mounted on the public surface.
 */
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';

import { Colors } from '@/constants/Colors';
import type { DagNode } from '@/dag/node';

export interface DagGraph3DProps {
  readonly nodes: readonly DagNode[];
  readonly heads: readonly string[];
  readonly width: number;
  readonly height: number;
  /** Pubkey hex of the local author — gets the brand pink instead of the hashed colour. */
  readonly localAuthorPubkey?: string;
  readonly onSelectNode?: (nodeId: string) => void;
  /** Cap on rendered nodes — anything beyond is hidden with a "+N more" label. */
  readonly maxNodes?: number;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface LayoutEntry {
  readonly id: string;
  readonly pos: Vec3;
  readonly isHead: boolean;
  readonly author: string;
  readonly parents: readonly string[];
}

interface Edge {
  readonly from: string;
  readonly to: string;
}

const STATIC_YAW = 0.6;            // fixed 3D viewing angle (no auto-rotate — see `projected`)
const FORCE_ITERATIONS = 180;
const FOCAL_DEPTH = 2.4;          // larger = less perspective foreshortening
const NODE_BASE_RADIUS = 5;
const NODE_DEPTH_BOOST = 2.5;
const HEAD_HALO_RADIUS = 8;

export function DagGraph3D({
  nodes,
  heads,
  width,
  height,
  localAuthorPubkey,
  onSelectNode,
  maxNodes = 200,
}: DagGraph3DProps) {
  const limitedNodes = useMemo(
    () => (nodes.length <= maxNodes ? nodes : nodes.slice(0, maxNodes)),
    [nodes, maxNodes]
  );
  const overflow = Math.max(0, nodes.length - limitedNodes.length);

  const { layout, edges } = useMemo(() => computeLayout(limitedNodes, heads), [limitedNodes, heads]);

  const projected = useMemo(() => {
    if (layout.length === 0) return { points: [], orderedEdges: [] };
    // Static 3D projection: a fixed yaw + tilt gives depth with NO per-frame
    // re-render. The old `tick`-driven 30 fps auto-rotate re-rendered the whole
    // SVG (≤200 elements) and pegged the JS thread on the A12 — DAG Lab froze
    // and React threw "Maximum update depth exceeded". CLAUDE rule 9: high-
    // frequency animation must never be React state. Re-add rotation via a
    // Reanimated SharedValue + Animated SVG later if it's worth it.
    const yawRad = STATIC_YAW;
    const tiltRad = 0.45; // a gentle X-axis tilt so the graph looks 3D
    const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
    const cx = Math.cos(tiltRad), sx = Math.sin(tiltRad);
    const cw = width / 2;
    const ch = height / 2;
    const scale = Math.min(width, height) * 0.38;
    const points = layout.map((entry) => {
      const { x, y, z } = entry.pos;
      // Rotate around Y axis (yaw), then around X axis (fixed tilt)
      const x1 = x * cy + z * sy;
      const z1 = -x * sy + z * cy;
      const y1 = y * cx - z1 * sx;
      const z2 = y * sx + z1 * cx;
      const depth = FOCAL_DEPTH / (FOCAL_DEPTH - z2);
      const screenX = cw + x1 * scale * depth;
      const screenY = ch + y1 * scale * depth;
      const sizeFactor = Math.max(0.4, Math.min(1.6, depth));
      const alpha = Math.max(0.25, Math.min(1, (z2 + 1.4) / 2.4));
      return {
        id: entry.id,
        screenX,
        screenY,
        sizeFactor,
        alpha,
        z: z2,
        isHead: entry.isHead,
        color: colorForAuthor(entry.author, entry.author === localAuthorPubkey),
      };
    });
    const idToPoint = new Map(points.map((p) => [p.id, p]));
    const orderedEdges: Array<{
      readonly key: string;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly z: number;
      readonly alpha: number;
      readonly color: string;
    }> = [];
    for (const e of edges) {
      const a = idToPoint.get(e.from);
      const b = idToPoint.get(e.to);
      if (!a || !b) continue;
      const midZ = (a.z + b.z) / 2;
      orderedEdges.push({
        key: `${e.from.slice(0, 8)}-${e.to.slice(0, 8)}`,
        x1: a.screenX,
        y1: a.screenY,
        x2: b.screenX,
        y2: b.screenY,
        z: midZ,
        alpha: Math.max(0.12, Math.min(0.55, (midZ + 1.4) / 2.4)),
        color: a.color,
      });
    }
    // Back-to-front for both edges and nodes so nearer items occlude properly.
    points.sort((p, q) => p.z - q.z);
    orderedEdges.sort((p, q) => p.z - q.z);
    return { points, orderedEdges };
  }, [layout, edges, width, height, localAuthorPubkey]);

  if (layout.length === 0) {
    return (
      <View
        style={{
          width,
          height,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: Colors.cardBg,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      >
        <Text style={{ color: Colors.text2, fontSize: 13 }}>
          No DAG nodes yet — append one below.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        width,
        height,
        backgroundColor: Colors.cardBg,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Colors.divider,
        overflow: 'hidden',
      }}
    >
      <Svg width={width} height={height}>
        <G>
          {projected.orderedEdges.map((e) => (
            <Line
              key={e.key}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke={e.color}
              strokeWidth={1}
              opacity={e.alpha}
            />
          ))}
          {projected.points.map((p) => (
            <G key={p.id}>
              {p.isHead ? (
                <Circle
                  cx={p.screenX}
                  cy={p.screenY}
                  r={(NODE_BASE_RADIUS + HEAD_HALO_RADIUS) * p.sizeFactor}
                  fill={p.color}
                  opacity={0.18 * p.alpha}
                />
              ) : null}
              <Circle
                cx={p.screenX}
                cy={p.screenY}
                r={(NODE_BASE_RADIUS + (p.isHead ? NODE_DEPTH_BOOST : 0)) * p.sizeFactor}
                fill={p.color}
                opacity={p.alpha}
                stroke={p.isHead ? '#FFFFFF' : 'transparent'}
                strokeWidth={p.isHead ? 1 : 0}
                onPress={onSelectNode ? () => { onSelectNode(p.id); } : undefined}
              />
            </G>
          ))}
        </G>
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 10,
          bottom: 8,
          right: 10,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: Colors.text3, fontSize: 10, fontFamily: 'Menlo' }}>
          {`${String(layout.length)} node${layout.length === 1 ? '' : 's'} · ${String(heads.length)} HEAD${heads.length === 1 ? '' : 's'} · ${String(edges.length)} edge${edges.length === 1 ? '' : 's'}`}
          {overflow > 0 ? ` · +${String(overflow)} hidden` : ''}
        </Text>
      </View>
    </View>
  );
}

function computeLayout(
  nodes: readonly DagNode[],
  heads: readonly string[]
): { readonly layout: readonly LayoutEntry[]; readonly edges: readonly Edge[] } {
  if (nodes.length === 0) return { layout: [], edges: [] };
  const headSet = new Set(heads);
  const idIndex = new Map<string, number>();
  nodes.forEach((n, i) => idIndex.set(n.id, i));
  const positions: Vec3[] = nodes.map((n) => seedFromId(n.id));
  const forces: Vec3[] = nodes.map(() => ({ x: 0, y: 0, z: 0 }));

  const edges: Edge[] = [];
  for (const node of nodes) {
    for (const parent of node.parents) {
      if (idIndex.has(parent)) edges.push({ from: parent, to: node.id });
    }
  }

  const restLength = 0.55;
  const repulsion = 0.06;
  const springK = 0.12;
  const damping = 0.55;

  for (let iter = 0; iter < FORCE_ITERATIONS; iter++) {
    for (let i = 0; i < forces.length; i++) {
      forces[i]!.x = 0;
      forces[i]!.y = 0;
      forces[i]!.z = 0;
    }
    // Repulsion (Coulomb-ish)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const pi = positions[i]!;
        const pj = positions[j]!;
        let dx = pj.x - pi.x;
        let dy = pj.y - pi.y;
        let dz = pj.z - pi.z;
        let distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 1e-4) {
          dx = (Math.random() - 0.5) * 0.02;
          dy = (Math.random() - 0.5) * 0.02;
          dz = (Math.random() - 0.5) * 0.02;
          distSq = dx * dx + dy * dy + dz * dz + 1e-4;
        }
        const inv = repulsion / distSq;
        const dist = Math.sqrt(distSq);
        const ux = dx / dist, uy = dy / dist, uz = dz / dist;
        const fi = forces[i]!, fj = forces[j]!;
        fi.x -= ux * inv;
        fi.y -= uy * inv;
        fi.z -= uz * inv;
        fj.x += ux * inv;
        fj.y += uy * inv;
        fj.z += uz * inv;
      }
    }
    // Springs along edges
    for (const e of edges) {
      const ai = idIndex.get(e.from);
      const bi = idIndex.get(e.to);
      if (ai === undefined || bi === undefined) continue;
      const a = positions[ai]!;
      const b = positions[bi]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3;
      const stretch = dist - restLength;
      const force = springK * stretch;
      const ux = dx / dist, uy = dy / dist, uz = dz / dist;
      const fa = forces[ai]!, fb = forces[bi]!;
      fa.x += ux * force;
      fa.y += uy * force;
      fa.z += uz * force;
      fb.x -= ux * force;
      fb.y -= uy * force;
      fb.z -= uz * force;
    }
    // Apply
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const f = forces[i]!;
      p.x += f.x * damping;
      p.y += f.y * damping;
      p.z += f.z * damping;
    }
  }
  // Centre + normalise to fit roughly within a unit sphere
  let cx = 0, cy = 0, cz = 0;
  for (const p of positions) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= positions.length; cy /= positions.length; cz /= positions.length;
  let maxR = 0;
  for (const p of positions) {
    p.x -= cx; p.y -= cy; p.z -= cz;
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    if (r > maxR) maxR = r;
  }
  if (maxR > 0) {
    const scale = 1 / maxR;
    for (const p of positions) {
      p.x *= scale;
      p.y *= scale;
      p.z *= scale;
    }
  }
  const layout: LayoutEntry[] = nodes.map((n, i) => ({
    id: n.id,
    pos: positions[i]!,
    isHead: headSet.has(n.id),
    author: n.author,
    parents: n.parents,
  }));
  return { layout, edges };
}

/** Cheap deterministic seed in [-1, 1]³ from the hex id, so layout is stable across reloads. */
function seedFromId(id: string): Vec3 {
  let h1 = 0x811c9dc5, h2 = 0x12345678, h3 = 0xdeadbeef;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 + c * 31) >>> 0;
    h3 = (h3 ^ Math.imul(c, 0x5bd1e995)) >>> 0;
  }
  return {
    x: ((h1 & 0xffff) / 0x7fff) - 1,
    y: ((h2 & 0xffff) / 0x7fff) - 1,
    z: ((h3 & 0xffff) / 0x7fff) - 1,
  };
}

const PALETTE: readonly string[] = [
  '#7DC4E4', '#F5A97F', '#A6DA95', '#C6A0F6', '#EED49F',
  '#8AADF4', '#F0C6C6', '#91D7E3', '#B7BDF8', '#EE99A0',
];

function colorForAuthor(author: string, isLocal: boolean): string {
  if (isLocal) return Colors.accentRose;
  let h = 0;
  for (let i = 0; i < author.length; i++) {
    h = (h * 31 + author.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length] ?? '#888';
}
