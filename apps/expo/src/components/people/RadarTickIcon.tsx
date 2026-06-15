/**
 * RadarTickIcon — 5 concentric strokes with fading opacity, evoking the
 * proximity-exchange radar without pulling in an SVG asset.
 * 1:1 port of solidarity/Views/PeopleViews/TrustGraphContactRow.swift's
 * private `RadarTickIcon` view.
 */
import { View } from 'react-native';

import { Colors } from '@/constants/Colors';

export function RadarTickIcon({ size = 16 }: { size?: number }) {
  const stroke = Math.max(0.5, size * 0.0208);
  const stops = [
    { diameter: size * 0.131, opacity: 1.0 },
    { diameter: size * 0.313, opacity: 1.0 },
    { diameter: size * 0.524, opacity: 0.5 },
    { diameter: size * 0.767, opacity: 0.2 },
    { diameter: size * 0.979, opacity: 0.05 },
  ];
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {stops.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: s.diameter,
            height: s.diameter,
            borderRadius: s.diameter / 2,
            borderWidth: stroke,
            borderColor: hexWithOpacity(Colors.text2, s.opacity),
          }}
        />
      ))}
    </View>
  );
}

function hexWithOpacity(hex: string, opacity: number): string {
  const a = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
