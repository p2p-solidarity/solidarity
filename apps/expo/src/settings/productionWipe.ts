import * as FileSystem from 'expo-file-system/legacy';

import { signOutAtproto } from '@/atproto';
import {
  invalidateCachedAtprotoResult,
  invalidateCachedNostrResult,
} from '@/badges/badgeStatusCache';
import { useCardStore } from '@/cards/cardManager';
import { useReceivedCard } from '@/cards/receivedCard';
import { clearImageMemoryCache } from '@/components/common/imageProvider';
import { useLeaveCardStore } from '@/contacts/leaveCardInbox';
import { useRecentUpdatesStore } from '@/contacts/recentUpdates';
import { useContactStore } from '@/contacts/repository';
import { useIssuerMetadataStore } from '@/credentials/issuerStore';
import { useCredentialStore } from '@/credentials/store';
import { useGroupStore } from '@/groups/store';
import {
  deleteRootKeyForLocalWipe,
  quiesceRootKeyOperations,
  useIdentityCoordinator,
  useIdentityData,
  useIssuerTrustAnchorStore,
} from '@/identity';
import {
  deletePairwiseSeed,
  deleteSigningKey,
  quiescePairwiseSeedOperations,
  quiesceSigningKeyOperations,
  useSensitiveActionPolicy,
} from '@/keychain';
import {
  deleteNostrKey,
  quiesceNostrKeyOperations,
} from '@/nostr/userKey';
import { stopLaneManager } from '@/pear/laneManager';
import { preparePageDesign, usePageDesignStore } from '@/page/pageDesignStore';
import { useProfileSnapshotStore } from '@/people/profileSnapshots';
import { useProfileStore } from '@/profile/store';
import {
  deleteRecipientKeys,
  quiesceRecipientKeyOperations,
} from '@/sakura/recipientKeys';
import { stopForegroundPolling } from '@/sakura/inbox';
import { unregister } from '@/sakura/pushRegistration';
import { useSealedRouteStore } from '@/sakura/sealedRouteStore';
import { useVerifiedPageResult } from '@/scan/verifiedPageResult';
import { useSharingSettings } from '@/sharing/settingsStore';
import { useShoutoutStore } from '@/shoutouts/store';
import { clearAllData, getMmkv } from '@/storage';
import { deleteCacheDatabaseForLocalWipe } from '@/storage/cache';
import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from '@/storage/deletionResult';
import { rekeyEmptyMmkv } from '@/storage/mmkv';
import { deleteMasterKey } from '@/storage/secureMasterKey';
import {
  deleteRootSecret,
  quiesceRootSecretOperations,
} from '@/vault/secretsKeychain';
import { deleteVaultDirectory } from '@/vault/storage';
import { useVaultStore } from '@/vault/store';
import { useWebSignPending } from '@/websign/pendingRequest';
import { deleteIdentityForLocalWipe, useZkIdentity } from '@/zk';

import { usePreferences } from './preferences';
import { clearProductionAppData } from './productionAppData';
import { deleteProductionFiles } from './productionFiles';
import {
  beginLocalDataWipe,
  completeLocalDataWipe,
  quiesceLocalDataOperations,
} from './localDataWipeBarrier';
import {
  wipeEverything,
  type WipeEverythingResult,
} from './wipeEverything';

type ThrowingDeletion = () => void | Promise<void>;

async function captureDeletion(
  operation: ThrowingDeletion,
): Promise<LocalDeletionResult> {
  try {
    await operation();
    return deletionSucceeded();
  } catch {
    return deletionFailed();
  }
}

async function deleteAtprotoSession(): Promise<LocalDeletionResult> {
  try {
    const result = await signOutAtproto();
    return result.ok ? deletionSucceeded() : deletionFailed();
  } catch {
    return deletionFailed();
  }
}

/** Clear live references only; durable records are already gone at this point. */
function clearMemoryCaches(): void {
  useCardStore.getState().resetForLocalWipe();
  useContactStore.getState().resetForLocalWipe();
  useRecentUpdatesStore.getState().resetForLocalWipe();
  useLeaveCardStore.getState().resetForLocalWipe();
  useCredentialStore.getState().resetForLocalWipe();
  useIssuerMetadataStore.getState().resetForLocalWipe();
  useGroupStore.getState().resetForLocalWipe();
  useVaultStore.getState().resetForLocalWipe();
  useShoutoutStore.getState().resetForLocalWipe();
  useProfileStore.getState().resetForLocalWipe();
  useProfileSnapshotStore.getState().resetForLocalWipe();
  useIdentityData.getState().resetForLocalWipe();
  useIdentityCoordinator.getState().resetForLocalWipe();
  useIssuerTrustAnchorStore.getState().resetForLocalWipe();
  useSharingSettings.getState().resetForLocalWipe();
  useZkIdentity.getState().resetForLocalWipe();
  usePageDesignStore.getState().resetForLocalWipe();

  useReceivedCard.getState().dismiss();
  useVerifiedPageResult.getState().dismiss();
  useWebSignPending.getState().clear();
  useSealedRouteStore.getState().clear();
  clearImageMemoryCache();
  invalidateCachedNostrResult();
  invalidateCachedAtprotoResult();
}

function deleteProductionAppData(): Promise<LocalDeletionResult> {
  return clearProductionAppData({
    deleteFiles: () =>
      deleteProductionFiles({
        documentDirectory: FileSystem.documentDirectory,
        cacheDirectory: FileSystem.cacheDirectory,
        deletePath: (path) =>
          FileSystem.deleteAsync(path, { idempotent: true }),
        deleteVaultFiles: deleteVaultDirectory,
        deleteCacheDatabase: deleteCacheDatabaseForLocalWipe,
      }),
    clearPersistentData: clearAllData,
    clearMemoryCaches,
  });
}

async function quiesceBackgroundWork(): Promise<LocalDeletionResult> {
  beginLocalDataWipe();
  stopForegroundPolling();
  stopLaneManager();
  try {
    await Promise.all([
      unregister(),
      quiesceRecipientKeyOperations(),
      quiesceNostrKeyOperations(),
      quiesceRootKeyOperations(),
      quiesceSigningKeyOperations(),
      quiescePairwiseSeedOperations(),
      quiesceRootSecretOperations(),
      quiesceLocalDataOperations(),
    ]);
    return deletionSucceeded();
  } catch {
    return deletionFailed();
  }
}

function resetPreferencesAndPolicies(): void {
  usePreferences.getState().reset();
  useSensitiveActionPolicy.getState().resetForLocalWipe();
}

function scrubAndVerifyPersistentData(): LocalDeletionResult {
  try {
    clearAllData();
    return getMmkv().getAllKeys().length === 0
      ? deletionSucceeded()
      : deletionFailed();
  } catch {
    return deletionFailed();
  }
}

/**
 * Reset App Data (Settings → Reset Options): clears every durable MMKV record
 * and the in-memory store mirrors hydrated from them, then rehydrates the Page
 * store so it cannot stay stuck at `loading`. Keychain-backed recovery/signing
 * keys are deliberately preserved — that is what separates this from
 * `wipeLocalDevice`. Ordering mirrors the wipe path: durable records first,
 * memory second, so a racing store write-back cannot resurrect cleared data.
 */
export async function resetAppDataKeepingKeys(): Promise<void> {
  clearAllData();
  clearMemoryCaches();
  resetPreferencesAndPolicies();
  await preparePageDesign();
}

/** Assemble the real local stores behind the ordered wipe coordinator. */
export async function wipeLocalDevice(): Promise<WipeEverythingResult> {
  const result = await wipeEverything({
    quiesce: quiesceBackgroundWork,
    appData: deleteProductionAppData,
    preferences: () => captureDeletion(resetPreferencesAndPolicies),
    signingKey: deleteSigningKey,
    pairwiseSeed: deletePairwiseSeed,
    rootKey: deleteRootKeyForLocalWipe,
    finalPersistentData: scrubAndVerifyPersistentData,
    masterEncryptionKey: deleteMasterKey,
    freshEncryptionKey: () => captureDeletion(rekeyEmptyMmkv),
    vaultRootSecret: deleteRootSecret,
    recipientKeys: () => captureDeletion(deleteRecipientKeys),
    zkIdentity: deleteIdentityForLocalWipe,
    nostrKey: () => captureDeletion(deleteNostrKey),
    atprotoSession: deleteAtprotoSession,
  });
  if (result.kind === 'ok') {
    completeLocalDataWipe();
    // The Me tab may have tried (and correctly no-op'd) while the wipe barrier
    // was active. Rehydrate only after the fresh MMKV key is ready so its Page
    // store cannot remain stuck at `loading` or recreate pre-wipe data.
    await preparePageDesign();
  }
  return result;
}
