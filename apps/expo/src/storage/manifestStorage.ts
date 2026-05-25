/**
 * Manifest storage — plaintext, sync, list-only sidecar to the encrypted
 * record store.
 *
 * Why: encrypted `loadAllXxx()` paths must decrypt N records on boot before
 * a screen can render anything. With ~100 contacts that is 100–300 ms of
 * AES + JSON.parse on the main JS thread, blowing the cold-launch budget.
 *
 * Each feature store keeps a tiny `ManifestEntry` per record holding ONLY
 * non-sensitive display fields (id, name, animal, kind, etc). The manifest
 * lives at `manifest:<scope>` in MMKV and is read synchronously on app
 * boot. Full record decryption happens lazily when the detail screen opens.
 *
 * Threat model: the manifest is encrypted at rest by MMKV's own AES-256
 * passphrase (same passphrase as the source-of-truth records, derived from
 * the master key). What "plaintext" means here is "no per-blob AES on the
 * render path" — the entries are stored as a single JSON string so the
 * render path pays one `getString` + one `JSON.parse` for the whole list,
 * not N `decryptJson` calls.
 *
 * Each store owns its own `ManifestEntry` type + a `toManifest(record)`
 * mapper. This module is type-agnostic so the same helper backs all 6
 * stores.
 */
import { getMmkv } from './mmkv';

const MANIFEST_PREFIX = 'manifest:';

/** Stable scope name per store, e.g. `'cards:v1'`, `'contacts:v1'`. */
export type ManifestScope = string;

function key(scope: ManifestScope): string {
  return `${MANIFEST_PREFIX}${scope}`;
}

export const ManifestStorage = {
  /**
   * Sync read of the whole manifest array. Returns `null` if MMKV is not
   * ready yet OR the manifest has never been written. Call inside
   * `useState(() => …)` or as a zustand initial-state seed.
   */
  get<T>(scope: ManifestScope): readonly T[] | null {
    try {
      const raw = getMmkv().getString(key(scope));
      if (!raw) return null;
      return JSON.parse(raw) as readonly T[];
    } catch {
      // MMKV not initialised, or the stored value is corrupt — either way
      // the caller should fall back to a background full-decrypt and
      // rebuild the manifest.
      return null;
    }
  },

  /** Write the whole manifest array in one shot. Sync. */
  set<T>(scope: ManifestScope, entries: readonly T[]): void {
    try {
      getMmkv().set(key(scope), JSON.stringify(entries));
    } catch {
      // Pre-init writes are dropped — boot path always sets after MMKV is
      // ready, and writes during onboarding happen after splash hides.
    }
  },

  /**
   * Upsert a single entry by `id`. Preserves original ordering for
   * existing entries; appends new entries to the end. Returns the next
   * array so callers can mirror it into their zustand state.
   */
  upsertById<T extends { readonly id: string }>(
    scope: ManifestScope,
    entry: T,
  ): readonly T[] {
    const current = this.get<T>(scope) ?? [];
    const idx = current.findIndex((e) => e.id === entry.id);
    const next = idx >= 0
      ? current.map((e, i) => (i === idx ? entry : e))
      : [...current, entry];
    this.set(scope, next);
    return next;
  },

  /** Remove a single entry by `id`. Returns the next array. */
  removeById<T extends { readonly id: string }>(
    scope: ManifestScope,
    id: string,
  ): readonly T[] {
    const current = this.get<T>(scope) ?? [];
    const next = current.filter((e) => e.id !== id);
    this.set(scope, next);
    return next;
  },

  /** True if a manifest has ever been written for this scope. */
  exists(scope: ManifestScope): boolean {
    try {
      return getMmkv().contains(key(scope));
    } catch {
      return false;
    }
  },

  /** Drop the whole manifest. Used by migration + clear-all-data. */
  clear(scope: ManifestScope): void {
    try {
      getMmkv().remove(key(scope));
    } catch {
      // ignore
    }
  },
};
