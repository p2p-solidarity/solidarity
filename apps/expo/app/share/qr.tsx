import { Redirect } from 'expo-router';

import { usePreferences } from '@/settings/preferences';

/**
 * Compatibility route for the retired local OID4VP request generator.
 * External HTTPS-backed verifier requests can still be scanned in Developer
 * Mode; this app cannot honestly host their direct-post callback itself.
 */
export default function RetiredOid4VpQrRoute(): React.JSX.Element {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/scan" />;

  return <Redirect href="/scan" />;
}
