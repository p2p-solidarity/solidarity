/**
 * Contrast helper — pinned to specific hex inputs so we notice if the
 * algorithm drifts (the prior aniseekr-expo bug was an invisible white
 * label on a light accent; we don't reintroduce it).
 */
import { describe, expect, it } from 'bun:test';

import {
  ON_DARK,
  ON_LIGHT,
  readableTextOn,
} from '../../src/components/themed/contrast';

describe('readableTextOn', () => {
  it('returns white for the dark accent rose', () => {
    expect(readableTextOn('#D8466B')).toBe(ON_DARK);
  });

  it('returns dark text on a pale gold accent', () => {
    expect(readableTextOn('#F0D87B')).toBe(ON_LIGHT);
  });

  it('returns white on a navy background', () => {
    expect(readableTextOn('#1A2447')).toBe(ON_DARK);
  });

  it('returns dark text on a pure-white background', () => {
    expect(readableTextOn('#FFFFFF')).toBe(ON_LIGHT);
  });

  it('handles shorthand #RGB', () => {
    expect(readableTextOn('#000')).toBe(ON_DARK);
    expect(readableTextOn('#FFF')).toBe(ON_LIGHT);
  });

  it('falls back gracefully on unparseable input', () => {
    // Mid-grey-ish fallback path — should still return one of the two valid
    // colours rather than crashing.
    const r = readableTextOn('rgba(128,128,128,1)');
    expect([ON_DARK, ON_LIGHT]).toContain(r);
  });
});
