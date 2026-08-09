import { shortDid } from '@/components/id/shortDid';
import {
  DEFAULT_HANDLE_RESOLVERS,
  encodeFragment,
  isValidAtprotoHandle,
  isValidDnsHandle,
  isValidEnsHandle,
  matchHandleResolver,
  normalizeDnsHandle,
  normalizeEnsHandle,
  type HandleScheme,
  type ProfileRecord,
} from '@solidarity/shared';
import { validatePublicPageUsername } from '@/onboarding/publicPageUsername';

const PROFILE_PAGE_ORIGIN = 'https://app.solidarity.gg';
const PROFILE_PAGE_URL = `${PROFILE_PAGE_ORIGIN}/#`;
const PUBLIC_PAGE_ORIGIN = 'https://creds.id';

export interface ProfileIdentityLine {
  readonly kind: 'handle' | 'did';
  readonly label: string;
}

export function atprotoHandleClaim(record: ProfileRecord): string | null {
  const claim = record.alsoKnownAs.find((value) => value.startsWith('at://'));
  if (claim === undefined) return null;
  const rawHandle = claim.slice('at://'.length);
  if (!isValidAtprotoHandle(rawHandle)) return null;
  const normalized = rawHandle.trim().toLowerCase();
  return normalized.startsWith('@') ? normalized.slice(1) : normalized;
}

export function profileIdentityLine(record: ProfileRecord): ProfileIdentityLine {
  const handle = atprotoHandleClaim(record);
  return handle
    ? { kind: 'handle', label: `@${handle}` }
    : { kind: 'did', label: shortDid(record.did) };
}

export interface ProfileShareModel {
  readonly offlineUrl: string;
  readonly usernameUrl: string | null;
  readonly usernameDisplayUrl: string | null;
  readonly shortUrl: string | null;
  readonly oversize: boolean;
}

export function buildProfileShareModel(
  record: ProfileRecord,
  jws: string,
  publicPageUsername = '',
): ProfileShareModel {
  const fragment = encodeFragment(jws);
  const nostrClaim = record.alsoKnownAs.find((value) => value.startsWith('nostr:npub'));
  const validUsername = validatePublicPageUsername(publicPageUsername).kind === 'valid'
    ? publicPageUsername
    : null;
  return {
    offlineUrl: `${PROFILE_PAGE_URL}${fragment.fragment}`,
    // Keep the signed page in the hash so /name works offline before a
    // resolver/backend exists. UI presents only the stable short path.
    usernameUrl: validUsername
      ? `${PUBLIC_PAGE_ORIGIN}/${validUsername}#${fragment.fragment}`
      : null,
    usernameDisplayUrl: validUsername
      ? `${PUBLIC_PAGE_ORIGIN}/${validUsername}`
      : null,
    shortUrl: nostrClaim ? `${PROFILE_PAGE_URL}${nostrClaim}` : null,
    oversize: fragment.oversize,
  };
}

export function selectProfileShareUrl(model: ProfileShareModel, preferShort: boolean): string {
  return preferShort && model.shortUrl ? model.shortUrl : model.offlineUrl;
}

export type ProfileShareUrlCandidate =
  | {
      readonly kind: 'username';
      readonly url: string;
      readonly displayUrl: string;
    }
  | {
      readonly kind: 'handle';
      readonly url: string;
      readonly isVerified: boolean;
    }
  | {
      readonly kind: 'short' | 'offline';
      readonly url: string;
    };

export type ProfileShareUrlSelection =
  | {
      readonly kind: 'ready';
      readonly candidate: ProfileShareUrlCandidate;
    }
  | { readonly kind: 'error' };

export function pickBestShareUrl(
  candidates: readonly ProfileShareUrlCandidate[]
): ProfileShareUrlSelection {
  const username = candidates.find((candidate) => candidate.kind === 'username');
  if (username) return { kind: 'ready', candidate: username };

  const verifiedHandle = candidates.find(
    (candidate) => candidate.kind === 'handle' && candidate.isVerified
  );
  if (verifiedHandle) return { kind: 'ready', candidate: verifiedHandle };

  const short = candidates.find((candidate) => candidate.kind === 'short');
  if (short) return { kind: 'ready', candidate: short };

  const offline = candidates.find((candidate) => candidate.kind === 'offline');
  return offline ? { kind: 'ready', candidate: offline } : { kind: 'error' };
}

export function displayProfileShareUrl(candidate: ProfileShareUrlCandidate): string {
  const url = candidate.kind === 'username' ? candidate.displayUrl : candidate.url;
  return url.replace(/^https?:\/\//u, '');
}

/**
 * `@handle` share alias (`notes-1.3.3-publishing-pairing-research.md` §2,
 * grill decision 2026-07-19) — the shortest of the three share forms
 * (~40 chars vs. ~96 for the Nostr pointer / ~700 for the offline
 * fragment), built ONLY from a scheme whose OWN bidirectional binding is
 * currently verified. `nip05` is excluded: no share-alias UI exists for it.
 */
export type HandleShareScheme = Exclude<HandleScheme, 'nip05'>;

export interface HandleShareCandidate {
  readonly scheme: HandleShareScheme;
  readonly handle: string;
  readonly url: string;
}

export interface ProfileShareUrlResolution {
  readonly candidates: readonly ProfileShareUrlCandidate[];
  readonly selection: ProfileShareUrlSelection;
}

/**
 * Build every URL the share surface may honestly offer, then apply the
 * single global precedence rule (verified handle → confirmed Nostr pointer
 * → self-contained offline fragment). `nostrShortUrlReady` is deliberately
 * supplied by the profile store's exact published-JWS marker; a retained
 * `nostr:npub` claim alone does not prove that the current page is live.
 */
export function buildProfileShareUrlSelection(
  model: ProfileShareModel,
  verifiedHandle: HandleShareCandidate | null,
  nostrShortUrlReady: boolean
): ProfileShareUrlResolution {
  const candidates: ProfileShareUrlCandidate[] = [];
  if (model.usernameUrl !== null && model.usernameDisplayUrl !== null) {
    candidates.push({
      kind: 'username',
      url: model.usernameUrl,
      displayUrl: model.usernameDisplayUrl,
    });
  }
  if (verifiedHandle !== null) {
    candidates.push({
      kind: 'handle',
      url: verifiedHandle.url,
      isVerified: true,
    });
  }
  if (nostrShortUrlReady && model.shortUrl !== null) {
    candidates.push({ kind: 'short', url: model.shortUrl });
  }
  candidates.push({ kind: 'offline', url: model.offlineUrl });
  return { candidates, selection: pickBestShareUrl(candidates) };
}

/** D6 (Bluesky-spine-first) / grill G5: atproto > ens > dns. Encodes the
 *  extraction order below — each scheme contributes at most one candidate
 *  (its first matching `alsoKnownAs` claim), in priority order already. */
const HANDLE_CLAIM_EXTRACTORS: readonly {
  readonly scheme: HandleShareScheme;
  readonly extractHandle: (record: ProfileRecord) => string | null;
}[] = [
  { scheme: 'atproto', extractHandle: atprotoHandleClaim },
  { scheme: 'ens', extractHandle: ensHandleClaim },
  { scheme: 'dns', extractHandle: dnsHandleClaim },
];

function ensHandleClaim(record: ProfileRecord): string | null {
  const claim = record.alsoKnownAs.find((value) => value.startsWith('ens:'));
  if (claim === undefined) return null;
  const raw = claim.slice('ens:'.length);
  return isValidEnsHandle(raw) ? normalizeEnsHandle(raw) : null;
}

function dnsHandleClaim(record: ProfileRecord): string | null {
  const claim = record.alsoKnownAs.find((value) => value.startsWith('dns:'));
  if (claim === undefined) return null;
  const raw = claim.slice('dns:'.length);
  return isValidDnsHandle(raw) ? normalizeDnsHandle(raw) : null;
}

/**
 * The path segment a candidate's URL encodes. A bare `@<handle>` is
 * offered ONLY for schemes whose bare form deterministically resolves back
 * to the SAME scheme through `DEFAULT_HANDLE_RESOLVERS` — true for atproto
 * handles and `.eth` ENS names (an unambiguous suffix), but NOT for a bare
 * domain: `matchHandleResolver` picks ATProto first for any bare
 * `label.label` string (D7 first-match-wins registry order), so a
 * DNS-verified domain shared bare would silently route to the wrong
 * resolver and 404/misresolve. DNS handles therefore keep the explicit
 * `dns:` scheme prefix in the path segment: `/@dns:<domain>`. A raw `:` is
 * a valid `pchar` (RFC 3986) and survives both `new URL(...).pathname` and
 * `decodeURIComponent` unescaped — verified against this exact segment in
 * `handleShareCandidates.test.ts` and against the deep-link parser +
 * `classifyVerifiedPagePayload` scan classifier — so no percent-encoding
 * is needed.
 */
function handlePathSegment(scheme: HandleShareScheme, handle: string): string {
  return scheme === 'dns' ? `dns:${handle}` : handle;
}

/**
 * All handle candidates derivable from `record.alsoKnownAs`, priority-
 * ordered (atproto > ens > dns), regardless of verification state. Each
 * candidate's URL is round-trip-checked against the SAME resolver registry
 * the deep-link parser and scan classifier use (`matchHandleResolver`) —
 * a candidate whose encoded path segment would resolve to a DIFFERENT
 * scheme (e.g. an atproto handle that happens to end in `.eth`) is
 * dropped rather than offered broken.
 */
export function handleShareCandidates(record: ProfileRecord): readonly HandleShareCandidate[] {
  const candidates: HandleShareCandidate[] = [];
  for (const { scheme, extractHandle } of HANDLE_CLAIM_EXTRACTORS) {
    const handle = extractHandle(record);
    if (handle === null) continue;
    const segment = handlePathSegment(scheme, handle);
    if (matchHandleResolver(segment, DEFAULT_HANDLE_RESOLVERS)?.scheme !== scheme) continue;
    candidates.push({ scheme, handle, url: `${PROFILE_PAGE_ORIGIN}/@${segment}` });
  }
  return candidates;
}

/**
 * Returns whether `candidate`'s binding is CURRENTLY verified — the only
 * honesty gate for offering a handle share link (an unverified handle link
 * would 404 or resolve to someone else). Callers must reuse a cached,
 * already-fresh badge state (the S8h `badgeStatusCache` TTL pattern) —
 * never verify at share time or on focus, which would reopen the S8h
 * relay-fan-out regression. See `handleShareVerification.ts` for the real
 * (MMKV-cache-backed) implementation wired into the share UI.
 */
export type HandleShareVerificationLookup = (candidate: HandleShareCandidate) => boolean;

/** Handle candidates whose binding `isVerified` confirms is currently
 *  verified, still in priority order. */
export function verifiedHandleShareCandidates(
  record: ProfileRecord,
  isVerified: HandleShareVerificationLookup
): readonly HandleShareCandidate[] {
  return handleShareCandidates(record).filter((candidate) => isVerified(candidate));
}

/**
 * The single handle URL the share UI should surface as its shortest
 * option, or `null` when no candidate is currently verified — in which
 * case the share UI behaves exactly as it did before this form existed
 * (Nostr pointer / offline fragment only).
 */
export function preferredVerifiedHandleShareCandidate(
  record: ProfileRecord,
  isVerified: HandleShareVerificationLookup
): HandleShareCandidate | null {
  return verifiedHandleShareCandidates(record, isVerified)[0] ?? null;
}
