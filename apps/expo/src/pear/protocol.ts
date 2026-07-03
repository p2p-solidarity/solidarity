/**
 * Pear v1 application protocol — card exchange + SD-JWT presentation, wire
 * messages riding on top of an already-`authenticateChannel`'d
 * `AuthenticatedChannel` (A3.3, `handshake.ts`). This module owns the
 * REQUEST/RESPONSE state machine only: consent UI (A5.2), deep-link entry
 * (A5.4), and real SD-JWT presentation/verification (A5.3, `oidc/proofVerifier`)
 * are later tasks — `onCardRequest`/`onPresentRequest` are the seam they plug
 * into.
 *
 * Wire messages (length-prefixed JSON frames, `frames.ts`'s codec, carried by
 * `AuthenticatedChannel.send`/`onFrame`):
 *   `{t:'card.request'}`                      → peer offers or declines
 *   `{t:'card.offer', card:<full-card JWS>}`   → the requester's answer
 *   `{t:'card.decline'}`                       → the requester's answer (consent denied)
 *   `{t:'present.request', claims:string[]}`   → peer offers or declines
 *   `{t:'present.response', sdJwt:string}`     → the requester's answer
 *   `{t:'present.decline'}`                    → the requester's answer (consent denied)
 *
 * `PearSession` takes an `AuthenticatedChannel`, never a raw `PearChannel` —
 * that's a structural (type-level), not just behavioural, guarantee that no
 * application frame can be sent/received before mutual DID authentication:
 * there is no constructor path into this module that accepts anything less.
 *
 * Hardening decisions (each one is a place a careless implementation could
 * hang forever, crash, or misattribute a response to the wrong request):
 *
 * - **No request id on the wire.** `card.request`/`present.request` carry no
 *   correlation id, so at most one request of a given TYPE may be
 *   outstanding at a time — a second call while one is in flight is
 *   rejected immediately (`err`, no frame sent), not queued. Queueing would
 *   still be unable to tell two `card.offer` responses apart, so it would
 *   only defer the ambiguity, not resolve it. This is symmetric on the
 *   incoming side too: a second `card.request`/`present.request` arriving
 *   while the first is still awaiting its handler (e.g. a pending consent
 *   sheet) is auto-declined without invoking the handler again, so a chatty
 *   or buggy peer can't trigger a second Face-ID prompt for one decision.
 * - **Unknown message type → ignore-and-report, not close.** Unlike
 *   `handshake.ts` (pre-auth, where any deviation is inherently
 *   untrustworthy and the channel closes), a frame here comes from a peer
 *   whose DID is already cryptographically verified. Tearing down the whole
 *   session — and every other in-flight request — over one unrecognized or
 *   forward-compatible message type is disproportionate. The frame is
 *   dropped and surfaced via `onProtocolError` for diagnostics; the session
 *   stays usable.
 * - **A response with no matching outstanding request** (arrived after a
 *   timeout already settled it, arrived for a type never requested, or two
 *   response types crossed) is treated the same way: dropped +
 *   `onProtocolError`, never thrown, never misapplied to an unrelated
 *   pending promise.
 * - **`card.offer`'s `card` is untrusted input.** The receiver verifies it
 *   as a compact JWS signed by the PEER's own DID (`ch.peerDid` — a card is
 *   self-attested by whoever offers it) via `verifyCompact`, then validates
 *   the decoded payload shape via `parseProfile`. Either failure resolves
 *   `requestCard()` with `err(...)`; the raw JWS is never handed back
 *   unverified.
 * - **Malformed frame (missing/wrong-typed fields) → reject, never throw.**
 *   If it's a response to an outstanding request, the request's promise
 *   settles with `err(...)` immediately (no reason to make the caller wait
 *   out the full timeout for an already-diagnosable protocol bug). If it
 *   isn't tied to a pending request, it's `onProtocolError`-reported and
 *   dropped like an unknown type.
 * - **Request timeout** (`DEFAULT_REQUEST_TIMEOUT_MS`, overridable for
 *   tests) resolves `err(...)` and frees the slot for a future request of
 *   that type.
 * - **Handler throws/rejects, or no handler registered at all** → the
 *   incoming request is answered with the corresponding `*.decline` frame.
 *   This module can never fabricate consent, so "no answer available" and
 *   "consent denied" are wire-indistinguishable — both are `declined`.
 */
import { err, ok, parseProfile, verifyCompact, type Result } from '@solidarity/shared';

import type { AuthenticatedChannel } from './handshake';

/** No response within this window frees the request slot and resolves
 *  `err(...)`. Generous relative to a relay round trip; short enough that a
 *  silent/dead peer doesn't hold a UI spinner open indefinitely. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface CardOfferResult {
  readonly cardJws: string;
}

export interface PresentResponseResult {
  readonly sdJwt: string;
}

/** What an `onCardRequest` handler (A5.2's consent sheet + Face ID) returns:
 *  either the full-card JWS to offer, or an explicit decline. */
export type CardRequestHandlerResult = CardOfferResult | { readonly declined: true };
export type CardRequestHandler = () => Promise<CardRequestHandlerResult>;

/** What an `onPresentRequest` handler returns: the produced SD-JWT
 *  presentation, or an explicit decline. Claim selection / SD-JWT
 *  construction and verification is A5.3's job — this module only relays
 *  the requested claim names and the resulting opaque string. */
export type PresentRequestHandlerResult = PresentResponseResult | { readonly declined: true };
export type PresentRequestHandler = (claims: readonly string[]) => Promise<PresentRequestHandlerResult>;

export interface PearProtocolError {
  /** The raw frame that could not be acted on (unknown type, malformed
   *  shape, or an orphaned response) — opaque, for logging/telemetry only. */
  readonly frame: unknown;
  readonly message: string;
}

export interface PearSessionOptions {
  /** Test-only override for `DEFAULT_REQUEST_TIMEOUT_MS` so a timeout test
   *  doesn't need to wait out the real window. Production callers must not
   *  set this. */
  readonly requestTimeoutMs?: number;
}

export interface PearSession {
  /** Ask the peer for their full card. Resolves once the peer answers
   *  (`card.offer` verified against the peer's own DID, or `card.decline`),
   *  or after the request times out. Rejects immediately (no frame sent) if
   *  a card request is already outstanding on this session. */
  requestCard(): Promise<Result<CardOfferResult, string>>;
  /** Ask the peer to present specific claims. Resolves once the peer
   *  answers (`present.response` or `present.decline`), or after timeout.
   *  Same one-at-a-time rule as `requestCard`. */
  requestPresentation(claims: readonly string[]): Promise<Result<PresentResponseResult, string>>;
  /** Register the handler that answers an incoming `card.request`. Replaces
   *  any previously-registered handler. */
  onCardRequest(handler: CardRequestHandler): void;
  /** Register the handler that answers an incoming `present.request`. */
  onPresentRequest(handler: PresentRequestHandler): void;
  /** Diagnostics seam for frames the session couldn't act on — see module
   *  doc. Returns an unsubscribe function. */
  onProtocolError(cb: (e: PearProtocolError) => void): () => void;
  /** Settles any outstanding requests with `err(...)`, stops listening, and
   *  closes the underlying channel. */
  close(): void;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

type PendingSettle<T> = ((r: Result<T, string>) => void) | null;

export function createPearSession(ch: AuthenticatedChannel, opts: PearSessionOptions = {}): PearSession {
  const timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let pendingCardSettle: PendingSettle<CardOfferResult> = null;
  let pendingPresentSettle: PendingSettle<PresentResponseResult> = null;

  let cardRequestHandler: CardRequestHandler | null = null;
  let presentRequestHandler: PresentRequestHandler | null = null;
  // Guards re-entrant incoming requests while a handler (e.g. a pending
  // consent sheet) hasn't resolved yet — see module doc.
  let cardRequestInFlight = false;
  let presentRequestInFlight = false;

  const protocolErrorListeners = new Set<(e: PearProtocolError) => void>();

  function reportProtocolError(frame: unknown, message: string): void {
    const e: PearProtocolError = { frame, message };
    for (const cb of protocolErrorListeners) cb(e);
  }

  function handleCardOfferFrame(frame: Record<string, unknown>): void {
    const settle = pendingCardSettle;
    if (!settle) {
      reportProtocolError(frame, 'card.offer received with no outstanding card.request');
      return;
    }
    const card = frame['card'];
    if (typeof card !== 'string') {
      pendingCardSettle = null;
      settle(err('malformed card.offer: missing string "card" field'));
      return;
    }
    const verified = verifyCompact(card, ch.peerDid);
    if (!verified.ok) {
      pendingCardSettle = null;
      settle(err(`card.offer failed verification: ${verified.error}`));
      return;
    }
    const parsed = parseProfile(verified.value);
    if (!parsed.ok) {
      pendingCardSettle = null;
      settle(err(`card.offer failed profile validation: ${parsed.error}`));
      return;
    }
    pendingCardSettle = null;
    settle(ok({ cardJws: card }));
  }

  function handleCardDeclineFrame(frame: Record<string, unknown>): void {
    const settle = pendingCardSettle;
    if (!settle) {
      reportProtocolError(frame, 'card.decline received with no outstanding card.request');
      return;
    }
    pendingCardSettle = null;
    settle(err('card request declined by peer'));
  }

  function handlePresentResponseFrame(frame: Record<string, unknown>): void {
    const settle = pendingPresentSettle;
    if (!settle) {
      reportProtocolError(frame, 'present.response received with no outstanding present.request');
      return;
    }
    const sdJwt = frame['sdJwt'];
    if (typeof sdJwt !== 'string') {
      pendingPresentSettle = null;
      settle(err('malformed present.response: missing string "sdJwt" field'));
      return;
    }
    pendingPresentSettle = null;
    settle(ok({ sdJwt }));
  }

  function handlePresentDeclineFrame(frame: Record<string, unknown>): void {
    const settle = pendingPresentSettle;
    if (!settle) {
      reportProtocolError(frame, 'present.decline received with no outstanding present.request');
      return;
    }
    pendingPresentSettle = null;
    settle(err('presentation request declined by peer'));
  }

  function handleIncomingCardRequest(frame: Record<string, unknown>): void {
    if (cardRequestInFlight) {
      // A second request while the first's handler (e.g. a consent sheet)
      // hasn't resolved yet — decline the new one outright rather than
      // invoking the handler again (see module doc).
      ch.send({ t: 'card.decline' });
      return;
    }
    const handler = cardRequestHandler;
    if (!handler) {
      ch.send({ t: 'card.decline' });
      return;
    }
    cardRequestInFlight = true;
    handler()
      .then((result) => {
        if ('cardJws' in result) {
          ch.send({ t: 'card.offer', card: result.cardJws });
        } else {
          ch.send({ t: 'card.decline' });
        }
      })
      .catch((e: unknown) => {
        reportProtocolError(frame, `card request handler threw — ${e instanceof Error ? e.message : String(e)}`);
        ch.send({ t: 'card.decline' });
      })
      .finally(() => {
        cardRequestInFlight = false;
      });
  }

  function handleIncomingPresentRequest(frame: Record<string, unknown>): void {
    const claims = frame['claims'];
    if (!isStringArray(claims)) {
      reportProtocolError(frame, 'malformed present.request: "claims" must be a string array');
      return;
    }
    if (presentRequestInFlight) {
      ch.send({ t: 'present.decline' });
      return;
    }
    const handler = presentRequestHandler;
    if (!handler) {
      ch.send({ t: 'present.decline' });
      return;
    }
    presentRequestInFlight = true;
    handler(claims)
      .then((result) => {
        if ('sdJwt' in result) {
          ch.send({ t: 'present.response', sdJwt: result.sdJwt });
        } else {
          ch.send({ t: 'present.decline' });
        }
      })
      .catch((e: unknown) => {
        reportProtocolError(frame, `present request handler threw — ${e instanceof Error ? e.message : String(e)}`);
        ch.send({ t: 'present.decline' });
      })
      .finally(() => {
        presentRequestInFlight = false;
      });
  }

  const unsubFrame = ch.onFrame((frame) => {
    if (!isRecord(frame)) {
      reportProtocolError(frame, 'frame did not decode to a JSON object');
      return;
    }
    const t = frame['t'];
    switch (t) {
      case 'card.request':
        handleIncomingCardRequest(frame);
        return;
      case 'card.offer':
        handleCardOfferFrame(frame);
        return;
      case 'card.decline':
        handleCardDeclineFrame(frame);
        return;
      case 'present.request':
        handleIncomingPresentRequest(frame);
        return;
      case 'present.response':
        handlePresentResponseFrame(frame);
        return;
      case 'present.decline':
        handlePresentDeclineFrame(frame);
        return;
      default:
        reportProtocolError(frame, `unknown pear protocol message type: ${JSON.stringify(t)}`);
        return;
    }
  });

  function requestCard(): Promise<Result<CardOfferResult, string>> {
    if (pendingCardSettle) {
      return Promise.resolve(err('a card request is already in flight on this session'));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCardSettle = null;
        resolve(err(`card.request timed out after ${String(timeoutMs)}ms with no response`));
      }, timeoutMs);
      pendingCardSettle = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      ch.send({ t: 'card.request' });
    });
  }

  function requestPresentation(claims: readonly string[]): Promise<Result<PresentResponseResult, string>> {
    if (pendingPresentSettle) {
      return Promise.resolve(err('a presentation request is already in flight on this session'));
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingPresentSettle = null;
        resolve(err(`present.request timed out after ${String(timeoutMs)}ms with no response`));
      }, timeoutMs);
      pendingPresentSettle = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      ch.send({ t: 'present.request', claims: [...claims] });
    });
  }

  function onCardRequest(handler: CardRequestHandler): void {
    cardRequestHandler = handler;
  }

  function onPresentRequest(handler: PresentRequestHandler): void {
    presentRequestHandler = handler;
  }

  function onProtocolError(cb: (e: PearProtocolError) => void): () => void {
    protocolErrorListeners.add(cb);
    return () => {
      protocolErrorListeners.delete(cb);
    };
  }

  function close(): void {
    unsubFrame();
    if (pendingCardSettle) {
      const settle = pendingCardSettle;
      pendingCardSettle = null;
      settle(err('pear session closed before a response arrived'));
    }
    if (pendingPresentSettle) {
      const settle = pendingPresentSettle;
      pendingPresentSettle = null;
      settle(err('pear session closed before a response arrived'));
    }
    ch.close();
  }

  return {
    requestCard,
    requestPresentation,
    onCardRequest,
    onPresentRequest,
    onProtocolError,
    close,
  };
}
