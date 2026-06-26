/**
 * AvatarSelectionGridStep — 1:1 port of Swift AvatarSelectionGrid.swift.
 *
 * Layout (top → bottom):
 *   1. Back chevron (rectangular outlined button, divider border)
 *   2. Title "Avatar" (28pt bold) + subtitle "Choose your beloved creature."
 *   3. Preview circle (150x150) — selected animal in a circle with a
 *      blue rectangle bounding box overlay; dashed empty-state circle
 *      with "?" when no selection.
 *   4. Horizontal scroll row of 60x60 circles (selected = blue ring).
 *   5. "About avatar" outlined info card.
 *   6. "This is the one, set me up" CTA (inverted, disabled until selection).
 *
 * Asset pipeline: all five animals ship as PNG under apps/expo/assets/animals/
 * (copied 1:1 from solidarity/Resources/). Matches Swift `ImageProvider`
 * which prefers `<basename>.png` from the bundle Resources before falling
 * back to SF Symbols.
 */
import { Image as ExpoImage } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ANIMAL_CASES, animalDisplayName, animalImageSource } from '@/cards/animals';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import type { Animal } from '@solidarity/shared';

export interface AvatarSelectionGridStepProps {
  readonly selection: Animal | null;
  readonly onSelect: (animal: Animal) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
}

export function AvatarSelectionGridStep({
  selection,
  onSelect,
  onBack,
  onNext,
}: AvatarSelectionGridStepProps) {
  const insets = useSafeAreaInsets();
  const handleNext = () => {
    if (!selection) return;
    haptic('success');
    onNext();
  };

  return (
    <View className="bg-pageBg flex-1" style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom }}>
      <View
        className="flex-row"
        style={{ paddingHorizontal: 24 }}
      >
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{
            padding: 12,
            borderWidth: 1,
            borderColor: Colors.divider,
          }}
        >
          <SfIcon name="chevron.left" size={17} color={Colors.text1} />
        </Pressable>
      </View>

      <View className="items-center" style={{ gap: 8, paddingTop: 24 }}>
        <ThemedText variant="headlineMedium">Avatar</ThemedText>
        <ThemedText variant="bodySmall" tone="secondary">
          Choose your beloved creature.
        </ThemedText>
      </View>

      <View className="items-center" style={{ paddingVertical: 32 }}>
        <AvatarPreview animal={selection} />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 24, paddingHorizontal: 24 }}
      >
        {ANIMAL_CASES.map((animal) => (
          <AvatarChip
            key={animal}
            animal={animal}
            isSelected={animal === selection}
            onPress={() => {
              haptic('selection');
              onSelect(animal);
            }}
          />
        ))}
      </ScrollView>

      <View
        style={{
          marginTop: 24,
          marginHorizontal: 24,
          padding: 16,
          borderWidth: 1,
          borderColor: Colors.divider,
          gap: 8,
        }}
      >
        <ThemedText variant="label">About avatar</ThemedText>
        <ThemedText variant="caption" tone="tertiary" style={{ lineHeight: 20 }}>
          {
            'This avatar will develop alongside your journey, based on the activity level you accumulate. As you progress, your avatar will evolve!\n\n!!! This can\'t be changed afterward, so please choose wisely. Also you can export it after the event.'
          }
        </ThemedText>
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ paddingHorizontal: 24, paddingBottom: 32 }}>
        <ThemedButton
          label="This is the one, set me up"
          variant="inverted"
          fullWidth
          disabled={selection === null}
          haptic={false}
          onPress={handleNext}
        />
      </View>
    </View>
  );
}

function AvatarPreview({ animal }: { animal: Animal | null }) {
  if (animal === null) {
    return (
      <View
        style={{
          width: 150,
          height: 150,
          borderRadius: 75,
          borderWidth: 1,
          borderColor: Colors.divider,
          borderStyle: 'dashed',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ThemedText variant="headlineLarge" tone="tertiary">
          ?
        </ThemedText>
      </View>
    );
  }
  // Swift: image .frame(150) .clipShape(Circle()) .overlay(Rectangle 160 stroke blue 2)
  // — no background fill; the rectangle stays square (corners are deliberate).
  return (
    <View style={{ width: 160, height: 160, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 150,
          height: 150,
          borderRadius: 75,
          overflow: 'hidden',
        }}
      >
        <ExpoImage
          source={animalImageSource(animal)}
          style={{ width: 150, height: 150 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`animal-${animal}-large`}
          transition={0}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 160,
          height: 160,
          borderWidth: 2,
          borderColor: Colors.primaryBlue,
        }}
      />
    </View>
  );
}

function AvatarChip({
  animal,
  isSelected,
  onPress,
}: {
  readonly animal: Animal;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}) {
  // Swift: image .frame(60) .clipShape(Circle()) .overlay(Circle stroke 2 — blue if selected)
  // → full 60pt image + ring overlay on top (NOT a border that shrinks the image).
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Pick ${animalDisplayName(animal)}`}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View style={{ width: 60, height: 60 }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, overflow: 'hidden' }}>
            <ExpoImage
              source={animalImageSource(animal)}
              style={{ width: 60, height: 60 }}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={`animal-${animal}-chip`}
              transition={0}
            />
          </View>
          {isSelected ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 60,
                height: 60,
                borderRadius: 30,
                borderWidth: 2,
                borderColor: Colors.primaryBlue,
              }}
            />
          ) : null}
        </View>
        <ThemedText
          variant="caption"
          tone={isSelected ? 'primary' : 'secondary'}
          style={{ fontWeight: '500' }}
        >
          {animalDisplayName(animal)}
        </ThemedText>
      </View>
    </Pressable>
  );
}
