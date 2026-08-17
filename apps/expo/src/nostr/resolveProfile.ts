/**
 * resolveProfile.ts — resolves a `#nostr:<npub>` short-pointer share URL to
 * a verified profile (the inbound half of the short-link feature). The
 * sharer publishes their profile to Nostr (kind-30078, task A4.2) and shares
 * `https://solidarity.gg/#nostr:<their-npub>`; this decodes the npub, fetches
 * that pubkey's newest profile-pointer event across relays, and runs the
 * SAME verification the offline fragment path uses — PLUS a reverse-binding
 * check the fragment path doesn't need:
 *
 *   npubDecode(npub) -> pubkeyHex
 *     -> fetchLatestProfilePointer(relays)  (kind-30078, #d=solidarity.profile)
 *     -> verifyProfileJws(event.content)     (did:key signature — relay can't forge)
 *     -> assert profile.alsoKnownAs includes `nostr:<npub>`   ← the binding gate
 *
 * Why the binding gate: verifying the JWS only proves SOME did:key signed
 * this profile — not that it's the profile the shared npub points at. A
 * hostile/misconfigured relay could hand back a different person's validly
 * signed profile. The sharer's app writes `nostr:<npub>` into its own
 * profile's `alsoKnownAs` on publish (the bidirectional binding, 01-spec
 * §5/§6, "兩向都成立才畫綠勾"); requiring it here pins the resolved profile
 * back to the exact npub in the URL. Missing it → `bindingMismatch`, never a
 * silent accept.
 *
 * Never throws — every failure is a structured `VerifiedPageResult` invalid
 * reason (`unreachable`/`notFound`/`bindingMismatch` + the shared verify
 * reasons), so callers render the same honest 「無法驗證」 card the scanner uses.
 */
import { subscribeEvents } from '@/dag/nostrAdapter';
import { verifyProfileJws, type VerifiedPageResult } from '@/scan/verifiedPageHandler';

import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_RELAYS,
  fetchLatestProfilePointer,
  type SubscribeEventsFn,
} from './publish';
import { npubDecode } from './userKey';

export interface ResolveProfileOptions {
  /** Relay set to query. Defaults to `DEFAULT_RELAYS`. */
  readonly relays?: readonly string[];
  /** Per-relay wait budget. Defaults to `DEFAULT_FETCH_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** DI seam for tests — a mock relay instead of the real WS client. */
  readonly subscribeEventsFn?: SubscribeEventsFn;
}

/**
 * Fetch + JWS-verify a profile through an npub locator. This is the
 * transport primitive reused by DNS/ENS `src=nostr:<npub>` pointers; it
 * deliberately does not turn the locator itself into a Nostr badge claim.
 */
export async function fetchVerifiedProfileByNpub(
  npub: string,
  opts: ResolveProfileOptions = {}
): Promise<VerifiedPageResult> {
  const decoded = npubDecode(npub);
  if (!decoded.ok) {
    return { kind: 'invalid', reason: 'malformedPayload', detail: decoded.error };
  }

  const relays = opts.relays ?? DEFAULT_RELAYS;
  const { event, confirmed } = await fetchLatestProfilePointer(
    relays,
    decoded.value,
    opts.subscribeEventsFn ?? subscribeEvents,
    opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  );

  if (!event) {
    // `confirmed` (a relay reached EOSE with no match) vs blind (all
    // errored/timed out) — the same distinction `fetchLatestKind0` draws,
    // surfaced as two honest, differently-actionable reasons.
    return confirmed
      ? { kind: 'invalid', reason: 'notFound', detail: `no published profile for ${npub}` }
      : { kind: 'invalid', reason: 'unreachable', detail: 'no relay answered before timeout' };
  }

  return verifyProfileJws(event.content);
}

export async function resolveProfileByNpub(
  npub: string,
  opts: ResolveProfileOptions = {}
): Promise<VerifiedPageResult> {
  const result = await fetchVerifiedProfileByNpub(npub, opts);
  if (result.kind !== 'verified') return result;

  // The reverse-binding gate (see module doc) — the profile must claim this
  // exact npub back, or a relay could have substituted someone else's
  // validly-signed profile.
  if (!result.record.alsoKnownAs.includes(`nostr:${npub}`)) {
    return {
      kind: 'invalid',
      reason: 'bindingMismatch',
      detail: `profile does not list nostr:${npub} in alsoKnownAs`,
    };
  }
  return result;
}
