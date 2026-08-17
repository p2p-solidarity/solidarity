/**
 * Language selection — port of
 * solidarity/Views/Common/LanguageSelectionView.swift adapted as a
 * standalone settings sub-page.
 *
 * Lists the supported UI languages (the same catalogue the i18n bootstrap
 * ships in `src/i18n/locales/`) with a checkmark next to the active row.
 * Selecting a row:
 *   1. persists `language` to MMKV via `usePreferences`,
 *   2. calls `i18n.changeLanguage(code)` so the next `useTranslation()`
 *      render flips immediately.
 *
 * TODO: wire a SettingsBlockRow entry from the Settings hub once Wave 1's
 * settings/index.tsx is unfrozen — this route currently has no in-app
 * navigation surface beyond deep-link / direct push.
 */
import i18n from 'i18next';
import { safeBack } from '@/navigation/safeBack';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

interface LanguageOption {
  readonly code: string;
  readonly displayNameKey: string;
  readonly nativeName: string;
  readonly flag: string;
}

const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', displayNameKey: 'language.name.en', nativeName: 'English', flag: 'EN' },
  {
    code: 'zh-Hant',
    displayNameKey: 'language.name.zhHant',
    nativeName: '繁體中文',
    flag: 'ZH',
  },
];

export default function LanguageSettings(): ReactNode {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Fall back to the live i18n language when no explicit choice is stored yet
  // (language defaults to '' = follow device), so the active language still
  // shows a checkmark before the user makes a selection.
  const stored = usePreferences((s) => s.language);
  const current = stored || i18n.language;
  const set = usePreferences((s) => s.set);

  const onSelect = (code: string) => {
    haptic('selection');
    set('language', code);
    void i18n.changeLanguage(code);
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
      <SettingsScreenTitle title={t('language.title')} />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 32 + insets.bottom,
          gap: 24,
        }}
      >
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 8 }}>
          <SfIcon name="globe" size={42} color={Colors.primaryBlue} />
          <Text
            className="text-text1"
            style={{ fontSize: 20, fontWeight: '600' }}
          >
            {t('language.selectHeading')}
          </Text>
          <Text
            className="text-text2 text-center"
            style={{ fontSize: 14, paddingHorizontal: 16 }}
          >
            {t('language.selectSubtitle')}
          </Text>
        </View>

        <View style={{ gap: 12 }}>
          {LANGUAGES.map((lang) => (
            <LanguageRow
              key={lang.code}
              option={lang}
              displayName={t(lang.displayNameKey)}
              isSelected={current === lang.code}
              onPress={() => { onSelect(lang.code); }}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function LanguageRow({
  option,
  displayName,
  isSelected,
  onPress,
}: {
  readonly option: LanguageOption;
  readonly displayName: string;
  readonly isSelected: boolean;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={displayName}
      accessibilityState={{ selected: isSelected }}
      className="active:opacity-80"
    >
      <View
        className="flex-row items-center"
        style={{
          paddingHorizontal: 16,
          paddingVertical: 16,
          borderRadius: 14,
          borderWidth: 2,
          gap: 16,
          backgroundColor: isSelected ? `${Colors.primaryBlue}1F` : Colors.cardBg,
          borderColor: isSelected ? Colors.primaryBlue : 'transparent',
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: Colors.searchBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            className="text-text1"
            style={{ fontSize: 14, fontWeight: '700' }}
          >
            {option.flag}
          </Text>
        </View>

        <View style={{ flex: 1, gap: 4 }}>
          <Text
            className="text-text1"
            style={{ fontSize: 16, fontWeight: '600' }}
          >
            {displayName}
          </Text>
          <Text className="text-text2" style={{ fontSize: 13 }}>
            {option.nativeName}
          </Text>
        </View>

        {isSelected ? (
          <SfIcon
            name="checkmark.circle.fill"
            size={22}
            color={Colors.primaryBlue}
          />
        ) : null}
      </View>
    </Pressable>
  );
}
