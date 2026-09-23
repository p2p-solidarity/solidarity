import type { HybridObject } from 'react-native-nitro-modules';

export interface PasskeyPrfResult {
  /** Raw WebAuthn credential ID, base64url without padding. */
  readonly credentialId: string;
  /** 32-byte WebAuthn PRF `first` result, base64url without padding. */
  readonly prfOutput: string;
  /** Best-effort display metadata; never persist the attestation object. */
  readonly attachment?: string;
  readonly attestationObject?: string;
}

/** Native passkey creation with required user verification and PRF evaluation. */
export interface PasskeyPrf
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  isSupported(): boolean;
  createCredential(
    rpId: string,
    userName: string,
    userId: string,
    prfInput: string,
    excludeCredentialIds: string[],
  ): Promise<PasskeyPrfResult>;
}
