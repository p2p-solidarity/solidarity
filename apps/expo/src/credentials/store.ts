/**
 * Credentials store — mirrors Swift VCLibrary + IdentityCardEntity.
 *
 * Boot model (Path A — manifest + lazy details):
 *
 *   Frame 1   `manifest`  populated synchronously from MMKV via
 *             `seedFromManifest()` (called by root layout after
 *             `initMmkv()` resolves). Holds non-PII display fields only —
 *             id, title, trustLevel, type. Lets the VC list render row
 *             titles + trust chips without decrypting any JWT.
 *
 *   After     `details`   ReadonlyMap<id, StoredCredential> populated
 *             lazily. `loadDetail(id)` decrypts one record on demand;
 *             `hydrate()` bulk-decrypts every VC in the background.
 *             Screens that need rawJwt / issuerDid / holderDid /
 *             issuedAt / expiresAt / metadataTags read from
 *             `details.get(id)`.
 *
 *   Writes    `add(credential)` persists the encrypted record, updates
 *             the manifest, and warms the detail map in one atomic state
 *             update. `remove(id)` mirrors that across all three.
 *
 * Each `add(...)` fires a background refresh against
 * `/.well-known/openid-credential-issuer` via `issuerStore` so the issuer
 * logo + display name land in the cache without blocking the writer. Net
 * failures are swallowed — the IssuerBadge falls back to a placeholder.
 *
 * The `hydrate()` call is idempotent so screens that mount before the
 * background bulk hydrate finishes can safely trigger it again — only
 * the first call actually does work.
 */
import { create } from 'zustand';

import { fetchAndCacheIssuer } from '@/credentials/issuerStore';
import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { ManifestStorage } from '@/storage/manifestStorage';
import { getMmkv } from '@/storage/mmkv';

import {
  CREDENTIALS_MANIFEST_SCOPE,
  toCredentialManifest,
  type CredentialManifestEntry,
} from './credentialManifest';

export type TrustLevel = 'L1' | 'L2' | 'L3' | 'L3+';

export interface StoredCredential {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly trustLevel: TrustLevel;
  readonly rawJwt: string;
  readonly issuedAt: Date;
  readonly expiresAt?: Date;
  readonly metadataTags: readonly string[];
}

const PREFIX = 'vc:';

interface SerializedStoredCredential
  extends Omit<StoredCredential, 'issuedAt' | 'expiresAt'> {
  readonly issuedAt: string;
  readonly expiresAt?: string;
}

function serialize(c: StoredCredential): SerializedStoredCredential {
  const { issuedAt, expiresAt, ...rest } = c;
  return {
    ...rest,
    issuedAt: issuedAt.toISOString(),
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  };
}

function deserialize(s: SerializedStoredCredential): StoredCredential {
  const { issuedAt, expiresAt, ...rest } = s;
  return {
    ...rest,
    issuedAt: new Date(issuedAt),
    ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
  };
}

async function setEncrypted(key: string, value: StoredCredential): Promise<void> {
  getMmkv().set(key, await encryptJson(serialize(value)));
}

async function getEncrypted(key: string): Promise<StoredCredential | null> {
  const raw = getMmkv().getString(key);
  if (!raw) return null;
  // The on-disk shape may be either the new serialised form (issuedAt as
  // ISO string) or the legacy shape where `Date` round-tripped through
  // JSON.stringify into an ISO string anyway. Both decode identically.
  const decoded = await decryptJson<SerializedStoredCredential>(raw);
  return deserialize(decoded);
}

interface CredentialStoreState {
  readonly manifest: readonly CredentialManifestEntry[];
  readonly details: ReadonlyMap<string, StoredCredential>;
  readonly detailsHydrated: boolean;
  /** Re-read the manifest from MMKV. Call once after `initMmkv()` resolves. */
  readonly seedFromManifest: () => void;
  /** Background bulk-decrypt of every credential. Idempotent. */
  readonly hydrate: () => Promise<void>;
  /** Lazy single-record decrypt for detail screens. */
  readonly loadDetail: (id: string) => Promise<StoredCredential | null>;
  readonly add: (v: StoredCredential) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

export const useCredentialStore = create<CredentialStoreState>((set, get) => ({
  manifest: [],
  details: new Map(),
  detailsHydrated: false,

  seedFromManifest: () => {
    const seed = ManifestStorage.get<CredentialManifestEntry>(
      CREDENTIALS_MANIFEST_SCOPE,
    );
    if (seed) set({ manifest: seed });
  },

  hydrate: async () => {
    if (get().detailsHydrated) return;
    const out: StoredCredential[] = [];
    for (const k of getMmkv().getAllKeys()) {
      if (!k.startsWith(PREFIX)) continue;
      try {
        const v = await getEncrypted(k);
        if (v) out.push(v);
      } catch {
        // Tolerant load: skip corrupt / schema-incompatible records. A
        // single bad blob must not blank the entire credential list.
      }
    }
    out.sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
    const details = new Map<string, StoredCredential>();
    for (const c of out) details.set(c.id, c);
    const manifest = out.map(toCredentialManifest);
    ManifestStorage.set(CREDENTIALS_MANIFEST_SCOPE, manifest);
    set({ manifest, details, detailsHydrated: true });
  },

  loadDetail: async (id) => {
    const cached = get().details.get(id);
    if (cached) return cached;
    let credential: StoredCredential | null;
    try {
      credential = await getEncrypted(`${PREFIX}${id}`);
    } catch {
      return null;
    }
    if (!credential) return null;
    set((s) => {
      const next = new Map(s.details);
      next.set(id, credential);
      return { details: next };
    });
    return credential;
  },

  add: async (v) => {
    await setEncrypted(`${PREFIX}${v.id}`, v);
    set((s) => {
      const entry = toCredentialManifest(v);
      const idx = s.manifest.findIndex((m) => m.id === entry.id);
      const nextManifest = idx >= 0
        ? s.manifest.map((m, i) => (i === idx ? entry : m))
        : [entry, ...s.manifest];
      ManifestStorage.set(CREDENTIALS_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.set(v.id, v);
      return { manifest: nextManifest, details: nextDetails };
    });
    // Fire-and-forget: warm the issuer metadata cache so the badge shows
    // the real logo on next render. We only attempt this when the issuer
    // looks like an HTTPS URL — did:* issuers don't expose /.well-known.
    if (/^https:\/\//iu.test(v.issuerDid)) {
      void fetchAndCacheIssuer(v.issuerDid).catch(() => undefined);
    }
  },

  remove: async (id) => {
    getMmkv().remove(`${PREFIX}${id}`);
    set((s) => {
      const nextManifest = s.manifest.filter((m) => m.id !== id);
      ManifestStorage.set(CREDENTIALS_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.delete(id);
      return { manifest: nextManifest, details: nextDetails };
    });
  },
}));

/**
 * Selector: look up a full credential by id. Returns the detail (post-
 * `loadDetail`/`hydrate`) when available, or `undefined` if the record
 * hasn't been decrypted yet. Pair with `loadDetail(id)` for detail
 * screens that need rawJwt / issuerDid / etc.
 */
export const useCredentialById = (
  id: string | undefined,
): StoredCredential | undefined =>
  useCredentialStore((s) => (id ? s.details.get(id) : undefined));

/**
 * Selector: manifest entry by id — frame-1 safe (no decrypt). Use this
 * when the row only needs id/title/trustLevel/type.
 */
export const useCredentialManifestById = (
  id: string | undefined,
): CredentialManifestEntry | undefined =>
  useCredentialStore((s) => (id ? s.manifest.find((m) => m.id === id) : undefined));

export type { CredentialManifestEntry } from './credentialManifest';
