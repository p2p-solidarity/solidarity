/**
 * Passkeys this phone created for the root-vault sync (owner option A: local
 * registry, no backend change). Public metadata only — credential ids are
 * public WebAuthn values, the locator is their sha256 — so nothing here unlocks
 * anything. The server keeps anonymous ciphertext rows, so this list can only
 * show keys added from this phone; it never pretends to know about others.
 */
import type { Result } from '@solidarity/shared';

import type * as MmkvModule from '@/storage/mmkv';

export interface PasskeyRow {
  readonly binding: string;
  readonly credentialId: string;
  readonly locator: string;
  readonly createdAt: string;
  readonly device: string;
  readonly platform: string;
  readonly attachment: 'platform' | 'cross-platform' | null;
  readonly aaguid: string | null;
  readonly status: 'pending' | 'synced';
}
/** Connected before rows existed: no device, no date — only the fact. */
export interface LegacyPasskeyRow {
  readonly binding: string;
  readonly legacy: true;
}
export type ListedPasskey = PasskeyRow | LegacyPasskeyRow;
export interface RegistryError {
  readonly kind: 'storageFailed';
}
export interface RegistryStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}
interface HiddenEntry {
  readonly binding: string;
  /** `null` hides the legacy row for that binding. */
  readonly credentialId: string | null;
}
interface RegistryData {
  readonly v: 1;
  readonly rows: readonly PasskeyRow[];
  readonly hidden: readonly HiddenEntry[];
}

const KEY = 'identity.passkeys.v1';
const SYNC_STATE_KEY = 'identity.rootVaultSync.v2';
const AAGUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const CREDENTIAL_ID_RE = /^[A-Za-z0-9_-]+$/;
const STRING_FIELDS = ['binding', 'credentialId', 'locator', 'createdAt', 'device', 'platform'] as const;

const failure = (): Result<never, RegistryError> => ({ ok: false, error: { kind: 'storageFailed' } });
const done: Result<void, RegistryError> = { ok: true, value: undefined };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPasskeyRow(value: unknown): value is PasskeyRow {
  if (!isRecord(value)) return false;
  const nonEmpty = STRING_FIELDS.every(key => typeof value[key] === 'string' && value[key] !== '');
  if (!nonEmpty) return false;
  const { createdAt, credentialId, status, attachment, aaguid } = value as Record<string, string | null>;
  return (
    Number.isFinite(Date.parse(createdAt ?? '')) &&
    CREDENTIAL_ID_RE.test(credentialId ?? '') &&
    (status === 'pending' || status === 'synced') &&
    (attachment === null || attachment === 'platform' || attachment === 'cross-platform') &&
    (aaguid === null || (typeof aaguid === 'string' && AAGUID_RE.test(aaguid)))
  );
}

function isHiddenEntry(value: unknown): value is HiddenEntry {
  return (
    isRecord(value) &&
    typeof value['binding'] === 'string' &&
    (value['credentialId'] === null || typeof value['credentialId'] === 'string')
  );
}

function parseRegistry(raw: string): RegistryData | null {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value['v'] !== 1) return null;
  const rows = value['rows'];
  const hidden = value['hidden'];
  if (!Array.isArray(rows) || !rows.every(isPasskeyRow)) return null;
  if (!Array.isArray(hidden) || !hidden.every(isHiddenEntry)) return null;
  return { v: 1, rows, hidden };
}

/** Hidden ids stay stored so a later "Add" still excludes them. */
export function createPasskeyRegistry(storage: RegistryStorage) {
  const read = (): Result<RegistryData, RegistryError> => {
    try {
      const raw = storage.getString(KEY);
      if (raw === undefined) return { ok: true, value: { v: 1, rows: [], hidden: [] } };
      const parsed = parseRegistry(raw);
      return parsed ? { ok: true, value: parsed } : failure();
    } catch {
      return failure();
    }
  };
  const write = (value: RegistryData): Result<void, RegistryError> => {
    try {
      storage.set(KEY, JSON.stringify(value));
      return done;
    } catch {
      return failure();
    }
  };
  return {
    list(binding: string, connected: boolean): Result<ListedPasskey[], RegistryError> {
      const data = read();
      if (!data.ok) return data;
      const rows = data.value.rows.filter(row => row.binding === binding);
      const hidden = data.value.hidden.filter(item => item.binding === binding);
      if (rows.length === 0 && connected && !hidden.some(item => item.credentialId === null)) {
        return { ok: true, value: [{ binding, legacy: true }] };
      }
      return {
        ok: true,
        value: rows.filter(row => !hidden.some(item => item.credentialId === row.credentialId)),
      };
    },
    excludeCredentialIds(binding: string): Result<string[], RegistryError> {
      const data = read();
      if (!data.ok) return data;
      const ids = data.value.rows.filter(row => row.binding === binding).map(row => row.credentialId);
      return { ok: true, value: [...new Set(ids)] };
    },
    save(row: PasskeyRow): Result<void, RegistryError> {
      if (!isPasskeyRow(row)) return failure();
      const data = read();
      if (!data.ok) return data;
      const rows = data.value.rows.filter(
        item => item.binding !== row.binding || item.credentialId !== row.credentialId,
      );
      return write({ ...data.value, rows: [...rows, row] });
    },
    hide(binding: string, credentialId: string | null): Result<void, RegistryError> {
      const data = read();
      if (!data.ok) return data;
      const already = data.value.hidden.some(
        item => item.binding === binding && item.credentialId === credentialId,
      );
      if (already) return done;
      return write({ ...data.value, hidden: [...data.value.hidden, { binding, credentialId }] });
    },
  };
}

export type PasskeyRegistry = ReturnType<typeof createPasskeyRegistry>;

/** Resolved lazily inside each guarded operation: a storage failure at startup
 *  surfaces as the registry's `storageFailed`, never a throw, and unit tests
 *  (plus the rootVaultSyncState ↔ registry import pair) never load the native
 *  MMKV / SecureStore modules at import time. */
function deviceStorage(): RegistryStorage {
  const { getMmkv } = require('@/storage/mmkv') as typeof MmkvModule;
  return getMmkv();
}

export function getPasskeyRegistry(): PasskeyRegistry {
  return createPasskeyRegistry({
    getString: key => deviceStorage().getString(key),
    set: (key, value) => {
      deviceStorage().set(key, value);
    },
  });
}

/** Cheap hub read: only the cached binding and public metadata, never the mnemonic. */
export function readPasskeyCount(storage?: RegistryStorage): Result<number, RegistryError> {
  try {
    const source = storage ?? deviceStorage();
    const registry = createPasskeyRegistry(source);
    const raw = source.getString(SYNC_STATE_KEY);
    if (raw === undefined) {
      const checked = registry.list('', false);
      return checked.ok ? { ok: true, value: 0 } : checked;
    }
    const state: unknown = JSON.parse(raw);
    if (!isRecord(state) || state['v'] !== 2) return failure();
    const status = state['status'];
    const binding = state['binding'];
    if (status !== 'connected' && status !== 'deferred' && status !== 'unknown') return failure();
    if (binding !== undefined && typeof binding !== 'string') return failure();
    if (status === 'connected' && !binding) return failure();
    const rows = registry.list(binding ?? '', status === 'connected');
    return rows.ok ? { ok: true, value: rows.value.length } : rows;
  } catch {
    return failure();
  }
}
