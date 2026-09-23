import { getMmkv } from '@/storage/mmkv';
import { isPasskeyRow, type PasskeyRow, type RegistryError } from './passkeyRegistry';
import type { Result, RootVaultRecordV1 } from '@solidarity/shared';

export type RootVaultSyncState = 'unknown' | 'connected' | 'deferred';

const STORAGE_KEY = 'identity.rootVaultSync.v2';
const PENDING_KEY = 'identity.rootVaultSync.pending.v1';

interface StoredState {
  readonly v: 2;
  readonly status: 'connected' | 'deferred' | 'unknown';
  readonly binding?: string;
}

export interface PendingRootVaultUpload {
  readonly binding: string;
  readonly locator: string;
  readonly record: RootVaultRecordV1;
  readonly row?: PasskeyRow;
}

export function getRootVaultSyncState(binding?: string): RootVaultSyncState {
  try {
    const raw = getMmkv().getString(STORAGE_KEY);
    if (!raw) return 'unknown';
    const value = JSON.parse(raw) as StoredState;
    if (value.v !== 2) return 'unknown';
    if (value.status === 'deferred') return 'deferred';
    return value.status === 'connected' && binding !== undefined && value.binding === binding
      ? 'connected'
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function setRootVaultSyncState(state: 'deferred'): void;
export function setRootVaultSyncState(state: 'connected', binding: string): void;
export function setRootVaultSyncState(
  state: Exclude<RootVaultSyncState, 'unknown'>,
  binding?: string,
): void {
  try {
    if (state === 'connected' && !binding) return;
    const value: StoredState = {
      v: 2,
      status: state,
      ...(binding === undefined ? {} : { binding }),
    };
    getMmkv().set(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The flow result remains truthful for this run; a later Page visit can
    // offer the connection again if encrypted preference storage was absent.
  }
}

/** Keep the cheap hub binding current even when a new upload is pending. */
export function rememberRootVaultBinding(binding: string): void {
  const status = getRootVaultSyncState(binding);
  getMmkv().set(STORAGE_KEY, JSON.stringify({ v: 2, status, binding }));
}

export function readPendingRootVaultUpload(): Result<PendingRootVaultUpload | null, RegistryError> {
  try {
    const raw = getMmkv().getString(PENDING_KEY);
    if (raw === undefined) return { ok: true, value: null };
    const value = JSON.parse(raw) as PendingRootVaultUpload;
    if (
      !value || typeof value.binding !== 'string' ||
      typeof value.locator !== 'string' ||
      typeof value.record !== 'object' || value.record === null ||
      value.record.v !== 1 || typeof value.record.ciphertext !== 'string' ||
      (value.row !== undefined && (!isPasskeyRow(value.row) || value.row.binding !== value.binding || value.row.locator !== value.locator))
    ) return { ok: false, error: { kind: 'storageFailed' } };
    return { ok: true, value };
  } catch {
    return { ok: false, error: { kind: 'storageFailed' } };
  }
}

export function setPendingRootVaultUpload(value: PendingRootVaultUpload): void {
  getMmkv().set(PENDING_KEY, JSON.stringify(value));
}

export function clearPendingRootVaultUpload(): void {
  try {
    getMmkv().remove(PENDING_KEY);
  } catch {
    // A later attempt will retry the same idempotent upload.
  }
}
