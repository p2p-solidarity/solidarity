import { Redirect } from 'expo-router';

/**
 * Compatibility route for the retired disclosure prototype.
 *
 * The canonical sharing-settings screen persists the exact field switches
 * consumed by the QR builder. Keeping a second local-only privacy form made
 * controls appear saved while changing no outgoing payload.
 */
export default function PrivacySettings() {
  return <Redirect href="/settings/share-settings" />;
}
