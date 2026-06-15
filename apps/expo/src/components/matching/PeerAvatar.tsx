/**
 * PeerAvatar — circular animal avatar used by every matching component.
 * Mirrors Swift `ImageProvider.animalImage(for:)`:
 *   `Image .resizable .scaledToFill .frame(size) .clipShape(Circle())`
 * plus a 1pt status-colour ring (and optional 2pt pulsing outer ring).
 */
import type { ReactNode } from 'react';
import { Image, View } from 'react-native';

import type { Animal } from '@solidarity/shared';

import { animalImageSource } from '@/cards/animals';
import { Colors } from '@/constants/Colors';

export interface PeerAvatarProps {
  readonly animal: Animal;
  readonly size?: number;
  readonly ringColor?: string;
  /** When set, draws a 2pt pulsing-style ring sized `size + 6`. */
  readonly outerRingColor?: string;
}

export function PeerAvatar({
  animal,
  size = 50,
  ringColor = Colors.divider,
  outerRingColor,
}: PeerAvatarProps): ReactNode {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1,
          borderColor: ringColor,
          overflow: 'hidden',
        }}
      >
        <Image
          source={animalImageSource(animal)}
          style={{ width: size, height: size }}
          resizeMode="cover"
        />
      </View>
      {outerRingColor ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size + 6,
            height: size + 6,
            borderRadius: (size + 6) / 2,
            borderWidth: 2,
            borderColor: outerRingColor,
          }}
        />
      ) : null}
    </View>
  );
}
