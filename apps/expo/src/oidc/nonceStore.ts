/**
 * OIDC nonce store — port of solidarity/Services/Identity/OIDCNonceStore.swift.
 *
 * Two-layer cache:
 *   - In-memory map (hot path; survives within a process).
 *   - MMKV-persisted JSON blob under `oidc-nonce:<audience>` (survives kill).
 *
 * Behaviour mirrors the Swift implementation:
 *   - `issue(audience)` mints a random 32-byte base64url token, records its
 *     creation timestamp, and persists.
 *   - `consume(audience, nonce)` returns true exactly once per nonce — used
 *     by OID4VCI proof building and OID4VP response signing for replay
 *     suppression.
 *   - `cleanupExpired()` drops entries older than the TTL (Swift uses
 *     5 minutes = 300 s for proof JWTs; we keep the same default but also
 *     export the constant so the verifier reuses it).
 */
import { base64UrlEncode } from '@solidarity/shared';

import { getMmkv } from '@/storage/mmkv';

const KEY_PREFIX = 'oidc-nonce:';

/** Default time-to-live: 5 minutes, matching Swift `proofLifetime`. */
export const DEFAULT_NONCE_TTL_MS = 300_000;

interface NonceRecord {
  readonly nonce: string;
  readonly issuedAt: number;
}

interface PersistedShape {
  readonly entries: readonly NonceRecord[];
}

function storageKey(audience: string): string {
  return `${KEY_PREFIX}${audience}`;
}

function readPersisted(audience: string): NonceRecord[] {
  try {
    const raw = getMmkv().getString(storageKey(audience));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedShape> | null;
    const entries = parsed?.entries;
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (e): e is NonceRecord =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.nonce === 'string' &&
        typeof e.issuedAt === 'number'
    );
  } catch {
    return [];
  }
}

function writePersisted(audience: string, entries: readonly NonceRecord[]): void {
  try {
    if (entries.length === 0) {
      getMmkv().remove(storageKey(audience));
      return;
    }
    getMmkv().set(storageKey(audience), JSON.stringify({ entries }));
  } catch {
    // Persistence is best-effort — the in-memory layer still gates replay.
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export interface OIDCNonceStore {
  readonly issue: (audience: string) => string;
  readonly consume: (audience: string, nonce: string) => boolean;
  readonly cleanupExpired: () => void;
}

class OIDCNonceStoreImpl implements OIDCNonceStore {
  private readonly cache = new Map<string, NonceRecord[]>();

  constructor(private readonly ttlMs: number = DEFAULT_NONCE_TTL_MS) {}

  private hydrate(audience: string): NonceRecord[] {
    const cached = this.cache.get(audience);
    if (cached) return cached;
    const loaded = readPersisted(audience);
    this.cache.set(audience, loaded);
    return loaded;
  }

  private flush(audience: string, entries: NonceRecord[]): void {
    this.cache.set(audience, entries);
    writePersisted(audience, entries);
  }

  private trim(entries: NonceRecord[], now: number): NonceRecord[] {
    return entries.filter((e) => now - e.issuedAt < this.ttlMs);
  }

  issue(audience: string): string {
    const now = Date.now();
    const fresh = this.trim(this.hydrate(audience), now);
    const nonce = randomNonce();
    fresh.push({ nonce, issuedAt: now });
    this.flush(audience, fresh);
    return nonce;
  }

  consume(audience: string, nonce: string): boolean {
    if (!nonce) return false;
    const now = Date.now();
    const entries = this.trim(this.hydrate(audience), now);
    const idx = entries.findIndex((e) => e.nonce === nonce);
    if (idx === -1) {
      this.flush(audience, entries);
      return false;
    }
    entries.splice(idx, 1);
    this.flush(audience, entries);
    return true;
  }

  cleanupExpired(): void {
    const now = Date.now();
    for (const audience of Array.from(this.cache.keys())) {
      const entries = this.cache.get(audience) ?? [];
      this.flush(audience, this.trim(entries, now));
    }
  }
}

let sharedStore: OIDCNonceStore | null = null;

/** Process-wide singleton, mirroring Swift `OIDCNonceStore.shared`. */
export function getOIDCNonceStore(): OIDCNonceStore {
  if (!sharedStore) {
    sharedStore = new OIDCNonceStoreImpl();
  }
  return sharedStore;
}

/** Test-only — drop the shared instance and reset MMKV-backed entries. */
export function __resetOIDCNonceStoreForTesting(): void {
  sharedStore = null;
  try {
    const mmkv = getMmkv();
    for (const k of mmkv.getAllKeys()) {
      if (k.startsWith(KEY_PREFIX)) mmkv.remove(k);
    }
  } catch {
    // Tests may not have MMKV initialised — ignore.
  }
}
