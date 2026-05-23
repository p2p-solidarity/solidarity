/**
 * ThemedButton — variant + size table.
 * Per aniseekr Rule 9: "When changing components/themed/*, add or update
 * tests." We pin the variant → tone + textColor mapping so a future tweak
 * doesn't silently flip the foreground colour back to invisible white on
 * a light accent.
 */
import { describe, expect, it } from 'bun:test';

import { readableTextOn, ON_DARK, ON_LIGHT } from '../../src/components/themed/contrast';
import { Colors } from '../../src/constants/Colors';

describe('ThemedButton contrast policy', () => {
  it('primary variant gets white text on accentRose (≥ 3:1)', () => {
    expect(readableTextOn(Colors.accentRose)).toBe(ON_DARK);
  });

  it('primary variant gets dark text on a pale brand colour', () => {
    expect(readableTextOn(Colors.blobCenter)).toBe(ON_LIGHT);
  });

  it('destructive red passes the same contrast guard', () => {
    expect(readableTextOn(Colors.destructive)).toBe(ON_DARK);
  });
});

describe('Colors token table', () => {
  it('exposes every Swift Color.Theme name', () => {
    const required = [
      'pageBg',
      'cardBg',
      'searchBg',
      'divider',
      'text1',
      'text2',
      'text3',
      'accentRose',
      'primaryBlue',
      'destructive',
      'featureAccent',
      'dustyMauve',
      'blobCenter',
      'radarRing',
      'radarGlow',
    ] as const;
    for (const name of required) {
      expect(Colors[name]).toBeDefined();
    }
  });
});
