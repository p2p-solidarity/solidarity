/**
 * IssuerMetadataStore — TS port of the issuer-display surface fetched
 * during OID4VCI in `solidarity/Services/Identity/OIDCService+Helpers.swift`
 * and rendered by `solidarity/Views/IDViews/PersonalIdentityView.swift` +
 * `solidarity/Views/MeViews/CredentialDetailView.swift`.
 *
 * What it holds:
 *   - One `IssuerMetadata` per issuer DID/URL key
 *   - Logo bytes cached as base64 so we render offline without a fetch
 *   - lastRefreshedAt timestamps so `clearStale(maxAge)` can evict stragglers
 *
 * Wire format (OID4VCI Issuer Metadata):
 *   GET /.well-known/openid-credential-issuer →
 *     { display: [{ name, locale?, logo: { uri, alt_text } }] }
 *
 * Security:
 *   - HTTPS-only — http:// issuer URIs are rejected before any fetch
 *   - Logos capped at MAX_LOGO_BYTES; oversized payloads fall back to a
 *     placeholder so a hostile issuer can't blow up MMKV
 *   - Stored under encrypted MMKV (same AES-GCM blob format the rest of
 *     the wallet uses)
 *
 * State-shape note: the slice this hook returns is a `Record<string, …>`
 * owned by the store. Per Rule 9 (memoize derived state), every selector
 * reads the raw slice — never `Object.values(...)` inline — so React's
 * `useSyncExternalStore` keeps an `Object.is`-stable reference.
 */
import { create } from 'zustand';

import { base64Encode } from '@solidarity/shared';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { ManifestStorage } from '@/storage/manifestStorage';
import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import {
  ISSUERS_MANIFEST_SCOPE,
  toIssuerManifest,
  type IssuerManifestEntry,
} from './issuerManifest';

const STORAGE_KEY = 'gg.solidarity.credentials.issuers.v1';
const MAX_LOGO_BYTES = 100 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
let localWipeGeneration = 0;

export interface IssuerMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly logoUri?: string;
  readonly logoBase64?: string;
  readonly logoMimeType?: string;
  readonly trustAnchor?: string;
  readonly lastRefreshedAt: Date;
}

interface SerializedMetadata
  extends Omit<IssuerMetadata, 'lastRefreshedAt'> {
  readonly lastRefreshedAt: string;
}

interface PersistedShape {
  readonly entries: Readonly<Record<string, SerializedMetadata>>;
}

interface RawDisplay {
  readonly name?: string;
  readonly description?: string;
  readonly logo?: { readonly uri?: string; readonly url?: string; readonly alt_text?: string };
}

interface RawIssuerMetadataPayload {
  readonly credential_issuer?: string;
  readonly display?: readonly RawDisplay[];
}

function isHttpsUrl(uri: string): boolean {
  return /^https:\/\//iu.test(uri);
}

function normalizeId(id: string): string {
  return id.trim();
}

function serialize(m: IssuerMetadata): SerializedMetadata {
  return { ...m, lastRefreshedAt: m.lastRefreshedAt.toISOString() };
}

function deserialize(s: SerializedMetadata): IssuerMetadata {
  return { ...s, lastRefreshedAt: new Date(s.lastRefreshedAt) };
}

interface IssuerMetadataState {
  /** Sidecar list for frame-1 paint. Mirrored from `entries` on writes. */
  readonly manifest: readonly IssuerManifestEntry[];
  readonly entries: Readonly<Record<string, IssuerMetadata>>;
  readonly hydrated: boolean;
  /** Re-read the manifest from MMKV. Sync; safe to call before hydrate. */
  readonly seedFromManifest: () => void;
  readonly hydrate: () => Promise<void>;
  readonly upsert: (m: IssuerMetadata) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly clearStale: (maxAgeMs: number, now?: Date) => Promise<readonly string[]>;
  /** Drop every live reference after the encrypted local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

function manifestFromEntries(
  entries: Readonly<Record<string, IssuerMetadata>>
): readonly IssuerManifestEntry[] {
  return Object.values(entries).map(toIssuerManifest);
}

async function persistEntries(
  entries: Readonly<Record<string, IssuerMetadata>>,
  generation = localWipeGeneration,
  writeEpoch: LocalDataEpoch = captureLocalDataEpoch(),
): Promise<void> {
  if (!canCommitLocalData(writeEpoch)) return;
  const persisted: PersistedShape = {
    entries: Object.fromEntries(
      Object.entries(entries).map(([k, v]) => [k, serialize(v)])
    ),
  };
  const encrypted = await encryptJson(persisted);
  if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
  getMmkv().set(STORAGE_KEY, encrypted);
  ManifestStorage.set(ISSUERS_MANIFEST_SCOPE, manifestFromEntries(entries));
}

export const useIssuerMetadataStore = create<IssuerMetadataState>((set, get) => ({
  manifest: [],
  entries: {},
  hydrated: false,

  seedFromManifest: () => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    const seed = ManifestStorage.get<IssuerManifestEntry>(
      ISSUERS_MANIFEST_SCOPE,
    );
    if (seed) set({ manifest: seed });
  },

  hydrate: async () => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    if (get().hydrated) return;
    const raw = getMmkv().getString(STORAGE_KEY);
    if (!raw) {
      if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
      set({ hydrated: true });
      return;
    }
    try {
      const decoded = await decryptJson<PersistedShape>(raw);
      if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
      const entries: Record<string, IssuerMetadata> = {};
      for (const [k, v] of Object.entries(decoded.entries)) {
        // Tolerant load: a single corrupt entry must not blank the whole
        // issuer cache.
        try {
          entries[k] = deserialize(v);
        } catch {
          // skip
        }
      }
      const manifest = manifestFromEntries(entries);
      ManifestStorage.set(ISSUERS_MANIFEST_SCOPE, manifest);
      set({ manifest, entries, hydrated: true });
    } catch {
      if (generation !== localWipeGeneration) return;
      // Corrupt blob (key rotated, tampered, schema bump) — wipe and start
      // clean. The metadata is purely a cache; nothing depends on
      // historical entries surviving a decrypt failure.
      getMmkv().remove(STORAGE_KEY);
      ManifestStorage.clear(ISSUERS_MANIFEST_SCOPE);
      set({ manifest: [], entries: {}, hydrated: true });
    }
  },

  upsert: async (m) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    const normalized: IssuerMetadata = { ...m, id: normalizeId(m.id) };
    const nextEntries = { ...get().entries, [normalized.id]: normalized };
    const nextManifest = manifestFromEntries(nextEntries);
    set({ manifest: nextManifest, entries: nextEntries });
    await persistEntries(nextEntries, generation, writeEpoch);
  },

  remove: async (id) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    const key = normalizeId(id);
    const current = get().entries;
    if (!(key in current)) return;
    const next: Record<string, IssuerMetadata> = {};
    for (const [k, v] of Object.entries(current)) {
      if (k !== key) next[k] = v;
    }
    const nextManifest = manifestFromEntries(next);
    set({ manifest: nextManifest, entries: next });
    await persistEntries(next, generation, writeEpoch);
  },

  clearStale: async (maxAgeMs, now = new Date()) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return [];
    const evicted: string[] = [];
    const current = get().entries;
    const next: Record<string, IssuerMetadata> = {};
    for (const [k, v] of Object.entries(current)) {
      if (now.getTime() - v.lastRefreshedAt.getTime() > maxAgeMs) {
        evicted.push(k);
      } else {
        next[k] = v;
      }
    }
    if (evicted.length === 0) return [];
    const nextManifest = manifestFromEntries(next);
    set({ manifest: nextManifest, entries: next });
    await persistEntries(next, generation, writeEpoch);
    return evicted;
  },

  resetForLocalWipe: () => {
    localWipeGeneration += 1;
    set({ manifest: [], entries: {}, hydrated: true });
  },
}));

/** Sync selector: a single issuer (Object.is-stable slice). */
export function getIssuer(id: string): IssuerMetadata | undefined {
  return useIssuerMetadataStore.getState().entries[normalizeId(id)];
}

async function fetchLogoBytes(
  logoUri: string,
  fetchImpl: typeof fetch
): Promise<{ readonly base64: string; readonly mime: string } | undefined> {
  if (!isHttpsUrl(logoUri)) return undefined;
  const ac = new AbortController();
  const timer = setTimeout(() => { ac.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(logoUri, { signal: ac.signal });
    if (!resp.ok) return undefined;
    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_LOGO_BYTES) {
      return undefined;
    }
    const mime = resp.headers.get('content-type') ?? 'image/png';
    return { base64: base64Encode(new Uint8Array(buf)), mime };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function pickPreferredDisplay(
  display: readonly RawDisplay[]
): RawDisplay | undefined {
  return display.find((d) => typeof d.name === 'string' && d.name.length > 0)
    ?? display[0];
}

export interface FetchAndCacheOpts {
  readonly fetchImpl?: typeof fetch;
}

async function fetchIssuerDisplay(
  metadataUrl: string,
  fetchImpl: typeof fetch
): Promise<RawDisplay | undefined> {
  try {
    const resp = await fetchImpl(metadataUrl);
    if (!resp.ok) return undefined;
    const json = (await resp.json()) as RawIssuerMetadataPayload;
    if (!Array.isArray(json.display) || json.display.length === 0) {
      return undefined;
    }
    return pickPreferredDisplay(json.display);
  } catch {
    return undefined;
  }
}

interface LogoFields {
  readonly logoUri?: string;
  readonly logoBase64?: string;
  readonly logoMimeType?: string;
}

async function resolveLogoFields(
  display: RawDisplay | undefined,
  fetchImpl: typeof fetch
): Promise<LogoFields> {
  const candidate = display?.logo?.uri ?? display?.logo?.url;
  if (!candidate || !isHttpsUrl(candidate)) return {};
  const bytes = await fetchLogoBytes(candidate, fetchImpl);
  if (!bytes) return { logoUri: candidate };
  return {
    logoUri: candidate,
    logoBase64: bytes.base64,
    logoMimeType: bytes.mime,
  };
}

function deriveDisplayName(
  display: RawDisplay | undefined,
  issuerUrl: string
): string {
  const name = display?.name?.trim();
  if (name && name.length > 0) return name;
  return new URL(issuerUrl).hostname;
}

/**
 * GET /.well-known/openid-credential-issuer, parse the display block, fetch
 * the logo bytes, cache the result. Returns the persisted metadata, or
 * `undefined` if the issuer URL doesn't match HTTPS / the network fails.
 */
export async function fetchAndCacheIssuer(
  issuerUrl: string,
  opts: FetchAndCacheOpts = {}
): Promise<IssuerMetadata | undefined> {
  if (!isHttpsUrl(issuerUrl)) return undefined;
  const generation = localWipeGeneration;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const metadataUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-credential-issuer`;
  const display = await fetchIssuerDisplay(metadataUrl, fetchImpl);
  const description = display?.description?.trim();
  const logoFields = await resolveLogoFields(display, fetchImpl);
  if (generation !== localWipeGeneration) return undefined;

  const metadata: IssuerMetadata = {
    id: normalizeId(issuerUrl),
    displayName: deriveDisplayName(display, issuerUrl),
    ...(description ? { description } : {}),
    ...logoFields,
    lastRefreshedAt: new Date(),
  };

  await useIssuerMetadataStore.getState().upsert(metadata);
  return metadata;
}

/** Test-only — wipe in-memory state + persisted blob. */
export function __resetIssuerMetadataStoreForTesting(): void {
  useIssuerMetadataStore.setState({ manifest: [], entries: {}, hydrated: false });
  try {
    getMmkv().remove(STORAGE_KEY);
  } catch {
    // MMKV may not be initialised in pure parity tests; safe to ignore.
  }
  ManifestStorage.clear(ISSUERS_MANIFEST_SCOPE);
}

export const __ISSUER_METADATA_STORAGE_KEY = STORAGE_KEY;
export const __ISSUER_METADATA_MAX_LOGO_BYTES = MAX_LOGO_BYTES;

export type { IssuerManifestEntry } from './issuerManifest';
export { ISSUERS_MANIFEST_SCOPE } from './issuerManifest';
