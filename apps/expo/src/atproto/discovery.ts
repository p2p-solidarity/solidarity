/**
 * atproto identity + server discovery (task A6.1) —
 * https://atproto.com/specs/oauth §"Identity Authentication" +
 * §"Authorization Servers". Everything here is fetch-injectable (no global
 * `fetch` at module scope) so it's testable with mocked HTTP and never
 * hits real Bluesky infra in tests.
 *
 * ── Handle → DID → PDS → Authorization Server, in order ──────────────────
 *
 * 1. `resolveHandleToDid` — atproto handle resolution has two blessed
 *    mechanisms (both MUST be supported per spec): a DNS TXT record at
 *    `_atproto.<handle>` (required for the common case — `*.bsky.social`
 *    handles are resolved this way; Bluesky's DNS answers these TXT
 *    queries dynamically) and an HTTPS well-known fallback at
 *    `https://<handle>/.well-known/atproto-did` (used when the handle IS
 *    a domain the owner controls). RN has no native DNS-TXT API, so DNS
 *    resolution goes through DNS-over-HTTPS (Cloudflare's `dns-query`
 *    JSON endpoint) — the spec explicitly anticipates this: "handle
 *    resolution may involve DNS TXT queries, which are not directly
 *    supported from browser apps... implementations might use... DNS-
 *    over-HTTP". DNS is tried first (it's the ONLY mechanism that works
 *    for `*.bsky.social` handles), well-known second.
 * 2. `resolveDidDocument` — did:plc via the PLC directory
 *    (`https://plc.directory/<did>`) or did:web via
 *    `https://<domain>/.well-known/did.json`.
 * 3. `verifyHandleReciprocation` — MANDATORY per spec: "it is critical
 *    (mandatory) to bidirectionally verify the handle by checking that the
 *    DID document claims the handle". `resolveAtprotoIdentity` fails
 *    closed if the DID document's `alsoKnownAs` doesn't contain
 *    `at://<handle>` — this is what stops a handle-resolution hijack from
 *    binding the session to the wrong account.
 * 4. `extractPdsEndpoint` — the `#atproto_pds` service entry's
 *    `serviceEndpoint` (the Resource Server for this account).
 * 5. `discoverAuthServerMetadata` — PDS `/.well-known/oauth-protected-
 *    resource` → `authorization_servers[0]`, then that origin's
 *    `/.well-known/oauth-authorization-server`, validated against the
 *    atproto-specific requirements (PAR mandatory, DPoP/ES256 supported,
 *    PKCE S256 supported, `issuer` self-consistent per RFC 8414 §3.3).
 */
import { err, ok, type Result } from '@solidarity/shared';

export interface AtprotoDidDocument {
  readonly id: string;
  readonly alsoKnownAs: readonly string[];
  readonly service: readonly { readonly id: string; readonly type: string; readonly serviceEndpoint: string }[];
}

export interface AtprotoIdentity {
  readonly did: string;
  /** Normalized (lowercased, trimmed) handle — bidirectionally verified against the DID document. */
  readonly handle: string;
  readonly pdsUrl: string;
}

export interface AuthServerMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly pushedAuthorizationRequestEndpoint: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function safeFetchJson(url: string, fetchImpl: typeof fetch, init?: RequestInit): Promise<Result<unknown, string>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (e) {
    return err(`network error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) return err(`HTTP ${String(res.status)} fetching ${url}`);
  try {
    return ok(await res.json());
  } catch {
    return err(`response from ${url} is not valid JSON`);
  }
}

const DID_RE = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/u;

function isWellFormedDid(value: string): boolean {
  return DID_RE.test(value);
}

// ── Handle syntax validation — MANDATORY before any resolution ────────────
//
// This is a security boundary, not just a format nicety:
// `resolveHandleViaWellKnown` (below) builds
// `https://${handle}/.well-known/atproto-did` from the handle verbatim. A
// handle like `alice.bsky.social@evil.tld` parses as `evil.tld` being the
// actual fetch host (`alice.bsky.social` is swallowed as URL userinfo) — an
// attacker who controls evil.tld can stand up a reciprocal did:web document
// there and hijack the entire OAuth flow. Rejecting anything that isn't
// unambiguously hostname-shaped BEFORE the first network call (DoH or
// well-known) closes that hole for both resolution mechanisms.
//
// Grammar per https://atproto.com/specs/handle (RFC 1035 domain syntax plus
// atproto's own constraints):
//   - overall length <= 253 chars
//   - dot-separated labels, each 1-63 chars, `[A-Za-z0-9-]` only, no
//     leading/trailing hyphen
//   - at least two labels (a handle is always a domain, never a bare label)
//   - the last label (TLD) must not be all-numeric
const HANDLE_LABEL_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/u;
const HANDLE_MAX_LENGTH = 253;

/** True iff `handle` is syntactically a valid atproto handle. Does not check DNS/well-known resolvability. */
export function isValidAtprotoHandle(handle: string): boolean {
  if (handle.length === 0 || handle.length > HANDLE_MAX_LENGTH) return false;
  const labels = handle.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => HANDLE_LABEL_RE.test(label))) return false;
  const tld = labels[labels.length - 1];
  return tld !== undefined && !/^[0-9]+$/u.test(tld);
}

// ── 1. Handle → DID ───────────────────────────────────────────────────────

async function resolveHandleViaDns(handle: string, fetchImpl: typeof fetch): Promise<string | null> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(`_atproto.${handle}`)}&type=TXT`;
  const result = await safeFetchJson(url, fetchImpl, { headers: { accept: 'application/dns-json' } });
  if (!result.ok || !isRecord(result.value)) return null;
  const answers = result.value['Answer'];
  if (!Array.isArray(answers)) return null;
  for (const answer of answers) {
    if (!isRecord(answer) || typeof answer['data'] !== 'string') continue;
    const unquoted = answer['data'].replace(/^"|"$/gu, '');
    if (unquoted.startsWith('did=')) return unquoted.slice('did='.length);
  }
  return null;
}

async function resolveHandleViaWellKnown(handle: string, fetchImpl: typeof fetch): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(`https://${handle}/.well-known/atproto-did`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let text: string;
  try {
    text = (await res.text()).trim();
  } catch {
    return null;
  }
  return text.startsWith('did:') ? text : null;
}

/** Resolve a handle (e.g. `alice.bsky.social`) to its DID. Tries DNS TXT first, HTTPS well-known second. */
export async function resolveHandleToDid(handle: string, fetchImpl: typeof fetch = fetch): Promise<Result<string, string>> {
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return err('handle is empty');
  if (!isValidAtprotoHandle(normalized)) return err('invalid handle');

  const did = (await resolveHandleViaDns(normalized, fetchImpl)) ?? (await resolveHandleViaWellKnown(normalized, fetchImpl));
  if (!did) {
    return err(`could not resolve handle "${normalized}" to a DID (checked DNS TXT _atproto.${normalized} and https://${normalized}/.well-known/atproto-did)`);
  }
  if (!isWellFormedDid(did)) {
    return err(`handle "${normalized}" resolved to a malformed DID: ${JSON.stringify(did)}`);
  }
  return ok(did);
}

// ── 2. DID → DID document ─────────────────────────────────────────────────

function looksLikeDidDocument(v: unknown): v is AtprotoDidDocument {
  if (!isRecord(v)) return false;
  if (typeof v['id'] !== 'string') return false;
  const aka = v['alsoKnownAs'];
  if (!Array.isArray(aka) || !aka.every((x) => typeof x === 'string')) return false;
  const service = v['service'];
  if (!Array.isArray(service)) return false;
  return service.every(
    (s) => isRecord(s) && typeof s['id'] === 'string' && typeof s['type'] === 'string' && typeof s['serviceEndpoint'] === 'string'
  );
}

/** Resolve a DID (did:plc or did:web only — the only methods atproto accounts use) to its DID document. */
export async function resolveDidDocument(did: string, fetchImpl: typeof fetch = fetch): Promise<Result<AtprotoDidDocument, string>> {
  let url: string;
  if (did.startsWith('did:plc:')) {
    url = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const domain = did.slice('did:web:'.length);
    if (domain.includes(':')) {
      return err(`did:web with a path component is not supported: ${did}`);
    }
    url = `https://${decodeURIComponent(domain)}/.well-known/did.json`;
  } else {
    return err(`unsupported DID method (atproto accounts only use did:plc / did:web): ${did}`);
  }

  const result = await safeFetchJson(url, fetchImpl);
  if (!result.ok) return result;
  if (!looksLikeDidDocument(result.value)) {
    return err(`DID document at ${url} is missing required fields (id, alsoKnownAs[], service[])`);
  }
  return ok(result.value);
}

// ── 3. Bidirectional handle verification (mandatory) ─────────────────────

/** True iff `doc.alsoKnownAs` contains `at://<handle>` (case-insensitive). */
export function verifyHandleReciprocation(doc: AtprotoDidDocument, handle: string): boolean {
  const target = `at://${handle.trim().toLowerCase()}`;
  return doc.alsoKnownAs.some((aka) => aka.toLowerCase() === target);
}

// ── 4. PDS service endpoint ────────────────────────────────────────────────

export function extractPdsEndpoint(doc: AtprotoDidDocument): Result<string, string> {
  const svc = doc.service.find((s) => s.id === '#atproto_pds' || s.type === 'AtprotoPersonalDataServer');
  if (!svc) return err('DID document has no #atproto_pds / AtprotoPersonalDataServer service entry');
  let protocol: string;
  try {
    protocol = new URL(svc.serviceEndpoint).protocol;
  } catch {
    return err(`PDS serviceEndpoint is not a valid URL: ${svc.serviceEndpoint}`);
  }
  if (protocol !== 'https:') return err(`PDS serviceEndpoint must be https, got non-https endpoint: ${svc.serviceEndpoint}`);
  return ok(svc.serviceEndpoint);
}

// ── Orchestrator: handle → verified {did, handle, pdsUrl} ──────────────────

export async function resolveAtprotoIdentity(handle: string, fetchImpl: typeof fetch = fetch): Promise<Result<AtprotoIdentity, string>> {
  const normalized = handle.trim().toLowerCase();

  const didResult = await resolveHandleToDid(normalized, fetchImpl);
  if (!didResult.ok) return didResult;

  const docResult = await resolveDidDocument(didResult.value, fetchImpl);
  if (!docResult.ok) return docResult;

  if (!verifyHandleReciprocation(docResult.value, normalized)) {
    return err(
      `handle "${normalized}" resolved to ${didResult.value}, but that DID document's alsoKnownAs does not claim the handle back — bidirectional verification failed (possible handle hijack or stale DNS)`
    );
  }

  const pdsResult = extractPdsEndpoint(docResult.value);
  if (!pdsResult.ok) return pdsResult;

  return ok({ did: didResult.value, handle: normalized, pdsUrl: pdsResult.value });
}

// ── 5. PDS → Authorization Server metadata ─────────────────────────────────

async function fetchAuthServerOrigin(pdsUrl: string, fetchImpl: typeof fetch): Promise<Result<string, string>> {
  let origin: string;
  try {
    origin = new URL(pdsUrl).origin;
  } catch {
    return err(`pdsUrl is not a valid URL: ${pdsUrl}`);
  }
  const result = await safeFetchJson(`${origin}/.well-known/oauth-protected-resource`, fetchImpl);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value['authorization_servers']) || typeof result.value['authorization_servers'][0] !== 'string') {
    return err(`${origin}/.well-known/oauth-protected-resource is missing authorization_servers[0]`);
  }
  const authServer = result.value['authorization_servers'][0];
  let authServerProtocol: string;
  try {
    authServerProtocol = new URL(authServer).protocol;
  } catch {
    return err(`authorization_servers[0] is not a valid URL: ${authServer}`);
  }
  if (authServerProtocol !== 'https:') {
    return err(`authorization_servers[0] must be https, got non-https endpoint: ${authServer}`);
  }
  return ok(authServer);
}

async function fetchAuthServerMetadata(issuerOrigin: string, fetchImpl: typeof fetch): Promise<Result<AuthServerMetadata, string>> {
  const result = await safeFetchJson(`${issuerOrigin}/.well-known/oauth-authorization-server`, fetchImpl);
  if (!result.ok) return result;
  if (!isRecord(result.value)) return err('Authorization Server metadata is not a JSON object');
  const v = result.value;

  if (typeof v['issuer'] !== 'string') return err('Authorization Server metadata missing issuer');
  if (v['issuer'] !== issuerOrigin) {
    return err(`Authorization Server metadata issuer (${v['issuer']}) does not match its own origin (${issuerOrigin}) — RFC 8414 §3.3 requires an exact match`);
  }
  if (typeof v['authorization_endpoint'] !== 'string') return err('Authorization Server metadata missing authorization_endpoint');
  if (typeof v['token_endpoint'] !== 'string') return err('Authorization Server metadata missing token_endpoint');
  if (typeof v['pushed_authorization_request_endpoint'] !== 'string') {
    return err('Authorization Server metadata missing pushed_authorization_request_endpoint — atproto mandates PAR');
  }
  if (v['require_pushed_authorization_requests'] !== true) {
    return err('Authorization Server metadata require_pushed_authorization_requests must be true — atproto mandates PAR');
  }
  const dpopAlgs = v['dpop_signing_alg_values_supported'];
  if (!Array.isArray(dpopAlgs) || !dpopAlgs.includes('ES256')) {
    return err('Authorization Server metadata dpop_signing_alg_values_supported must include ES256');
  }
  const pkceMethods = v['code_challenge_methods_supported'];
  if (!Array.isArray(pkceMethods) || !pkceMethods.includes('S256')) {
    return err('Authorization Server metadata code_challenge_methods_supported must include S256');
  }

  return ok({
    issuer: v['issuer'],
    authorizationEndpoint: v['authorization_endpoint'],
    tokenEndpoint: v['token_endpoint'],
    pushedAuthorizationRequestEndpoint: v['pushed_authorization_request_endpoint'],
  });
}

/** PDS → Resource Server metadata → Authorization Server metadata, validated per module doc. */
export async function discoverAuthServerMetadata(pdsUrl: string, fetchImpl: typeof fetch = fetch): Promise<Result<AuthServerMetadata, string>> {
  const originResult = await fetchAuthServerOrigin(pdsUrl, fetchImpl);
  if (!originResult.ok) return originResult;
  return fetchAuthServerMetadata(originResult.value, fetchImpl);
}
