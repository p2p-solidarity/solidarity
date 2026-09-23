export {
  isBiometricAvailable,
  isBiometricGraceEnabled,
  requireBiometric,
  setBiometricGraceEnabled,
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
  quiesceSigningKeyOperations,
  resetSigningKeyForTesting,
  type SigningIdentity,
  type SigningKeyCandidate,
} from './signingKey';
export {
  pairwisePrivateKey,
  pairwisePublicJwk,
  deletePairwiseSeed,
  quiescePairwiseSeedOperations,
  resetPairwiseSeedForTesting,
} from './pairwiseKey';
export {
  BIOMETRIC_GATE_MODES,
  OPTIONAL_ACTIONS,
  RED_LINE_ACTIONS,
  SENSITIVE_ACTIONS,
  getSensitivePolicyFor,
  getSensitivePolicySnapshot,
  hydrateSensitiveActionPolicy,
  resetSensitiveActionPolicyForTesting,
  useSensitiveActionPolicy,
  type BiometricGateMode,
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
