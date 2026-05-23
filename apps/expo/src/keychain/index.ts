export {
  isBiometricAvailable,
  requireBiometric,
  type BiometricReason,
} from './biometric';
export {
  ensureSigningKey,
  publicJwk,
  signJwt,
  didKeyForCurrentIdentity,
  resetSigningKeyForTesting,
  type SigningIdentity,
} from './signingKey';
export {
  pairwisePrivateKey,
  pairwisePublicJwk,
  resetPairwiseSeedForTesting,
} from './pairwiseKey';
