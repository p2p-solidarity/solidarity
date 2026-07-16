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

import { normalizeLinkUrl } from '../../src/profile/linkUrl';

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

  it('leaves an already-https/http URL unchanged (case-insensitive scheme)', () => {
    expect(normalizeLinkUrl('https://x.com')).toBe('https://x.com');
    expect(normalizeLinkUrl('http://x.com')).toBe('http://x.com');
    expect(normalizeLinkUrl('HTTP://x.com')).toBe('HTTP://x.com');
  });

  it('does NOT rewrite a non-http scheme into https — leaves it to fail validation', () => {
    // The security point: `ftp://x` must stay `ftp://x` (rejected by the
    // save schema), never become `https://ftp://x`.
    expect(normalizeLinkUrl('ftp://x')).toBe('ftp://x');
    expect(normalizeLinkUrl('javascript:alert(1)//')).toBe('javascript:alert(1)//');
  });
});
