import { signOutAtproto } from '@/atproto';
import {
  deleteRootKey,
  useIdentityCoordinator,
} from '@/identity';
import {
  deletePairwiseSeed,
  deleteSigningKey,
} from '@/keychain';
import { deleteNostrKey } from '@/nostr/userKey';
import { deleteRecipientKeys } from '@/sakura/recipientKeys';
import { clearAllData } from '@/storage';
import { rekeyEmptyMmkv } from '@/storage/mmkv';
import { deleteMasterKey } from '@/storage/secureMasterKey';
import { deleteRootSecret } from '@/vault/secretsKeychain';
import { deleteIdentity, useZkIdentity } from '@/zk';
import { usePreferences } from './preferences';

import {
  wipeEverything,
  type WipeEverythingResult,
} from './wipeEverything';

async function deleteAtprotoSession(): Promise<void> {
  const result = await signOutAtproto();
  if (!result.ok) throw new Error('AT Protocol session deletion was incomplete');
}

async function deleteSigningIdentity(): Promise<void> {
  await deleteSigningKey();
  useIdentityCoordinator.setState({
    profile: { activeDID: null },
    isLoading: false,
    lastError: null,
    hydrated: false,
  });
}

async function deleteZkIdentity(): Promise<void> {
  await deleteIdentity();
  useZkIdentity.setState({
    commitment: null,
    proofsSupported: false,
    isWorking: false,
    lastError: null,
    hydrated: false,
  });
}

function resetPreferences(): void {
  usePreferences.getState().reset();
}

/** Assemble the real local stores behind the ordered wipe coordinator. */
export function wipeLocalDevice(): Promise<WipeEverythingResult> {
  return wipeEverything({
    appData: clearAllData,
    preferences: resetPreferences,
    signingKey: deleteSigningIdentity,
    pairwiseSeed: deletePairwiseSeed,
    rootKey: deleteRootKey,
    masterEncryptionKey: deleteMasterKey,
    freshEncryptionKey: rekeyEmptyMmkv,
    vaultRootSecret: deleteRootSecret,
    recipientKeys: deleteRecipientKeys,
    zkIdentity: deleteZkIdentity,
    nostrKey: deleteNostrKey,
    atprotoSession: deleteAtprotoSession,
  });
}
