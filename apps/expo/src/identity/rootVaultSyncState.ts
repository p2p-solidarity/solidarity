import { getMmkv } from '@/storage/mmkv';
import type { RootVaultRecordV1 } from '@solidarity/shared';

export type RootVaultSyncState = 'unknown' | 'connected' | 'deferred';

const STORAGE_KEY = 'identity.rootVaultSync.v2';
const PENDING_KEY = 'identity.rootVaultSync.pending.v1';

interface StoredState {
  readonly v: 2;
  readonly status: 'connected' | 'deferred';
  readonly binding?: string;
}

export interface PendingRootVaultUpload {
  readonly binding: string;
  readonly locator: string;
  readonly record: RootVaultRecordV1;
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

export function getPendingRootVaultUpload(): PendingRootVaultUpload | null {
  try {
    const raw = getMmkv().getString(PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingRootVaultUpload;
    if (
      typeof value.binding !== 'string' ||
      typeof value.locator !== 'string' ||
      typeof value.record !== 'object' ||
      value.record === null ||
      value.record.v !== 1 ||
      typeof value.record.ciphertext !== 'string'
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
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
