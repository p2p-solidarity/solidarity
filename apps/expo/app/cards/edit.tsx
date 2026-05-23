/**
 * Edit / Create business card — 1:1 port of
 * solidarity/Views/CardViews/BusinessCardFormView.swift.
 *
 * Adds an avatar block at the top (photo picker + AnimalSelectorGrid) so the
 * user can change their profile image and theme animal in-line. The Swift
 * screen keeps profileImage/animal read-only — this is the documented
 * Expo-side enhancement so editing avatar doesn't require a separate flow.
 *
 * Header: chevron.left + "Cancel" leading, centred title that flips between
 * "Edit Identity Card" and "Create Identity Card" — verbatim Swift copy.
 */
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
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

  // Local avatar state — the form section below owns the rest.
  const [profileImage, setProfileImage] = useState<string | undefined>(
    targetCard?.profileImage
  );
  const [animal, setAnimal] = useState<Animal | undefined>(targetCard?.animal);

  useEffect(() => {
    setProfileImage(targetCard?.profileImage);
    setAnimal(targetCard?.animal);
  }, [targetCard]);

  const handlePickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo access denied',
        'Enable Photos access in Settings to choose a profile picture.'
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset?.base64) {
      setProfileImage(asset.base64);
      haptic('selection');
    }
  }, []);

  const handleSave = useCallback(
    async (card: BusinessCard) => {
      const merged: BusinessCard = { ...card, profileImage, animal };
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
    [animal, isEditing, profileImage, upsert]
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
        contentContainerStyle={{ paddingVertical: 24, paddingBottom: 64 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 24 }}>
          <AvatarBlock
            profileImage={profileImage}
            animal={animal}
            onPickPhoto={() => {
              void handlePickPhoto();
            }}
            onClearPhoto={() => {
              setProfileImage(undefined);
            }}
            onChangeAnimal={setAnimal}
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

// MARK: - Avatar block (photo picker + AnimalSelectorGrid)

function AvatarBlock({
  profileImage,
  animal,
  onPickPhoto,
  onClearPhoto,
  onChangeAnimal,
}: {
  profileImage: string | undefined;
  animal: Animal | undefined;
  onPickPhoto: () => void;
  onClearPhoto: () => void;
  onChangeAnimal: (next: Animal) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text className="text-text1 text-[14px]" style={{ paddingHorizontal: 16 }}>
        Profile
      </Text>

      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: Colors.mutedSurface,
          }}
        >
          <Pressable
            onPress={onPickPhoto}
            accessibilityRole="button"
            accessibilityLabel="Choose profile photo"
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              overflow: 'hidden',
              backgroundColor: Colors.warmCream,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {profileImage ? (
              <Image
                source={{ uri: `data:image/jpeg;base64,${profileImage}` }}
                style={{ width: 56, height: 56 }}
                resizeMode="cover"
              />
            ) : (
              <SfIcon name="camera" size={20} color={Colors.text2} />
            )}
          </Pressable>

          <View style={{ flex: 1, gap: 4 }}>
            <Text className="text-text1 text-[15px]">Profile photo</Text>
            <Text className="text-text3 text-[12px]">
              {profileImage ? 'Tap photo to change' : 'Tap to choose from library'}
            </Text>
          </View>

          {profileImage ? (
            <Pressable
              onPress={onClearPhoto}
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              hitSlop={8}
              style={{ padding: 4 }}
            >
              <SfIcon name="xmark" size={14} color={Colors.text2} />
            </Pressable>
          ) : null}
        </View>

        <AnimalSelectorGrid
          selection={animal}
          onChange={(next) => {
            onChangeAnimal(next);
            haptic('selection');
          }}
        />
      </View>
    </View>
  );
}
