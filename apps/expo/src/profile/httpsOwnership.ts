const MAX_PROOF_BYTES = 64 * 1024;
const MAX_ORIGINS = 6;
const DEFAULT_TIMEOUT_MS = 5_000;

export type HttpsOwnershipMethod = 'did-document' | 'rel-me';

export interface HttpsOwnershipEvidence {
  readonly method: HttpsOwnershipMethod;
  readonly origin: string;
  readonly proofUrl: string;
}

interface VerifyHttpsOwnershipInput {
  readonly did: string;
  readonly links: readonly string[];
  readonly profileUrls: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface Candidate {
  readonly origin: string;
  readonly pageUrl: string;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function candidateFor(raw: string): Candidate | null {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.includes(':') ||
      isPrivateIpv4(hostname)
    ) {
      return null;
    }
    return { origin: url.origin, pageUrl: url.href };
  } catch {
    return null;
  }
}

function canonicalUrl(raw: string): string | null {
  try {
    return new URL(raw).href;
  } catch {
    return null;
  }
}

function hasReciprocalRelMe(
  html: string,
  pageUrl: string,
  profileUrls: ReadonlySet<string>,
): boolean {
  const activeHtml = html
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<(script|style|template|textarea|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '');
  const tags = activeHtml.match(/<(?:a|link)\b[^>]*>/giu) ?? [];
  for (const tag of tags) {
    const attributes = new Map<string, string>();
    const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;
    for (const match of tag.matchAll(attributePattern)) {
      const name = match[1];
      if (name) attributes.set(name.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
    }
    const rel = attributes.get('rel')?.toLowerCase().split(/\s+/u) ?? [];
    const href = attributes.get('href');
    if (!rel.includes('me') || !href) continue;
    try {
      if (profileUrls.has(new URL(href, pageUrl).href)) return true;
    } catch {
      // A malformed href is not ownership evidence.
    }
  }
  return false;
}

async function readBodyBounded(
  response: Response,
  controller: AbortController,
): Promise<string | null> {
  const body = response.body;
  if (!body) return null;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_PROOF_BYTES) {
      await reader.cancel('HTTPS ownership proof exceeded byte limit');
      controller.abort();
      return null;
    }
    chunks.push(next.value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchBounded(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  expectedOrigin: string,
  externalSignal?: AbortSignal,
): Promise<string | null> {
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort();
  };
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json, text/html;q=0.9, text/plain;q=0.8' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.protocol !== 'https:' || finalUrl.origin !== expectedOrigin) return null;
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_PROOF_BYTES) return null;
    return await readBodyBounded(response, controller);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

async function performVerification({
  did,
  links,
  profileUrls,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}: VerifyHttpsOwnershipInput): Promise<readonly HttpsOwnershipEvidence[]> {
  const candidates = new Map<string, Candidate>();
  for (const raw of links) {
    const candidate = candidateFor(raw);
    if (candidate && !candidates.has(candidate.origin)) candidates.set(candidate.origin, candidate);
    if (candidates.size >= MAX_ORIGINS) break;
  }

  const canonicalProfileUrls = new Set(
    profileUrls.map(canonicalUrl).filter((url): url is string => url !== null),
  );
  const checks = [...candidates.values()].map(async ({ origin, pageUrl }) => {
    const proofUrl = `${origin}/.well-known/did.json`;
    const body = await fetchBounded(proofUrl, fetchImpl, timeoutMs, origin, signal);
    if (body) {
      try {
        const document = JSON.parse(body) as { readonly id?: unknown };
        if (document.id === did) {
          return { method: 'did-document', origin, proofUrl } as const;
        }
      } catch {
        // Fall through to rel=me — a site may use only one proof method.
      }
    }

    if (canonicalProfileUrls.size === 0) return null;
    const html = await fetchBounded(pageUrl, fetchImpl, timeoutMs, origin, signal);
    if (!html || !hasReciprocalRelMe(html, pageUrl, canonicalProfileUrls)) return null;
    return { method: 'rel-me', origin, proofUrl: pageUrl } as const;
  });

  return (await Promise.all(checks)).filter(
    (item): item is HttpsOwnershipEvidence => item !== null,
  );
}

// ─── Module-level TTL + in-flight cache (R24) ────────────────────────────────
//
// Website ownership was re-fetched on every Me-tab focus AND every
// /verify/nostr mount. A completed check is stable for a while (the proof is
// an HTTPS DID document or a rel=me link that changes rarely), so we cache the
// result keyed on (did, sorted links, sorted profile URLs) for the SAME 15-min
// window `badgeStatusCache` uses, and coalesce concurrent probes for one key
// into a single in-flight round-trip. Both call sites get the cache for free
// without being edited.
//
// The cache applies ONLY to the default (production) fetch. A caller that
// injects a custom `fetchImpl` — the unit tests, or any future direct
// injection — bypasses the cache entirely so every call is observable and its
// per-caller `signal` is honored verbatim.

/** Same window as `badgeStatusCache`'s BADGE_REVERIFY_TTL_MS. */
export const HTTPS_OWNERSHIP_TTL_MS = 15 * 60_000;

interface OwnershipCacheEntry {
  readonly value: readonly HttpsOwnershipEvidence[];
  readonly expiresAt: number;
}

const resultCache = new Map<string, OwnershipCacheEntry>();
const inFlightCache = new Map<string, Promise<readonly HttpsOwnershipEvidence[]>>();
let nowFn: () => number = () => Date.now();

/** Stable key: order-independent in both `links` and `profileUrls`, so the
 * Me tab and /verify/nostr (which build the URL lists independently) collapse
 * onto one cache entry. */
export function httpsOwnershipCacheKey(
  did: string,
  links: readonly string[],
  profileUrls: readonly string[],
): string {
  return JSON.stringify([did, [...links].sort(), [...profileUrls].sort()]);
}

export function verifyHttpsOwnership(
  input: VerifyHttpsOwnershipInput,
): Promise<readonly HttpsOwnershipEvidence[]> {
  // Custom fetch (tests / direct injection) skips the shared cache.
  if (input.fetchImpl !== undefined) return performVerification(input);

  const key = httpsOwnershipCacheKey(input.did, input.links, input.profileUrls);
  const now = nowFn();

  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);

  const existing = inFlightCache.get(key);
  if (existing) return existing;

  // The shared computation deliberately omits the per-caller AbortSignal: two
  // screens dedupe onto one probe, so one screen unmounting must not abort the
  // other's result. The per-fetch timeout still bounds it.
  const run = performVerification({
    did: input.did,
    links: input.links,
    profileUrls: input.profileUrls,
    timeoutMs: input.timeoutMs,
  })
    .then((value) => {
      resultCache.set(key, { value, expiresAt: nowFn() + HTTPS_OWNERSHIP_TTL_MS });
      return value;
    })
    .finally(() => {
      if (inFlightCache.get(key) === run) inFlightCache.delete(key);
    });
  inFlightCache.set(key, run);
  return run;
}

/** Test-only: clear both cache layers between cases. */
export function __resetHttpsOwnershipCacheForTesting(): void {
  resultCache.clear();
  inFlightCache.clear();
}

/** Test-only: inject a deterministic clock (pass `null` to restore Date.now). */
export function __setHttpsOwnershipClockForTesting(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now());
}
