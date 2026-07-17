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
  expandLinkPresetHandle,
  isHttpsLinkUrl,
  normalizeLinkUrl,
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
