import { describe, expect, it } from 'bun:test';

import { shouldRequireNativeBiometricBinding } from '../../src/keychain/signingKeyPolicy';

describe('shouldRequireNativeBiometricBinding', () => {
  it('requires native biometric binding when biometric auth is available', () => {
    expect(shouldRequireNativeBiometricBinding(true)).toBe(true);
  });

  it('does not require native biometric binding when no biometric is enrolled', () => {
    expect(shouldRequireNativeBiometricBinding(false)).toBe(false);
  });
});
