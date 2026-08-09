export type PrimaryTabIcon =
  | 'person.crop.circle'
  | 'square.and.arrow.up'
  | 'person.2';

export const PRIMARY_TAB_HREFS = {
  page: '/(tabs)/me',
  present: '/(tabs)/verify',
} as const;

/**
 * v2 product order. The route names stay unchanged so existing deep links and
 * saved navigation state remain valid while the product-facing IA changes.
 */
export const PRIMARY_TABS = [
  {
    route: 'me/index',
    titleKey: 'tab.page',
    fallbackLabel: 'Page',
    icon: 'person.crop.circle',
  },
  {
    route: 'verify/index',
    titleKey: 'tab.present',
    fallbackLabel: 'Present',
    icon: 'square.and.arrow.up',
  },
  {
    route: 'people/index',
    titleKey: 'tab.contacts',
    fallbackLabel: 'Contacts',
    icon: 'person.2',
  },
] as const satisfies readonly {
  readonly route: string;
  readonly titleKey: string;
  readonly fallbackLabel: string;
  readonly icon: PrimaryTabIcon;
}[];

export function primaryTabForRoute(route: string) {
  return PRIMARY_TABS.find((tab) => tab.route === route);
}

export function destinationForOnboardingState(
  hasCompletedOnboarding: boolean,
): '/(tabs)/me' | '/onboarding' {
  return hasCompletedOnboarding ? PRIMARY_TAB_HREFS.page : '/onboarding';
}
