/**
 * Avatar grid — pick AnimalCharacter. Mirrors Swift AvatarSelectionGrid.
 * Uses the real PNG glyphs from solidarity/Assets.xcassets/.
 */
import { Image, Pressable, View } from 'react-native';

import { ThemedSurface, ThemedText } from '@/components/themed';
import type { Animal } from '@solidarity/shared';

interface Option {
  readonly animal: Animal;
  readonly label: string;
  readonly source: number | null;
  readonly emojiFallback: string;
}

const HORSE = require('../../../assets/animals/horse-white.png') as number;
const PIG = require('../../../assets/animals/pig-white.png') as number;
const SHEEP = require('../../../assets/animals/sheep-white.png') as number;

const OPTIONS: readonly Option[] = [
  { animal: 'dog', label: 'Dog', source: null, emojiFallback: '🐕' },
  { animal: 'horse', label: 'Horse', source: HORSE, emojiFallback: '🐎' },
  { animal: 'pig', label: 'Pig', source: PIG, emojiFallback: '🐖' },
  { animal: 'sheep', label: 'Sheep', source: SHEEP, emojiFallback: '🐑' },
  { animal: 'dove', label: 'Dove', source: null, emojiFallback: '🕊️' },
];

export interface AvatarStepProps {
  readonly value: Animal | null;
  readonly onSelect: (animal: Animal) => void;
}

export function AvatarStep({ value, onSelect }: AvatarStepProps) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 12 }}>
      {OPTIONS.map((opt) => {
        const selected = opt.animal === value;
        return (
          <Pressable
            key={opt.animal}
            onPress={() => { onSelect(opt.animal); }}
            accessibilityRole="button"
            accessibilityLabel={`Pick ${opt.label}`}
            className="basis-[30%]"
          >
            <ThemedSurface
              variant={selected ? 'elevated' : 'outlined'}
              padded
              className={selected ? 'border-accentRose border-2' : ''}
            >
              <View className="items-center">
                {opt.source ? (
                  <Image source={opt.source} style={{ width: 56, height: 56 }} resizeMode="contain" />
                ) : (
                  <ThemedText variant="headlineLarge">{opt.emojiFallback}</ThemedText>
                )}
                <ThemedText variant="caption" tone="secondary" className="mt-1">
                  {opt.label}
                </ThemedText>
              </View>
            </ThemedSurface>
          </Pressable>
        );
      })}
    </View>
  );
}
