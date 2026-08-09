export {
  isBiometricAvailable,
  requireBiometric,
  type BiometricReason,
} from './biometric';
export {
  ensureSigningKey,
  hasExistingSigningKey,
  listSyncableSigningKeys,
  publicJwk,
  publicRawP256ForCurrentIdentity,
  resolveSigningKeyConflict,
  signJwt,
  signOpenAcDeviceBindingDigest,
  signRawEs256,
  didKeyForCurrentIdentity,
  deleteSigningKey,
  resetSigningKeyForTesting,
  type SigningIdentity,
  type SigningKeyCandidate,
} from './signingKey';
export {
  pairwisePrivateKey,
  pairwisePublicJwk,
  deletePairwiseSeed,
  resetPairwiseSeedForTesting,
} from './pairwiseKey';
export {
  SENSITIVE_ACTIONS,
  getSensitivePolicyFor,
  getSensitivePolicySnapshot,
  hydrateSensitiveActionPolicy,
  resetSensitiveActionPolicyForTesting,
  useSensitiveActionPolicy,
  useSensitivePolicy,
  type BiometricMode,
  type SensitiveAction,
  type SensitiveActionEntry,
  type SensitiveActionPolicy,
} from './sensitiveActionPolicy';
export {
  requireSensitiveAction,
  requireSensitiveActionBoolean,
  type BiometricFailureReason,
  type BiometricResult,
  type BiometricSuccessMethod,
} from './biometricGatekeeper';
