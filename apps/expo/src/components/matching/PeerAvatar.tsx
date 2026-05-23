/**
 * PeerAvatar — circular avatar used by every matching component.
 * Mirrors Swift `ImageProvider.animalImage(for:)` placement: animal SF
 * symbol centred inside a searchBg circle with a 1pt status-colour ring.
 *
 * Assets TODO (parity with `cards/animals.ts` note): the Swift app ships
 * a PNG per animal. Until those assets land in Expo we draw the SF
 * symbol fallback so every peer still has a recognisable face.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { Animal } from '@solidarity/shared';

import { animalSymbolFallback } from '@/cards/animals';
import { SfIcon } from '@/components/icons/SfIcon';
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
  const iconSize = Math.round(size * 0.46);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.searchBg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: ringColor,
        }}
      >
        <SfIcon name={animalSymbolFallback(animal)} size={iconSize} color={Colors.text2} />
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
