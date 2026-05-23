/**
 * Appearance settings — 1:1 port of
 * solidarity/Views/SettingsViews/AppearanceSettingsView.swift.
 *
 * Four sections:
 *   1. Color Mode (segmented control: System / Light / Dark)
 *   2. Card Accent (5-colour preset grid)
 *   3. Effects (Enable Glow toggle)
 *   4. Animal Theme (navigates to AnimalPicker, footer = personality)
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import {
  type AnimalCharacter,
  type AppColorScheme,
  usePreferences,
} from '@/settings/preferences';

const COLOR_MODE_OPTIONS: readonly { value: AppColorScheme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const CARD_ACCENT_PRESETS = [
  '#E091B3', // rose pink (primary CTA)
  '#0E73FF', // blue (primary button)
  '#4A66F0', // indigo
  '#A6678D', // dusty mauve
  '#D4BDE7', // lavender
] as const;

const ANIMAL_DISPLAY: Readonly<Record<AnimalCharacter, string>> = {
  dog: 'Dog',
  horse: 'Horse',
  pig: 'Pig',
  sheep: 'Sheep',
  dove: 'Dove',
};

const ANIMAL_PERSONALITY: Readonly<Record<AnimalCharacter, string>> = {
  dog: 'Loyal connector — warm intros, steady follow‑through.',
  horse: 'Driven achiever — fast pace, big energy, bold goals.',
  pig: 'Practical strategist — grounded, systematic, gets results.',
  sheep: 'Calm collaborator — inclusive, thoughtful, team‑first.',
  dove: 'Diplomatic storyteller — clear voice, builds trust quickly.',
};

const ANIMAL_CYCLE: readonly (AnimalCharacter | null)[] = [
  null,
  'dog',
  'horse',
  'pig',
  'sheep',
  'dove',
];

export default function AppearanceSettings() {
  const insets = useSafeAreaInsets();
  const colorScheme = usePreferences((s) => s.appColorScheme);
  const cardAccentHex = usePreferences((s) => s.cardAccentHex);
  const enableGlow = usePreferences((s) => s.enableGlow);
  const selectedAnimal = usePreferences((s) => s.selectedAnimal);
  const setPref = usePreferences((s) => s.set);

  const cycleAnimal = () => {
    const idx = ANIMAL_CYCLE.findIndex((a) => a === selectedAnimal);
    const next = ANIMAL_CYCLE[(idx + 1) % ANIMAL_CYCLE.length] ?? null;
    setPref('selectedAnimal', next);
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Appearance" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Color Mode */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title="Color Mode" />
            <View className="px-4">
              <View
                className="bg-mutedSurface rounded-xl flex-row"
                style={{ padding: 4 }}
              >
                {COLOR_MODE_OPTIONS.map((opt) => {
                  const active = colorScheme === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => { setPref('appColorScheme', opt.value); }}
                      accessibilityRole="button"
                      accessibilityLabel={opt.label}
                      className="flex-1 items-center rounded-lg active:opacity-80"
                      style={{
                        paddingVertical: 8,
                        backgroundColor: active ? Colors.cardBg : 'transparent',
                      }}
                    >
                      <Text
                        className="text-[13px]"
                        style={{
                          color: active ? Colors.text1 : Colors.text2,
                          fontWeight: active ? '600' : '400',
                        }}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Card Accent */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title="Card Accent" />
            <View className="px-4">
              <View
                className="bg-mutedSurface rounded-xl flex-row flex-wrap"
                style={{ padding: 14, gap: 12 }}
              >
                {CARD_ACCENT_PRESETS.map((hex) => {
                  const isSelected = hex.toLowerCase() === cardAccentHex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      onPress={() => { setPref('cardAccentHex', hex); }}
                      accessibilityRole="button"
                      accessibilityLabel={`Accent ${hex}`}
                      className="items-center justify-center rounded-full active:opacity-80"
                      style={{
                        width: 36,
                        height: 36,
                        backgroundColor: hex,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.2)',
                      }}
                    >
                      {isSelected ? (
                        <SfIcon name="checkmark" size={14} weight="bold" color={Colors.cardBg} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Effects */}
          <SettingsBlockSection title="Effects">
            <SettingsBlockToggleRow
              icon="sparkles"
              title="Enable Glow"
              value={enableGlow}
              onValueChange={(v) => { setPref('enableGlow', v); }}
            />
          </SettingsBlockSection>

          {/* Animal Theme — footer shows the selected animal's personality */}
          <SettingsBlockSection
            title="Animal Theme"
            footer={selectedAnimal ? ANIMAL_PERSONALITY[selectedAnimal] : undefined}
          >
            <SettingsBlockRow
              icon="pawprint"
              title="Animal"
              trailingText={selectedAnimal ? ANIMAL_DISPLAY[selectedAnimal] : 'None'}
              onPress={cycleAnimal}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
