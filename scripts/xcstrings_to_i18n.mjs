#!/usr/bin/env node
/**
 * Convert Swift Localizable.xcstrings → i18next-compatible JSON catalogues.
 *
 * Run:
 *   node scripts/xcstrings_to_i18n.mjs
 *
 * Inputs:
 *   solidarity/Localizable.xcstrings
 * Outputs:
 *   apps/expo/src/i18n/locales/en.json
 *   apps/expo/src/i18n/locales/zh-Hant.json
 *
 * xcstrings shape (Apple format):
 *   {
 *     "sourceLanguage": "en",
 *     "strings": {
 *       "Hello %@": {
 *         "extractionState": "manual",
 *         "localizations": {
 *           "en":     { "stringUnit": { "state": "translated", "value": "Hello %@" } },
 *           "zh-Hant":{ "stringUnit": { "state": "translated", "value": "你好 %@" } }
 *         }
 *       }
 *     }
 *   }
 *
 * Output JSON: flat { "<key>": "<value>" } per locale. The Swift `%@` /
 * `%d` placeholders are converted to i18next `{{0}}` interpolation tokens.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');

const SRC = resolve(repoRoot, 'solidarity/Localizable.xcstrings');
const OUT_DIR = resolve(repoRoot, 'apps/expo/src/i18n/locales');

const LOCALES = ['en', 'zh-Hant'];

function convertPlaceholders(value) {
  // Swift %@ / %d / %s → i18next {{0}}, {{1}}, …
  let counter = 0;
  return value.replace(/%(@|d|s|lld|f|.\d*[a-z])/gu, () => `{{${counter++}}}`);
}

function pick(localizations, locale) {
  const entry = localizations?.[locale];
  return entry?.stringUnit?.value ?? null;
}

function main() {
  const raw = JSON.parse(readFileSync(SRC, 'utf-8'));
  const strings = raw.strings ?? {};

  mkdirSync(OUT_DIR, { recursive: true });
  for (const locale of LOCALES) {
    const out = {};
    for (const [key, def] of Object.entries(strings)) {
      const value = pick(def.localizations, locale) ?? key;
      out[key] = convertPlaceholders(value);
    }
    const path = resolve(OUT_DIR, `${locale}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
    console.log(`✓ wrote ${path} (${Object.keys(out).length} keys)`);
  }
}

main();
