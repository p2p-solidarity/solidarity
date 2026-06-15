/**
 * ScanWindowOverlay — dim mask cut to a centred square window with four
 * corner brackets.
 *
 * Replaces the standalone ScanningFrameView (white 250×250 square) with a
 * proper "camera scanner" affordance: the area outside the window is dimmed
 * so the user knows where to point the chip, and the corner brackets give a
 * visible aim target without a full border that competes with the QR.
 *
 * The mask is pure flex layout (no measurement, no SVG, no per-frame work),
 * so the camera pipeline never sees this component. An optional
 * `bracketScale` SharedValue lets the consumer pulse the brackets when a
 * code is captured.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { Colors } from '@/constants/Colors';

export interface ScanWindowOverlayProps {
  /** Side length of the (square) scan window in dp. */
  readonly size: number;
  /** Window border radius. */
  readonly borderRadius?: number;
  /** Bracket color — defaults to brand `terminalGreen`. */
  readonly cornerColor?: string;
  /** Bracket length (each leg) — defaults to 30dp. */
  readonly cornerLength?: number;
  /** Bracket bar thickness — defaults to 4dp. */
  readonly cornerThickness?: number;
  /**
   * Optional Reanimated SharedValue (1..1.2) for the bracket pulse driven
   * by the consumer's capture animation. When `undefined`, brackets are
   * static.
   */
  readonly bracketScale?: SharedValue<number>;
  /** Slot rendered inside the window (e.g. progress label, sketch). */
  readonly children?: ReactNode;
}

export function ScanWindowOverlay({
  size,
  borderRadius = 20,
  cornerColor = Colors.terminalGreen,
  cornerLength = 30,
  cornerThickness = 4,
  bracketScale,
  children,
}: ScanWindowOverlayProps): ReactNode {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.column}>
        <View style={styles.mask} />
        <View style={{ height: size, flexDirection: 'row' }}>
          <View style={styles.mask} />
          <View
            style={{
              width: size,
              height: size,
              borderRadius,
              overflow: 'visible',
            }}
            pointerEvents="box-none"
          >
            {children}
            <CornerBrackets
              size={size}
              length={cornerLength}
              thickness={cornerThickness}
              color={cornerColor}
              radius={borderRadius}
              scale={bracketScale}
            />
          </View>
          <View style={styles.mask} />
        </View>
        <View style={styles.mask} />
      </View>
    </View>
  );
}

function CornerBrackets({
  size,
  length,
  thickness,
  color,
  radius,
  scale,
}: {
  size: number;
  length: number;
  thickness: number;
  color: string;
  radius: number;
  scale: SharedValue<number> | undefined;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale ? scale.value : 1 }],
  }));

  // Each bracket is an L-shape built from two bars sharing the corner.
  const bracket = (
    horizontal: { width: number; height: number },
    vertical: { width: number; height: number },
  ) => ({ horizontal, vertical });

  const horizontal = { width: length, height: thickness };
  const vertical = { width: thickness, height: length };
  const dim = bracket(horizontal, vertical);

  return (
    <Animated.View
      style={[
        { position: 'absolute', top: 0, left: 0, width: size, height: size },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      {/* topLeft */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, borderTopLeftRadius: radius, backgroundColor: color, ...dim.horizontal }}
      />
      <View
        style={{ position: 'absolute', top: 0, left: 0, borderTopLeftRadius: radius, backgroundColor: color, ...dim.vertical }}
      />
      {/* topRight */}
      <View
        style={{ position: 'absolute', top: 0, right: 0, borderTopRightRadius: radius, backgroundColor: color, ...dim.horizontal }}
      />
      <View
        style={{ position: 'absolute', top: 0, right: 0, borderTopRightRadius: radius, backgroundColor: color, ...dim.vertical }}
      />
      {/* bottomLeft */}
      <View
        style={{ position: 'absolute', bottom: 0, left: 0, borderBottomLeftRadius: radius, backgroundColor: color, ...dim.horizontal }}
      />
      <View
        style={{ position: 'absolute', bottom: 0, left: 0, borderBottomLeftRadius: radius, backgroundColor: color, ...dim.vertical }}
      />
      {/* bottomRight */}
      <View
        style={{ position: 'absolute', bottom: 0, right: 0, borderBottomRightRadius: radius, backgroundColor: color, ...dim.horizontal }}
      />
      <View
        style={{ position: 'absolute', bottom: 0, right: 0, borderBottomRightRadius: radius, backgroundColor: color, ...dim.vertical }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, flexDirection: 'column' },
  mask: { flex: 1, backgroundColor: Colors.scanDim },
});
