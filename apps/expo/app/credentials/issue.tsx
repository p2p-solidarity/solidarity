import { Redirect, useLocalSearchParams } from 'expo-router';

import { usePreferences } from '@/settings/preferences';

/** Compatibility redirect for the retired duplicate group-issuance route. */
export default function LegacyGroupVCIssuanceRoute(): React.JSX.Element {
  const developerMode = usePreferences((state) => state.developerMode);
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  if (!developerMode) return <Redirect href="/settings" />;
  if (!groupId) return <Redirect href="/settings" />;

  return (
    <Redirect
      href={{
        pathname: '/groups/[id]/issue-vc',
        params: { id: groupId },
      }}
    />
  );
}
