import { Redirect, Slot } from 'expo-router';

import { usePreferences } from '@/settings/preferences';

/** Identity internals stay unavailable until Developer Options is unlocked. */
export default function IdentityDeveloperLayout() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings" />;

  return <Slot />;
}
