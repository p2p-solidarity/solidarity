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
import { useTranslation } from '@/i18n';
import {
  type AnimalCharacter,
  type AppColorScheme,
  usePreferences,
} from '@/settings/preferences';

const COLOR_MODE_VALUES: readonly AppColorScheme[] = ['system', 'light', 'dark'];

const COLOR_MODE_LABEL_KEYS: Readonly<Record<AppColorScheme, string>> = {
  system: 'appearance.colorMode.system',
  light: 'appearance.colorMode.light',
  dark: 'appearance.colorMode.dark',
};

const CARD_ACCENT_PRESETS = [
  '#E091B3', // rose pink (primary CTA)
  '#0E73FF', // blue (primary button)
  '#4A66F0', // indigo
  '#A6678D', // dusty mauve
  '#D4BDE7', // lavender
] as const;

const ANIMAL_DISPLAY_KEYS: Readonly<Record<AnimalCharacter, string>> = {
  dog: 'appearance.animal.dog',
  horse: 'appearance.animal.horse',
  pig: 'appearance.animal.pig',
  sheep: 'appearance.animal.sheep',
  dove: 'appearance.animal.dove',
};

const ANIMAL_PERSONALITY_KEYS: Readonly<Record<AnimalCharacter, string>> = {
  dog: 'appearance.animalPersonality.dog',
  horse: 'appearance.animalPersonality.horse',
  pig: 'appearance.animalPersonality.pig',
  sheep: 'appearance.animalPersonality.sheep',
  dove: 'appearance.animalPersonality.dove',
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
  const { t } = useTranslation();
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
      <SettingsScreenTitle title={t('appearance.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Color Mode */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title={t('appearance.colorMode.header')} />
            <View className="px-4">
              <View
                className="bg-mutedSurface rounded-xl flex-row"
                style={{ padding: 4 }}
              >
                {COLOR_MODE_VALUES.map((value) => {
                  const active = colorScheme === value;
                  const label = t(COLOR_MODE_LABEL_KEYS[value]);
                  return (
                    <Pressable
                      key={value}
                      onPress={() => { setPref('appColorScheme', value); }}
                      accessibilityRole="button"
                      accessibilityLabel={label}
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
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Card Accent */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title={t('appearance.cardAccent')} />
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
                      accessibilityLabel={t('appearance.accentLabel', { hex })}
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
          <SettingsBlockSection title={t('appearance.effects')}>
            <SettingsBlockToggleRow
              icon="sparkles"
              title={t('appearance.enableGlow')}
              value={enableGlow}
              onValueChange={(v) => { setPref('enableGlow', v); }}
            />
          </SettingsBlockSection>

          {/* Animal Theme — footer shows the selected animal's personality */}
          <SettingsBlockSection
            title={t('appearance.animalTheme')}
            footer={selectedAnimal ? t(ANIMAL_PERSONALITY_KEYS[selectedAnimal]) : undefined}
          >
            <SettingsBlockRow
              icon="pawprint"
              title={t('appearance.animalRow')}
              trailingText={selectedAnimal ? t(ANIMAL_DISPLAY_KEYS[selectedAnimal]) : t('appearance.animalNone')}
              onPress={cycleAnimal}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}
