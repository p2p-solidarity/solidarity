/**
 * normalizeLinkUrl — Me › Edit's on-blur link normalization (1.3.3 A2.2 UX
 * pass). Pins the "forgiving but not misleading" contract: a scheme-less
 * host gets `https://`, but anything that already carries a scheme is left
 * verbatim so an invalid scheme still fails the save-time schema loudly
 * instead of being rewritten into a plausible-looking https URL.
 *
 * TS module under test: apps/expo/src/profile/linkUrl.ts
 */
import { describe, expect, it } from 'bun:test';

import {
  composeLinkUrl,
  displayLinkText,
  expandLinkPresetHandle,
  isHttpsLinkUrl,
  linkInputModelFor,
  normalizeLinkUrl,
  urlMatchesPreset,
} from '../../src/profile/linkUrl';

describe('normalizeLinkUrl', () => {
  it('returns empty string for blank / whitespace-only input', () => {
    expect(normalizeLinkUrl('')).toBe('');
    expect(normalizeLinkUrl('   ')).toBe('');
  });

  it('prefixes https:// to a scheme-less host', () => {
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com');
    expect(normalizeLinkUrl('example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('trims surrounding whitespace before prefixing', () => {
    expect(normalizeLinkUrl('  example.com  ')).toBe('https://example.com');
  });

  it('keeps https URLs and upgrades http URLs (case-insensitive scheme)', () => {
    expect(normalizeLinkUrl('https://x.com')).toBe('https://x.com');
    expect(normalizeLinkUrl('http://x.com')).toBe('https://x.com');
    expect(normalizeLinkUrl('HTTP://x.com/path')).toBe('https://x.com/path');
  });

  it('does NOT rewrite a non-http scheme into https — leaves it to fail validation', () => {
    // The security point: `ftp://x` must stay `ftp://x` (rejected by the
    // save schema), never become `https://ftp://x`.
    expect(normalizeLinkUrl('ftp://x')).toBe('ftp://x');
    expect(normalizeLinkUrl('javascript:alert(1)//')).toBe('javascript:alert(1)//');
  });
});

describe('isHttpsLinkUrl', () => {
  it('accepts only valid https URLs', () => {
    expect(isHttpsLinkUrl('https://kidney.dev')).toBe(true);
    expect(isHttpsLinkUrl('http://kidney.dev')).toBe(false);
    expect(isHttpsLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpsLinkUrl('https://')).toBe(false);
  });
});

describe('expandLinkPresetHandle', () => {
  it('expands bare handles for every templated preset', () => {
    expect(expandLinkPresetHandle('linkedin', 'kidney')).toBe(
      'https://linkedin.com/in/kidney'
    );
    expect(expandLinkPresetHandle('instagram', '@kidney')).toBe(
      'https://instagram.com/kidney'
    );
    expect(expandLinkPresetHandle('telegram', 'kidney')).toBe('https://t.me/kidney');
    expect(expandLinkPresetHandle('x', 'kidney')).toBe('https://x.com/kidney');
    expect(expandLinkPresetHandle('github', 'kidney')).toBe('https://github.com/kidney');
    expect(expandLinkPresetHandle('youtube', '@kidney')).toBe(
      'https://youtube.com/@kidney'
    );
  });

  it('leaves full URLs, dotted input, invalid handles, and Website unchanged', () => {
    expect(expandLinkPresetHandle('instagram', 'https://instagram.com/kidney')).toBe(
      'https://instagram.com/kidney'
    );
    expect(expandLinkPresetHandle('instagram', 'kidney.dev')).toBe('kidney.dev');
    expect(expandLinkPresetHandle('instagram', 'kidney/path')).toBe('kidney/path');
    expect(expandLinkPresetHandle('website', 'kidney')).toBe('kidney');
  });
});

describe('linkInputModelFor', () => {
  it('derives the in-field prefix from the platform URL builders', () => {
    expect(linkInputModelFor(null)).toEqual({ prefix: 'https://', handle: false });
    expect(linkInputModelFor('website')).toEqual({ prefix: 'https://', handle: false });
    expect(linkInputModelFor('instagram')).toEqual({ prefix: 'instagram.com/', handle: true });
    expect(linkInputModelFor('telegram')).toEqual({ prefix: 't.me/', handle: true });
    expect(linkInputModelFor('linkedin')).toEqual({ prefix: 'linkedin.com/in/', handle: true });
    expect(linkInputModelFor('youtube')).toEqual({ prefix: 'youtube.com/@', handle: true });
  });
});

describe('composeLinkUrl', () => {
  it('treats anything without a scheme as the handle under a platform preset', () => {
    expect(composeLinkUrl('instagram', '@kidney')).toBe('https://instagram.com/kidney');
    // Dots and underscores are legal in real handles — no bare-handle guard here.
    expect(composeLinkUrl('instagram', 'john.doe')).toBe('https://instagram.com/john.doe');
    expect(composeLinkUrl('telegram', 'kidney_tg')).toBe('https://t.me/kidney_tg');
  });

  it('lets a pasted full URL replace the prefix mode outright', () => {
    expect(composeLinkUrl('instagram', 'https://youtube.com/@kidney')).toBe(
      'https://youtube.com/@kidney'
    );
    expect(composeLinkUrl('telegram', 'http://t.me/kidney')).toBe('https://t.me/kidney');
  });

  it('prefixes https:// for the generic mode and returns empty for blank input', () => {
    expect(composeLinkUrl(null, 'example.com/a')).toBe('https://example.com/a');
    expect(composeLinkUrl(null, '')).toBe('');
    expect(composeLinkUrl('instagram', '@')).toBe('');
  });
});

describe('displayLinkText + urlMatchesPreset', () => {
  it('round-trips the composed URL back to the typed tail', () => {
    expect(displayLinkText('instagram', 'https://instagram.com/john.doe')).toBe('john.doe');
    expect(displayLinkText('telegram', 'https://t.me/kidney')).toBe('kidney');
    expect(displayLinkText(null, 'https://example.com/a')).toBe('example.com/a');
    expect(displayLinkText(null, '')).toBe('');
  });

  it('shows a legacy http tail under the generic https prefix', () => {
    expect(displayLinkText(null, 'http://old.example.com')).toBe('old.example.com');
  });

  it('flags a pasted URL that left the platform so the row can drop the preset', () => {
    expect(urlMatchesPreset('instagram', 'https://instagram.com/kidney')).toBe(true);
    expect(urlMatchesPreset('instagram', 'https://youtube.com/@kidney')).toBe(false);
    expect(urlMatchesPreset('instagram', '')).toBe(true);
    expect(urlMatchesPreset(null, 'https://anything.example')).toBe(true);
  });
});
