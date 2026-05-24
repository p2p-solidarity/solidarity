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
