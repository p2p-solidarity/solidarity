import {
  base64UrlDecode,
  base64UrlEncode,
  deriveSecp256k1Scalar,
  HKDF_INFO_NOSTR,
  nostrPublicKeyHex,
  rootVaultLocator,
  rootVaultPrfInput,
  sealRootVault,
  sha256Bytes,
  utf8ToBytes,
  type Result,
  type RootVaultRecordV1,
} from '@solidarity/shared';

import { passkeyAaguid } from './passkeyAaguid';
import { getPasskeyRegistry, type PasskeyRow } from './passkeyRegistry';
import type { PendingRootVaultUpload } from './rootVaultSyncState';

export const ROOT_VAULT_RP_ID = 'creds.id';
export const ROOT_VAULT_ORIGIN = 'https://creds.id';

export interface PasskeyPrfCreateInput {
  readonly rpId: string;
  readonly userName: string;
  readonly userId: string;
  readonly prfInput: string;
  readonly excludeCredentialIds: string[];
}

export interface PasskeyPrfCreateResult {
  readonly credentialId: string;
  readonly prfOutput: string;
  readonly attachment?: string;
  readonly attestationObject?: string;
}

export interface PasskeyPrfClient {
  createCredential(
    input: PasskeyPrfCreateInput,
  ): Promise<PasskeyPrfCreateResult>;
}

export interface RootVaultUploadClient {
  put(
    locator: string,
    record: RootVaultRecordV1,
  ): Promise<Result<void, RootVaultSyncError>>;
}

export interface RootVaultPendingStore {
  set(locator: string, record: RootVaultRecordV1, row?: PasskeyRow): void;
  clear(): void;
}

export type RootVaultSyncError =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'noPrf' }
  | { readonly kind: 'invalidCredential' }
  | { readonly kind: 'invalidMnemonic' }
  | { readonly kind: 'alreadyConnected' }
  | { readonly kind: 'alreadyRegistered' }
  | { readonly kind: 'storageFailed' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'networkFailed' };

function classifyNativeError(error: unknown): RootVaultSyncError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('cancelled') || message.includes('canceled')) {
    return { kind: 'cancelled' };
  }
  if (message.includes('already_registered')) return { kind: 'alreadyRegistered' };
  if (message.includes('unsupported')) return { kind: 'unsupported' };
  if (message.includes('no_prf')) return { kind: 'noPrf' };
  return { kind: 'invalidCredential' };
}

export async function connectRootIdentityToPasskey(input: {
  readonly mnemonic: string;
  readonly userName: string;
  readonly passkey: PasskeyPrfClient;
  readonly upload: RootVaultUploadClient;
  readonly userId?: Uint8Array;
  readonly nostrScalar?: Uint8Array;
  readonly pending?: RootVaultPendingStore;
  readonly excludeCredentialIds?: string[];
  readonly registration?: {
    readonly binding: string;
    readonly device: string;
    readonly platform: string;
    readonly registry: ReturnType<typeof getPasskeyRegistry>;
  };
}): Promise<Result<void, RootVaultSyncError>> {
  let created: PasskeyPrfCreateResult;
  try {
    const userId = input.userId ?? crypto.getRandomValues(new Uint8Array(16));
    created = await input.passkey.createCredential({
      rpId: ROOT_VAULT_RP_ID,
      userName: input.userName,
      userId: base64UrlEncode(userId),
      prfInput: base64UrlEncode(rootVaultPrfInput()),
      excludeCredentialIds: input.excludeCredentialIds ?? [],
    });
  } catch (error) {
    return { ok: false, error: classifyNativeError(error) };
  }

  let credentialId: Uint8Array;
  let prfOutput: Uint8Array;
  try {
    credentialId = base64UrlDecode(created.credentialId);
    prfOutput = base64UrlDecode(created.prfOutput);
  } catch {
    return { ok: false, error: { kind: 'invalidCredential' } };
  }

  try {
    const locator = rootVaultLocator(credentialId);
    const row: PasskeyRow | undefined = input.registration ? {
      binding: input.registration.binding,
      credentialId: base64UrlEncode(credentialId), locator,
      createdAt: new Date().toISOString(),
      device: input.registration.device, platform: input.registration.platform,
      attachment: created.attachment === 'platform' || created.attachment === 'cross-platform' ? created.attachment : null,
      aaguid: passkeyAaguid(created.attestationObject), status: 'pending',
    } : undefined;
    if (row && input.registration) {
      const saved = input.registration.registry.save(row);
      if (!saved.ok) return saved;
    }
    const sealed = sealRootVault(
      input.mnemonic,
      credentialId,
      prfOutput,
      undefined,
      input.nostrScalar,
    );
    if (!sealed.ok) {
      if (sealed.error.kind === 'invalidMnemonic') {
        return { ok: false, error: { kind: 'invalidMnemonic' } };
      }
      if (sealed.error.kind === 'invalidPrfOutput') {
        return { ok: false, error: { kind: 'noPrf' } };
      }
      return { ok: false, error: { kind: 'invalidCredential' } };
    }
    try {
      input.pending?.set(locator, sealed.value, row);
    } catch {
      return { ok: false, error: { kind: 'storageFailed' } };
    }
    const uploaded = await input.upload.put(locator, sealed.value);
    if (uploaded.ok) {
      if (row && input.registration) {
        const saved = input.registration.registry.save({ ...row, status: 'synced' });
        if (!saved.ok) return saved;
      }
      input.pending?.clear();
    }
    return uploaded;
  } catch {
    return { ok: false, error: { kind: 'networkFailed' } };
  } finally {
    credentialId.fill(0);
    prfOutput.fill(0);
  }
}

async function nativePasskey(): Promise<PasskeyPrfClient> {
  const { getPasskeyPrf } = await import('@solidarity/nitro-keystone');
  const native = getPasskeyPrf();
  if (!native.isSupported()) {
    throw new Error('passkey_prf_unsupported');
  }
  return {
    createCredential: (input) =>
      native.createCredential(
        input.rpId,
        input.userName,
        input.userId,
        input.prfInput,
        input.excludeCredentialIds,
      ),
  };
}

export function createRootVaultUploadClient(
  origin = ROOT_VAULT_ORIGIN,
): RootVaultUploadClient {
  return {
    put: async (locator, record) => {
      let response: Response;
      try {
        response = await fetch(`${origin}/vault/root/${locator}`, {
          method: 'PUT',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(record),
        });
      } catch {
        return { ok: false, error: { kind: 'networkFailed' } };
      }
      if (response.status === 200 || response.status === 201) {
        return { ok: true, value: undefined };
      }
      if (response.status === 409) {
        return { ok: false, error: { kind: 'alreadyConnected' } };
      }
      return { ok: false, error: { kind: 'networkFailed' } };
    },
  };
}

let connecting = false;
export async function connectRootIdentityWithNativePasskey(input: {
  readonly mnemonic: string;
  readonly userName: string;
  readonly retryOnly?: boolean;
}): Promise<Result<string, RootVaultSyncError>> {
  if (connecting) return { ok: false, error: { kind: 'busy' } };
  connecting = true;
  try {
    return await connectNative(input);
  } catch {
    return { ok: false, error: { kind: 'invalidCredential' } };
  } finally {
    connecting = false;
  }
}

async function connectNative(input: {
  readonly retryOnly?: boolean;
  readonly mnemonic: string;
  readonly userName: string;
}): Promise<Result<string, RootVaultSyncError>> {
  const { deriveDidFromMnemonic } = await import('./rootKey');
  const rootDid = deriveDidFromMnemonic(input.mnemonic);
  if (!rootDid.ok) {
    return { ok: false, error: { kind: 'invalidMnemonic' } };
  }
  const { readNostrScalarForPasskeyConnection } = await import(
    '@/nostr/userKey'
  );
  const nostrScalar = await readNostrScalarForPasskeyConnection();
  if (!nostrScalar.ok) {
    return { ok: false, error: { kind: 'invalidCredential' } };
  }
  try {
    const fallbackScalar =
      nostrScalar.value === null
        ? deriveSecp256k1Scalar(input.mnemonic, HKDF_INFO_NOSTR)
        : null;
    const activeNostrScalar = nostrScalar.value ?? fallbackScalar;
    const binding = base64UrlEncode(
      sha256Bytes(
        utf8ToBytes(
          `${rootDid.value}\n${nostrPublicKeyHex(activeNostrScalar!)}`,
        ),
      ),
    );
    fallbackScalar?.fill(0);

    const upload = createRootVaultUploadClient();
    const state = await import('./rootVaultSyncState');
    const registry = getPasskeyRegistry();
    const excluded = registry.excludeCredentialIds(binding);
    if (!excluded.ok) return excluded;
    const pendingResult = state.readPendingRootVaultUpload();
    // An unreadable pending record can never be retried. Drop it rather than
    // refuse every future connect; a row it belonged to stays "pending" and
    // can be hidden from the list.
    if (!pendingResult.ok) state.clearPendingRootVaultUpload();
    const pending = pendingResult.ok ? pendingResult.value : null;
    if (pending !== null) {
      if (pending.binding !== binding) {
        state.clearPendingRootVaultUpload();
      } else {
        const retried = await retryPasskeyUpload(pending, upload, registry);
        if (!retried.ok) return retried;
        state.setRootVaultSyncState('connected', binding);
        state.clearPendingRootVaultUpload();
        return { ok: true, value: binding };
      }
    }

    if (input.retryOnly) return { ok: false, error: { kind: 'storageFailed' } };
    const { Platform } = await import('react-native');
    const device = Platform.OS === 'ios'
      ? (Platform.constants.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone')
      : Platform.OS === 'android' ? Platform.constants.Model : Platform.OS;
    let passkey: PasskeyPrfClient;
    try {
      passkey = await nativePasskey();
    } catch (error) {
      return { ok: false, error: classifyNativeError(error) };
    }
    const connected = await connectRootIdentityToPasskey({
      ...input,
      userId: sha256Bytes(utf8ToBytes(rootDid.value)),
      nostrScalar: nostrScalar.value ?? undefined,
      passkey,
      upload,
      excludeCredentialIds: excluded.value,
      registration: { binding, device, platform: Platform.OS, registry },
      pending: {
        set: (locator, record, row) => {
          state.setPendingRootVaultUpload({ binding, locator, record, row });
          state.rememberRootVaultBinding(binding);
        },
        clear: state.clearPendingRootVaultUpload,
      },
    });
    if (connected.ok) state.setRootVaultSyncState('connected', binding);
    return connected.ok ? { ok: true, value: binding } : connected;
  } finally {
    nostrScalar.value?.fill(0);
  }
}

export async function getStoredRootVaultIdentityBinding(): Promise<string | null> {
  const { readMnemonicForPasskeyConnection } = await import('./rootKey');
  const mnemonic = await readMnemonicForPasskeyConnection();
  if (!mnemonic.ok) return null;
  const { readNostrScalarForPasskeyConnection } = await import('@/nostr/userKey');
  const nostrScalar = await readNostrScalarForPasskeyConnection();
  if (!nostrScalar.ok) return null;
  try {
    const { deriveDidFromMnemonic } = await import('./rootKey');
    const rootDid = deriveDidFromMnemonic(mnemonic.value);
    if (!rootDid.ok) return null;
    const fallbackScalar =
      nostrScalar.value === null
        ? deriveSecp256k1Scalar(mnemonic.value, HKDF_INFO_NOSTR)
        : null;
    const activeNostrScalar = nostrScalar.value ?? fallbackScalar;
    const binding = base64UrlEncode(
      sha256Bytes(
        utf8ToBytes(
          `${rootDid.value}\n${nostrPublicKeyHex(activeNostrScalar!)}`,
        ),
      ),
    );
    fallbackScalar?.fill(0);
    return binding;
  } catch {
    return null;
  } finally {
    nostrScalar.value?.fill(0);
  }
}

export async function connectStoredRootIdentityWithNativePasskey(retryOnly = false): Promise<
  Result<string, RootVaultSyncError>
> {
  const { readMnemonicForPasskeyConnection } = await import('./rootKey');
  const mnemonic = await readMnemonicForPasskeyConnection();
  if (!mnemonic.ok) {
    return {
      ok: false,
      error:
        mnemonic.error.kind === 'invalidMnemonic'
          ? { kind: 'invalidMnemonic' }
          : { kind: 'invalidCredential' },
    };
  }
  return connectRootIdentityWithNativePasskey({
    mnemonic: mnemonic.value,
    userName: 'Solidarity',
    retryOnly,
  });
}


/** Retry the exact ciphertext; no credential creation or new sealing on this path. */
export async function retryPasskeyUpload(
  pending: PendingRootVaultUpload,
  upload: RootVaultUploadClient,
  registry: ReturnType<typeof getPasskeyRegistry>,
): Promise<Result<void, RootVaultSyncError>> {
  try {
    if (pending.row) {
      const saved = registry.save({ ...pending.row, status: 'pending' });
      if (!saved.ok) return saved;
    }
    const uploaded = await upload.put(pending.locator, pending.record);
    if (!uploaded.ok) return uploaded;
    return pending.row ? registry.save({ ...pending.row, status: 'synced' }) : uploaded;
  } catch {
    return { ok: false, error: { kind: 'networkFailed' } };
  }
}
