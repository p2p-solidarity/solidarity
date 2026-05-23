/**
 * i18n bootstrap — i18next + expo-localization. Mirrors the Swift app's
 * Localizable.xcstrings (en + zh-Hant). Full strings JSON is generated
 * by `scripts/xcstrings_to_i18n.mjs`; this file ships the bootstrap
 * shell + a tiny placeholder catalogue so the rest of the app can
 * `useTranslation()` even before the converter runs.
 */
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zhHant from './locales/zh-Hant.json';

export async function installI18n(): Promise<void> {
  if (i18n.isInitialized) return;
  const locale = getLocales()[0]?.languageTag ?? 'en';
  const lng = locale.startsWith('zh') ? 'zh-Hant' : 'en';

  await i18n.use(initReactI18next).init({
    compatibilityJSON: 'v4',
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      'zh-Hant': { translation: zhHant },
    },
    interpolation: { escapeValue: false },
  });
}

export { useTranslation } from 'react-i18next';
