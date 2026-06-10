export {
  isBiometricAvailable,
  requireBiometric,
  type BiometricReason,
} from './biometric';
export {
  ensureSigningKey,
  publicJwk,
  publicRawP256ForCurrentIdentity,
  signJwt,
  signOpenAcDeviceBindingDigest,
  signRawEs256,
  didKeyForCurrentIdentity,
  resetSigningKeyForTesting,
  type SigningIdentity,
} from './signingKey';
export {
  pairwisePrivateKey,
  pairwisePublicJwk,
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
