/**
 * @solidarity/expo zk barrel — single import point for the ID screens.
 *
 * Mirrors the Swift `SemaphoreIdentityManager.shared` /
 * `SemaphoreGroupManager.shared` / `NullifierStore.shared` static
 * accessors so callers don't have to remember which file owns what.
 */
export {
  loadOrCreateIdentity,
  currentIdentity,
  deleteIdentity,
  deleteIdentityForLocalWipe,
  exportPrivateKey,
  importPrivateKey,
  identityFromSeed,
  SEMAPHORE_IDENTITY_KEYCHAIN_ALIAS,
  type IdentitySnapshot,
} from './identity';

export {
  canonicalCommitments,
  recomputeRoot,
  leafIndex,
  generateGroupProof,
  verifyGroupProof,
} from './groupManager';

export {
  hasNullifier,
  recordNullifier,
} from './nullifierStore';

export {
  useZkIdentity,
  useIdentitySnapshot,
  useZkIdentityCommitment,
  useProofsSupported,
  useIdentityState,
  __resetZkIdentityStoreForTesting,
  type IdentityHomeSnapshot,
  type ZkIdentityState,
} from './coordinator';

export {
  loadSemaphoreNative,
  __setSemaphoreNativeForTesting,
  __setSemaphoreNativeUnavailableForTesting,
} from './nativeBridge';

export {
  canonicalCommitments as canonicalCommitmentsRaw,
  clampToMax32Bytes,
  decimalStringToLittleEndian32,
  littleEndian32ToDecimalString,
} from './fieldEncoding';
