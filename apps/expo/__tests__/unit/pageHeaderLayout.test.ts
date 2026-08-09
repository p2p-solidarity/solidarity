import { describe, expect, it } from 'bun:test';

import { pageHeaderLayout } from '../../src/components/me/pageHeaderLayout';

describe('pageHeaderLayout', () => {
  it('keeps actions inline at normal phone widths and text scale', () => {
    expect(pageHeaderLayout(390, 1)).toBe('inline');
    expect(pageHeaderLayout(430, 1.1)).toBe('inline');
  });

  it('moves actions below at narrow widths', () => {
    expect(pageHeaderLayout(389, 1)).toBe('stacked');
    expect(pageHeaderLayout(320, 1)).toBe('stacked');
  });

  it('moves actions below when text is enlarged', () => {
    expect(pageHeaderLayout(430, 1.16)).toBe('stacked');
    expect(pageHeaderLayout(500, 2)).toBe('stacked');
  });
});
