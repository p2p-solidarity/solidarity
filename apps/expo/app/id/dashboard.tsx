import { Redirect } from 'expo-router';

/** Retired identity dashboard kept as a deep-link compatibility route. */
export default function IdentityDashboardCompatibilityRoute() {
  return <Redirect href="/id/zk-settings" />;
}
