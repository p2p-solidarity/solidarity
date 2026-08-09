import { Redirect } from 'expo-router';

import { safeBack } from '@/navigation/safeBack';
import { VerificationToolsScreen } from '@/components/developer/VerificationToolsScreen';
import { usePreferences } from '@/settings/preferences';

export default function DeveloperVerificationRoute() {
  const developerMode = usePreferences((state) => state.developerMode);
  if (!developerMode) return <Redirect href="/settings/advanced" />;

  return (
    <VerificationToolsScreen
      onBack={() => { safeBack('/settings/developer'); }}
    />
  );
}
