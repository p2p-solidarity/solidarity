/**
 * Avatar grid — pick AnimalCharacter. Mirrors Swift AvatarSelectionGrid.
 */
import { Pressable, View } from 'react-native';

import { ThemedSurface, ThemedText } from '@/components/themed';
import type { Animal } from '@solidarity/shared';

const OPTIONS: readonly { animal: Animal; emoji: string; label: string }[] = [
  { animal: 'dog', emoji: '🐕', label: 'Dog' },
  { animal: 'horse', emoji: '🐎', label: 'Horse' },
  { animal: 'pig', emoji: '🐖', label: 'Pig' },
  { animal: 'sheep', emoji: '🐑', label: 'Sheep' },
  { animal: 'dove', emoji: '🕊️', label: 'Dove' },
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
                <ThemedText variant="headlineLarge">{opt.emoji}</ThemedText>
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
