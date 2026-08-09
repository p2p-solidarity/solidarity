import { describe, expect, it } from 'bun:test';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';
import {
  destinationForOnboardingState,
  PRIMARY_TAB_HREFS,
  PRIMARY_TABS,
} from '../../src/navigation/primaryTabs';

describe('v2 primary navigation', () => {
  it('keeps the exact Page, Present, Contacts order on the existing routes', () => {
    expect(PRIMARY_TABS.map((tab) => tab.route)).toEqual([
      'me/index',
      'verify/index',
      'people/index',
    ]);
    expect(PRIMARY_TABS.map((tab) => tab.fallbackLabel)).toEqual([
      'Page',
      'Present',
      'Contacts',
    ]);
  });

  it('keeps the canonical zh-Hant labels and their English projection aligned', () => {
    expect(PRIMARY_TABS.map((tab) => zhHant[tab.titleKey])).toEqual([
      '頁面',
      '出示',
      '聯絡人',
    ]);
    expect(PRIMARY_TABS.map((tab) => en[tab.titleKey])).toEqual([
      'Page',
      'Present',
      'Contacts',
    ]);
  });

  it('sends a completed onboarding state to Page', () => {
    expect(PRIMARY_TAB_HREFS.page).toBe('/(tabs)/me');
    expect(destinationForOnboardingState(true)).toBe('/(tabs)/me');
    expect(destinationForOnboardingState(false)).toBe('/onboarding');
  });
});
