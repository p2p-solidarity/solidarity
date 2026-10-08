import { publishWithNostrAutoSetup } from '@/nostr/connectWizard';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { hasNostrKey, provisionFromRootMnemonic } from '@/nostr/userKey';
import { useProfileStore } from '@/profile/store';

import { publishPublicPageName, type PublicPageNamePublishResult } from './workflow';

/** Production adapter shared by onboarding and Settings. */
export async function publishChosenPageName(name: string): Promise<PublicPageNamePublishResult> {
  const profile = useProfileStore.getState();
  if (profile.record === null) {
    return { status: 'localOnly', name, reason: 'profile_publish_failed' };
  }
  return publishPublicPageName({
    name,
    did: profile.record.did,
    relays: DEFAULT_RELAYS,
    publishProfile: async () => await publishWithNostrAutoSetup({
      hasKey: hasNostrKey,
      provision: provisionFromRootMnemonic,
      publish: async () => await profile.publishToNostr(DEFAULT_RELAYS),
    }),
  });
}
