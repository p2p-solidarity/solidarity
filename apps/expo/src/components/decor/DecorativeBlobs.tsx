/**
 * Decorative nested ellipses — mirrors solidarity/Views/Common/DecorativeBlobs.swift.
 *
 * Three concentric circles (Ø286 / Ø217 / Ø136) with radial gradient fills
 * blending blobCenter → dustyMauve, plus a thin dustyMauve outline. Used
 * behind hero content (Me tab card, onboarding splash).
 *
 * react-native-svg's `RadialGradient` matches Swift `RadialGradient` 1:1 —
 * same start/end radius, center coordinates, two-stop interpolation.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

interface Layer {
  readonly diameter: number;
  readonly opacity: number;
  readonly id: string;
}

// Pinned to the Swift implementation's three diameters + opacities.
const LAYERS: readonly Layer[] = [
  { diameter: 286, opacity: 0.05, id: 'blob-286' },
  { diameter: 217, opacity: 0.2, id: 'blob-217' },
  { diameter: 136, opacity: 0.3, id: 'blob-136' },
];

const BLOB_CENTER = '#FFE4D6';
const DUSTY_MAUVE = '#B89BB1';

interface Props {
  /** Container size (defaults to largest blob). Use 0 to disable wrapper sizing. */
  readonly size?: number;
}

function Blob({ layer }: { readonly layer: Layer }): ReactNode {
  const r = layer.diameter / 2;
  return (
    <Svg
      width={layer.diameter}
      height={layer.diameter}
      style={styles.layer}
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id={layer.id} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={BLOB_CENTER} stopOpacity={layer.opacity} />
          <Stop offset="100%" stopColor={DUSTY_MAUVE} stopOpacity={layer.opacity * 0.5} />
        </RadialGradient>
      </Defs>
      <Circle cx={r} cy={r} r={r} fill={`url(#${layer.id})`} />
      <Circle
        cx={r}
        cy={r}
        r={r - 0.5}
        fill="none"
        stroke={DUSTY_MAUVE}
        strokeOpacity={layer.opacity * 0.6}
        strokeWidth={1}
      />
    </Svg>
  );
}

export function DecorativeBlobs({ size = 286 }: Props = {}): ReactNode {
  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, size > 0 ? { width: size, height: size } : undefined]}
    >
      {LAYERS.map((layer) => (
        <Blob key={layer.id} layer={layer} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  layer: { position: 'absolute' },
});
