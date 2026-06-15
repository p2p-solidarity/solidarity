import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const APP_ROOT = join(import.meta.dir, '../../app');
const SRC_ROOT = join(import.meta.dir, '../../src');

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(path));
    } else if (/\.(ts|tsx)$/u.test(path)) {
      out.push(path);
    }
  }
  return out;
}

function readCatalog(locale: 'en' | 'zh-Hant'): Record<string, string> {
  const path = join(SRC_ROOT, `i18n/locales/${locale}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

function collectStaticTranslationKeys(): string[] {
  const keys = new Set<string>();
  const sourceFiles = [...collectSourceFiles(APP_ROOT), ...collectSourceFiles(SRC_ROOT)];
  const keyPattern = /\bt\(\s*(['"])([^'"`]+)\1/gu;
  const keyReferencePattern = /\b\w+Key:\s*(['"])([^'"`]+)\1/gu;
  const dottedLiteralPattern = /(['"])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)\1/gu;

  for (const path of sourceFiles) {
    const source = readFileSync(path, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = keyPattern.exec(source))) {
      keys.add(match[2]!);
    }
    while ((match = keyReferencePattern.exec(source))) {
      keys.add(match[2]!);
    }
    const i18nPrefixes = new Set([...keys].map((key) => key.split('.')[0]));
    if (source.includes('useTranslation') || /\bt\(/u.test(source)) {
      while ((match = dottedLiteralPattern.exec(source))) {
        const literal = match[2]!;
        if (i18nPrefixes.has(literal.split('.')[0]!)) {
          keys.add(literal);
        }
      }
    }
  }

  return [...keys].sort((a, b) => a.localeCompare(b));
}

describe('i18n catalogs', () => {
  it('cover every static t() key used by the Expo app', () => {
    const usedKeys = collectStaticTranslationKeys();
    const en = readCatalog('en');
    const zhHant = readCatalog('zh-Hant');

    expect(usedKeys.filter((key) => en[key] === undefined)).toEqual([]);
    expect(usedKeys.filter((key) => zhHant[key] === undefined)).toEqual([]);
  });

  it('keep en and zh-Hant catalogs in sync', () => {
    const enKeys = Object.keys(readCatalog('en')).sort((a, b) => a.localeCompare(b));
    const zhHantKeys = Object.keys(readCatalog('zh-Hant')).sort((a, b) => a.localeCompare(b));

    expect(zhHantKeys).toEqual(enKeys);
  });
});
