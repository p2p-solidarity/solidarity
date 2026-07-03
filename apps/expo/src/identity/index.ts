/**
 * Identity module — port of the Swift IdentityDataStore / VerifiedClaimIndex
 * / IdentityCoordinator trio. Consumers should import from this barrel
 * rather than reaching into individual files.
 */
export type {
  IdentityCardEntity,
  ProvableClaimEntity,
  TrustLevel,
} from './entities';
export { sourceCredentialId } from './entities';
export {
  displayClaims,
  useDisplayClaims,
  useHasClaim,
  useIdentityData,
} from './dataStore';
export {
  claimsForHolder,
  isFieldVerifiedForHolder,
  useVerifiedFields,
  verifiedFieldsForHolder,
  verifiedFieldsFromCredentials,
} from './verifiedClaimIndex';
export {
  __resetIdentityCoordinatorForTesting,
  useActiveDid,
  useIdentityCoordinator,
} from './coordinator';
export type { DIDDescriptor, UnifiedProfile } from './coordinator';
export {
  __resetIssuerTrustAnchorStoreForTesting,
  useIssuerTrustAnchorStore,
  useTrustAnchors,
  type TrustAnchor,
  type TrustAnchorSource,
} from './issuerTrustAnchor';
// NOTE: `__setRootKeyBiometricGateForTesting` / `__setRootKeyStorageForTesting`
// / `__setRootKeySyncStorageForTesting` are deliberately NOT re-exported
// here — they are test-only DI hooks and this barrel is the production
// import surface. `__tests__/unit/rootKey.test.ts` already imports them
// directly from `./rootKey`; keep it that way rather than shipping test
// seams through app code's import path.
export {
  createFromFreshMnemonic,
  deleteRootKey,
  deriveDidFromMnemonic,
  enableICloudBackup,
  getRootDid,
  getRootSigner,
  hasRootKey,
  importFromMnemonic,
  revealMnemonicForExport,
  type BiometricGate,
  type RootKeyError,
  type RootKeyStorage,
} from './rootKey';
