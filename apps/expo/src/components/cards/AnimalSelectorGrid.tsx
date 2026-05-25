/**
 * AnimalSelectorGrid — 1:1 port of
 * solidarity/Views/CardViews/AnimalSelectorView.swift.
 *
 * Horizontal scroll row of `AnimalChip`s. Selected chip gets a stronger
 * border + searchBg fill. The 36×24 thumb shows the plain animal PNG
 * with cornerRadius(12) per Swift (`.scaledToFill .frame(36,24) .clipped
 * .cornerRadius(12)`).
 */
import { Image, Pressable, ScrollView, Text, View } from 'react-native';

import { ANIMAL_CASES, animalDisplayName, animalImageSource } from '@/cards/animals';
import { Colors } from '@/constants/Colors';
import { type Animal } from '@solidarity/shared';

export interface AnimalSelectorGridProps {
  readonly selection: Animal | undefined;
  readonly onChange: (animal: Animal) => void;
}

export function AnimalSelectorGrid({ selection, onChange }: AnimalSelectorGridProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
    >
      {ANIMAL_CASES.map((animal) => (
        <AnimalChip
          key={animal}
          animal={animal}
          isSelected={animal === selection}
          onPress={() => {
            onChange(animal);
          }}
        />
      ))}
    </ScrollView>
  );
}

interface AnimalChipProps {
  readonly animal: Animal;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}

function AnimalChip({ animal, isSelected, onPress }: AnimalChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: isSelected ? Colors.divider : `${Colors.divider}99`,
        backgroundColor: isSelected ? Colors.searchBg : `${Colors.searchBg}CC`,
      }}
    >
      <View
        style={{
          width: 36,
          height: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: isSelected ? Colors.divider : `${Colors.divider}99`,
          overflow: 'hidden',
        }}
      >
        <Image source={animalImageSource(animal)} style={{ width: 36, height: 24 }} resizeMode="cover" />
      </View>
      <Text className="text-text1 text-[12px] font-semibold">
        {animalDisplayName(animal)}
      </Text>
    </Pressable>
  );
}
