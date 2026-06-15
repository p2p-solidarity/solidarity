/**
 * scanLanguage — port of solidarity/Models/ScanLanguage.swift.
 *
 * Languages supported by the OCR scanner. The string values mirror the
 * Apple Vision language codes so a future native bridge can pass them
 * through verbatim (`zh-Hant`, `ja`, `en`).
 */
export type ScanLanguage = 'zh-Hant' | 'ja' | 'en';

export const SCAN_LANGUAGES: readonly ScanLanguage[] = [
  'zh-Hant',
  'ja',
  'en',
] as const;

export function scanLanguageDisplayName(lang: ScanLanguage): string {
  switch (lang) {
    case 'zh-Hant':
      return 'Traditional Chinese';
    case 'ja':
      return 'Japanese';
    case 'en':
      return 'English';
  }
}

export function scanLanguageFlag(lang: ScanLanguage): string {
  switch (lang) {
    case 'zh-Hant':
      return '\u{1F1F9}\u{1F1FC}'; // TW
    case 'ja':
      return '\u{1F1EF}\u{1F1F5}'; // JP
    case 'en':
      return '\u{1F1FA}\u{1F1F8}'; // US
  }
}
