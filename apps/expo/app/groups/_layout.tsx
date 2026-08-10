import { Redirect, Slot } from 'expo-router';

import { usePreferences } from '@/settings/preferences';

/** Group protocol tooling stays unavailable until Developer Options is unlocked. */
export default function GroupsDeveloperLayout() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings/advanced" />;

  return <Slot />;
}
