/**
 * atproto OAuth session storage (task A6.1). Two `expo-secure-store`
 * entries, own namespace (`gg.solidarity.atproto.*`, never shared with the
 * root did:key mnemonic alias, the Nostr scalar alias, or any other
 * module's storage):
 *
 *   - `SESSION_ALIAS` — the completed session: DID/handle/PDS/AS
 *     endpoints, access+refresh tokens, the session's DPoP keypair, and
 *     the access-token expiry. This is custody-sensitive (bearer-
 *     equivalent-if-stolen refresh token + the DPoP private key), so it's
 *     `WHEN_UNLOCKED_THIS_DEVICE_ONLY` — same ACL as `nostr/userKey.ts`'s
 *     scalar and `identity/rootKey.ts`'s mnemonic, no biometry gate (this
 *     module doesn't decide policy on when Face ID is required for atproto
 *     actions — that's a call-site decision, same rationale as
 *     userKey.ts's module doc).
 *   - `PENDING_FLOW_ALIAS` — the in-flight authorization attempt (state,
 *     PKCE verifier, the fresh DPoP keypair generated for this attempt,
 *     the resolved identity/discovery data). atproto's own OAuth spec
 *     calls this out explicitly: "the client usually needs to persist
 *     information about the session to some type of secure storage, so it
 *     can be read back after the redirect returns" — the interactive
 *     browser hop can outlive the JS context (Android especially), so this
 *     can't be in-memory module state. Cleared on success, failure, or the
 *     start of a new attempt (only one pending flow at a time).
 *
 * `AtprotoSession` (the type callers outside this module see, via
 * `oauth.ts`'s `getAtprotoSession()`) intentionally does NOT include the
 * refresh token or the raw DPoP private key — those stay behind this
 * module's storage functions. `oauth.ts`'s `refreshAtprotoSession()` reads
 * the full persisted record directly; nothing outside `src/atproto/` needs
 * the refresh token or private key material.
 */
import type * as SecureStoreNS from 'expo-secure-store';

import type { PublicKeyJWK } from '@solidarity/shared';

const SESSION_ALIAS = 'gg.solidarity.atproto.session.v1';
const PENDING_FLOW_ALIAS = 'gg.solidarity.atproto.pendingFlow.v1';

/** Public-safe view of a completed atproto OAuth session. Never includes the refresh token or DPoP private key. */
export interface AtprotoSession {
  readonly did: string;
  readonly handle: string;
  readonly pdsUrl: string;
  readonly authServerIssuer: string;
  readonly tokenEndpoint: string;
  readonly accessToken: string;
  readonly accessTokenExpiresAtMs: number;
  readonly scope: string;
}

/** Full persisted record — superset of `AtprotoSession` with the material `oauth.ts`'s internals need. */
export interface PersistedAtprotoSession extends AtprotoSession {
  readonly refreshToken: string;
  readonly dpopPrivateKeyHex: string;
  readonly dpopPublicJwk: PublicKeyJWK;
}

/** In-flight authorization attempt — see module doc. */
export interface PendingAtprotoFlow {
  readonly state: string;
  readonly codeVerifier: string;
  readonly handle: string;
  readonly expectedDid: string;
  readonly pdsUrl: string;
  readonly authServerIssuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly pushedAuthorizationRequestEndpoint: string;
  readonly redirectUri: string;
  readonly dpopPrivateKeyHex: string;
  readonly dpopPublicJwk: PublicKeyJWK;
  /** Most recent DPoP-Nonce seen from the Authorization Server during PAR, if any — reused as a hint for the token request. */
  readonly dpopNonce?: string;
}

/** Strip caller-internal-only fields from a persisted record for public return. */
export function toPublicSession(s: PersistedAtprotoSession): AtprotoSession {
  const { refreshToken: _refreshToken, dpopPrivateKeyHex: _dpopPrivateKeyHex, dpopPublicJwk: _dpopPublicJwk, ...pub } = s;
  return pub;
}

export interface AtprotoSessionStorage {
  readonly getSession: () => Promise<PersistedAtprotoSession | null>;
  readonly setSession: (session: PersistedAtprotoSession) => Promise<void>;
  readonly deleteSession: () => Promise<void>;
  readonly getPendingFlow: () => Promise<PendingAtprotoFlow | null>;
  readonly setPendingFlow: (flow: PendingAtprotoFlow) => Promise<void>;
  readonly deletePendingFlow: () => Promise<void>;
}

async function loadSecureStore(): Promise<typeof SecureStoreNS> {
  return import('expo-secure-store');
}

function secureOpts(SecureStore: typeof SecureStoreNS): SecureStoreNS.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
}

async function readJson<T>(alias: string): Promise<T | null> {
  const SecureStore = await loadSecureStore();
  const raw = await SecureStore.getItemAsync(alias, secureOpts(SecureStore));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupted on-disk value — degrade to "nothing stored" rather than
    // throwing; never echo the raw (potentially sensitive) contents.
    return null;
  }
}

async function writeJson(alias: string, value: unknown): Promise<void> {
  const SecureStore = await loadSecureStore();
  await SecureStore.setItemAsync(alias, JSON.stringify(value), secureOpts(SecureStore));
}

async function deleteAlias(alias: string): Promise<void> {
  const SecureStore = await loadSecureStore();
  await SecureStore.deleteItemAsync(alias, secureOpts(SecureStore));
}

const defaultStorage: AtprotoSessionStorage = {
  getSession: () => readJson<PersistedAtprotoSession>(SESSION_ALIAS),
  setSession: (session) => writeJson(SESSION_ALIAS, session),
  deleteSession: () => deleteAlias(SESSION_ALIAS),
  getPendingFlow: () => readJson<PendingAtprotoFlow>(PENDING_FLOW_ALIAS),
  setPendingFlow: (flow) => writeJson(PENDING_FLOW_ALIAS, flow),
  deletePendingFlow: () => deleteAlias(PENDING_FLOW_ALIAS),
};

let activeStorage: AtprotoSessionStorage = defaultStorage;

/** Test-only override. Pass `null` to restore the real SecureStore-backed implementation. */
export function __setAtprotoSessionStorageForTesting(storage: AtprotoSessionStorage | null): void {
  activeStorage = storage ?? defaultStorage;
}

export function getAtprotoSessionStorage(): AtprotoSessionStorage {
  return activeStorage;
}
