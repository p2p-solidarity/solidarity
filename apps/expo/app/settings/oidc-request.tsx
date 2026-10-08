import { Redirect } from 'expo-router';

import { usePreferences } from '@/settings/preferences';

/** Compatibility route for the retired, non-submittable local request QR. */
export default function RetiredOidcRequestSettings(): React.JSX.Element {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings" />;

  return <Redirect href="/scan" />;
}
