import { Redirect } from 'expo-router';

/** Legacy deep-link kept for compatibility with old Settings navigation. */
export default function SelectiveDisclosureCompatibilityRoute() {
  return <Redirect href="/settings/share-settings" />;
}
