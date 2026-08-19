import { Redirect } from 'expo-router';

/** Retired identity prototype; the ZK settings route is fully wired. */
export default function IdentityCompatibilityRoute() {
  return <Redirect href="/id/zk-settings" />;
}
