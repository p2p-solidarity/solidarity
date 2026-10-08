import {
  aesGcmOpen,
  aesGcmSeal,
  base64UrlDecode,
  base64UrlEncode,
  bytesToUtf8,
  deriveKey,
  sha256Bytes,
  utf8ToBytes,
} from './crypto';
import {
  deriveP256Scalar,
  HKDF_INFO_ROOT,
} from './derive';
import { nostrPublicKeyHex } from './nostr/event';
import { err, ok, type Result } from './types/result';

export const ROOT_VAULT_VERSION = 1 as const;
export const ROOT_VAULT_KEY_INFO = 'solidarity-root-vault-key-v1';
export const ROOT_VAULT_PRF_CONTEXT = 'solidarity-root-vault-prf-v1';

export interface RootVaultRecordV1 {
  readonly v: typeof ROOT_VAULT_VERSION;
  readonly ciphertext: string;
}

export interface OpenedRootVault {
  readonly mnemonic: string;
  /** Exact Nostr signing scalar when the app uses an imported nsec. */
  readonly nostrScalar?: Uint8Array;
}

export type RootVaultError =
  | { readonly kind: 'invalidCredential' }
  | { readonly kind: 'invalidPrfOutput' }
  | { readonly kind: 'invalidMnemonic' }
  | { readonly kind: 'invalidRecord' }
  | { readonly kind: 'decryptFailed' };

function validateMnemonic(mnemonic: string): boolean {
  try {
    const scalar = deriveP256Scalar(mnemonic, HKDF_INFO_ROOT);
    scalar.fill(0);
    return true;
  } catch {
    return false;
  }
}

function deriveVaultKey(
  credentialId: Uint8Array,
  prfOutput: Uint8Array
): Result<Uint8Array, RootVaultError> {
  if (credentialId.length === 0) return err({ kind: 'invalidCredential' });
  if (prfOutput.length !== 32) return err({ kind: 'invalidPrfOutput' });
  return ok(
    deriveKey(prfOutput, sha256Bytes(credentialId), ROOT_VAULT_KEY_INFO, 32)
  );
}

export function rootVaultPrfInput(): Uint8Array {
  return sha256Bytes(ROOT_VAULT_PRF_CONTEXT);
}

export function rootVaultLocator(credentialId: Uint8Array): string {
  if (credentialId.length === 0) {
    throw new RangeError('rootVaultLocator: credential ID must not be empty');
  }
  return base64UrlEncode(sha256Bytes(credentialId));
}

export function sealRootVault(
  mnemonic: string,
  credentialId: Uint8Array,
  prfOutput: Uint8Array,
  nonce?: Uint8Array,
  nostrScalar?: Uint8Array
): Result<RootVaultRecordV1, RootVaultError> {
  if (!validateMnemonic(mnemonic)) return err({ kind: 'invalidMnemonic' });
  if (nostrScalar !== undefined && !validateNostrScalar(nostrScalar)) {
    return err({ kind: 'invalidRecord' });
  }
  const keyResult = deriveVaultKey(credentialId, prfOutput);
  if (!keyResult.ok) return keyResult;

  const key = keyResult.value;
  try {
    const plaintext = utf8ToBytes(
      JSON.stringify({
        v: 1,
        mnemonic,
        ...(nostrScalar === undefined
          ? {}
          : { nostrKey: base64UrlEncode(nostrScalar) }),
      })
    );
    return ok({
      v: ROOT_VAULT_VERSION,
      ciphertext: base64UrlEncode(aesGcmSeal(key, plaintext, nonce)),
    });
  } finally {
    key.fill(0);
  }
}

export function openRootVault(
  record: unknown,
  credentialId: Uint8Array,
  prfOutput: Uint8Array
): Result<OpenedRootVault, RootVaultError> {
  if (!isRootVaultRecord(record)) return err({ kind: 'invalidRecord' });
  const keyResult = deriveVaultKey(credentialId, prfOutput);
  if (!keyResult.ok) return keyResult;

  const key = keyResult.value;
  try {
    const decoded = bytesToUtf8(
      aesGcmOpen(key, base64UrlDecode(record.ciphertext))
    );
    const payload: unknown = JSON.parse(decoded);
    if (!isRootVaultPayload(payload) || !validateMnemonic(payload.mnemonic)) {
      return err({ kind: 'invalidRecord' });
    }
    if (payload.nostrKey === undefined) {
      return ok({ mnemonic: payload.mnemonic });
    }
    const nostrScalar = base64UrlDecode(payload.nostrKey);
    if (!validateNostrScalar(nostrScalar)) {
      nostrScalar.fill(0);
      return err({ kind: 'invalidRecord' });
    }
    return ok({ mnemonic: payload.mnemonic, nostrScalar });
  } catch {
    return err({ kind: 'decryptFailed' });
  } finally {
    key.fill(0);
  }
}

function isRootVaultRecord(value: unknown): value is RootVaultRecordV1 {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record['v'] === ROOT_VAULT_VERSION &&
    typeof record['ciphertext'] === 'string' &&
    record['ciphertext'].length > 0
  );
}

function isRootVaultPayload(
  value: unknown
): value is {
  readonly v: 1;
  readonly mnemonic: string;
  readonly nostrKey?: string;
} {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  const hasNostrKey = Object.prototype.hasOwnProperty.call(payload, 'nostrKey');
  return (
    keys.length === (hasNostrKey ? 3 : 2) &&
    keys.every((key) => key === 'v' || key === 'mnemonic' || key === 'nostrKey') &&
    payload['v'] === ROOT_VAULT_VERSION &&
    typeof payload['mnemonic'] === 'string' &&
    (!hasNostrKey || typeof payload['nostrKey'] === 'string')
  );
}

function validateNostrScalar(value: Uint8Array): boolean {
  if (value.length !== 32) return false;
  try {
    nostrPublicKeyHex(value);
    return true;
  } catch {
    return false;
  }
}
