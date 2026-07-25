/**
 * Solidarity QR — retired entry point (decision G2 step 1).
 *
 * The legacy business-card QR used to be built here AND in Share Settings,
 * independently. This copy cleared to a spinner on every rebuild and could
 * spin forever after a failed build. G2 deduped the legacy wire down to a
 * single canonical surface — `app/settings/share-settings.tsx` — which
 * debounces rebuilds, retains the previous QR while the next one signs, and
 * surfaces a real error + retry instead of an eternal spinner.
 *
 * This route now redirects to that canonical surface so deep links still
 * resolve, without duplicating the QR-build (and forever-spinner) logic.
 */
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

export default function SolidarityQrSettings(): ReactNode {
  return <Redirect href="/settings/share-settings" />;
}
