import { Redirect } from 'expo-router';

/** Group administration now has one local-data-backed canonical screen. */
export default function GroupIdentityCompatibilityRoute() {
  return <Redirect href="/settings/groups" />;
}
