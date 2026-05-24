/**
 * Edit / Create business card — 1:1 port of
 * solidarity/Views/CardViews/BusinessCardFormView.swift.
 *
 * Keeps profileImage read-only (Swift parity — profile photos are sourced
 * from OCR / received-card flows, not the manual editor). Only the animal
 * theme is editable here, via AnimalSelectorGrid above the form.
 *
 * Header: chevron.left + "Cancel" leading, centred title that flips between
 * "Edit Identity Card" and "Create Identity Card" — verbatim Swift copy.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCardStore } from '@/cards/cardManager';
import { AnimalSelectorGrid, BusinessCardForm } from '@/components/cards';
import { SfIcon } from '@/components/icons/SfIcon';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { type Animal, type BusinessCard } from '@solidarity/shared';

const NEW_ID = '00000000-0000-0000-0000-000000000000';

export default function EditCardScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();

  const hydrate = useCardStore((s) => s.hydrate);
  const cards = useCardStore((s) => s.cards);
  const upsert = useCardStore((s) => s.upsert);
  const remove = useCardStore((s) => s.remove);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const targetCard = useMemo(
    () => (id && id !== NEW_ID ? cards.find((c) => c.id === id) : undefined),
    [cards, id]
  );
  const isEditing = targetCard !== undefined;

  const [animal, setAnimal] = useState<Animal | undefined>(targetCard?.animal);

  useEffect(() => {
    setAnimal(targetCard?.animal);
  }, [targetCard]);

  const handleSave = useCallback(
    async (card: BusinessCard) => {
      const merged: BusinessCard = { ...card, animal };
      const result = await upsert(merged);
      if (!result.ok) {
        Alert.alert('Error', result.error.message);
        haptic('error');
        return;
      }
      haptic('success');
      pushToast(isEditing ? 'Card saved' : 'Card created', 'success');
      router.back();
    },
    [animal, isEditing, upsert]
  );

  const handleDelete = useCallback(async () => {
    if (!targetCard) return;
    await remove(targetCard.id);
    haptic('warning');
    pushToast('Card deleted', 'info');
    router.back();
  }, [remove, targetCard]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Header
        title={isEditing ? 'Edit Identity Card' : 'Create Identity Card'}
        onCancel={() => {
          router.back();
        }}
      />

      <ScrollView
        contentContainerStyle={{
          paddingTop: 24,
          paddingBottom: insets.bottom + 48,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 24 }}>
          <AnimalBlock
            animal={animal}
            onChangeAnimal={(next) => {
              setAnimal(next);
              haptic('selection');
            }}
          />

          <BusinessCardForm
            initialCard={targetCard}
            onSave={handleSave}
            onDelete={isEditing ? handleDelete : undefined}
          />
        </View>
      </ScrollView>
    </View>
  );
}

// MARK: - Header (Swift SettingsBackToolbar parity)

function Header({ title, onCancel }: { title: string; onCancel: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        paddingHorizontal: 8,
      }}
    >
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel"
        hitSlop={8}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 8,
        }}
      >
        <SfIcon name="chevron.left" size={16} weight="semibold" color={Colors.text1} />
        <Text style={{ fontSize: 16, color: Colors.text1 }}>Cancel</Text>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 17, fontWeight: '600', color: Colors.text1 }}
        >
          {title}
        </Text>
      </View>
      {/* Trailing spacer to balance the leading button so the title centres. */}
      <View style={{ width: 80 }} />
    </View>
  );
}

// MARK: - Animal selector block

function AnimalBlock({
  animal,
  onChangeAnimal,
}: {
  animal: Animal | undefined;
  onChangeAnimal: (next: Animal) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text className="text-text1 text-[14px]" style={{ paddingHorizontal: 16 }}>
        Theme
      </Text>
      <View style={{ paddingHorizontal: 16 }}>
        <AnimalSelectorGrid selection={animal} onChange={onChangeAnimal} />
      </View>
    </View>
  );
}
