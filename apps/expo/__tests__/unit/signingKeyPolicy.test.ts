import { describe, expect, it } from 'bun:test';

import { shouldRequireNativeBiometricBinding } from '../../src/keychain/signingKeyPolicy';

describe('shouldRequireNativeBiometricBinding', () => {
  it('never requests native auth binding — the JS gate is canonical (phase 4)', () => {
    // A per-use auth-bound key cannot sign on Android without a
    // CryptoObject BiometricPrompt (UserNotAuthenticatedException), and on
    // iOS a `.userPresence` ACL stacks a second OS prompt on top of the JS
    // gate. New keys are gated in JS only; `keyAuthMode` handles keys that
    // already carry a native ACL.
    expect(shouldRequireNativeBiometricBinding(true)).toBe(false);
    expect(shouldRequireNativeBiometricBinding(false)).toBe(false);
  });
});
