import { Image, Pressable, View, type ImageSourcePropType } from 'react-native';

import { ANIMAL_CASES, animalDisplayName, animalSymbolFallback } from '@/cards/animals';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import type { Animal } from '@solidarity/shared';

const ANIMAL_PNG: Readonly<Partial<Record<Animal, ImageSourcePropType>>> = {
  horse: require('../../../assets/animals/horse-white.png') as ImageSourcePropType,
  pig: require('../../../assets/animals/pig-white.png') as ImageSourcePropType,
  sheep: require('../../../assets/animals/sheep-white.png') as ImageSourcePropType,
};

export interface AvatarSelectionGridProps {
  readonly selected: Animal | undefined;
  readonly onSelect: (a: Animal) => void;
}

export function AvatarSelectionGrid({ selected, onSelect }: AvatarSelectionGridProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 16,
      }}
    >
      {ANIMAL_CASES.map((animal) => (
        <AvatarCell
          key={animal}
          animal={animal}
          isSelected={animal === selected}
          onPress={() => {
            haptic('success');
            onSelect(animal);
          }}
        />
      ))}
    </View>
  );
}

function AvatarCell({
  animal,
  isSelected,
  onPress,
}: {
  readonly animal: Animal;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}) {
  const png = ANIMAL_PNG[animal];
  return (
    <View style={{ width: '33.3333%', alignItems: 'center' }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Pick ${animalDisplayName(animal)}`}
        style={{ alignItems: 'center', gap: 8 }}
      >
        <View
          style={{
            width: 88,
            height: 88,
            borderRadius: 44,
            backgroundColor: Colors.warmCream,
            borderWidth: 2,
            borderColor: isSelected ? Colors.accentRose : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {png ? (
            <Image source={png} style={{ width: 72, height: 72 }} resizeMode="contain" />
          ) : (
            <SfIcon name={animalSymbolFallback(animal)} size={48} color={Colors.text1} />
          )}
        </View>
        <ThemedText
          variant="caption"
          tone={isSelected ? 'primary' : 'secondary'}
          style={{ fontWeight: '500' }}
        >
          {animalDisplayName(animal)}
        </ThemedText>
      </Pressable>
    </View>
  );
}
