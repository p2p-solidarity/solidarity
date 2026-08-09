import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';
import { advanceDeveloperUnlock } from '../../src/settings/developerUnlock';

describe('developer unlock', () => {
  it('stays silent for the first two taps, counts down on taps three and four, then enables', () => {
    expect(advanceDeveloperUnlock(0, false)).toEqual({
      nextTapCount: 1,
      effect: { kind: 'none' },
    });
    expect(advanceDeveloperUnlock(1, false)).toEqual({
      nextTapCount: 2,
      effect: { kind: 'none' },
    });
    expect(advanceDeveloperUnlock(2, false)).toEqual({
      nextTapCount: 3,
      effect: { kind: 'countdown', remaining: 2 },
    });
    expect(advanceDeveloperUnlock(3, false)).toEqual({
      nextTapCount: 4,
      effect: { kind: 'countdown', remaining: 1 },
    });
    expect(advanceDeveloperUnlock(4, false)).toEqual({
      nextTapCount: 0,
      effect: { kind: 'enabled' },
    });
  });

  it('is a no-op after developer mode is enabled', () => {
    expect(advanceDeveloperUnlock(4, true)).toEqual({
      nextTapCount: 4,
      effect: { kind: 'none' },
    });
  });

  it('uses natural singular and plural countdown copy', () => {
    const settingsSource = readFileSync(
      new URL('../../app/settings/index.tsx', import.meta.url),
      'utf8',
    );

    expect(en['settingsHub.devUnlock.remainingOne']).toBe('1 more tap to open Developer Options.');
    expect(en['settingsHub.devUnlock.remainingMany']).toBe(
      '{{count}} more taps to open Developer Options.',
    );
    expect(zhHant['settingsHub.devUnlock.remainingOne']).toBe('再點 1 次即可開啟開發者選項。');
    expect(zhHant['settingsHub.devUnlock.remainingMany']).toBe(
      '再點 {{count}} 次即可開啟開發者選項。',
    );
    expect(settingsSource).toContain("transition.effect.remaining === 1");
  });
});
