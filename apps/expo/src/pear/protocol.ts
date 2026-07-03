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
 * `AuthenticatedChannel.send`/`onFrame`). Every message carries `reqId`, a
 * per-session monotonic integer the REQUESTER assigns and the RESPONDER
 * echoes back unchanged — see the "reqId correlates..." bullet below:
 *   `{t:'card.request', reqId}`                        → peer offers or declines
 *   `{t:'card.offer', card:<full-card JWS>, reqId}`     → the requester's answer
 *   `{t:'card.decline', reqId}`                         → the requester's answer (consent denied)
 *   `{t:'present.request', claims:string[], reqId}`     → peer offers or declines
 *   `{t:'present.response', sdJwt:string, reqId}`       → the requester's answer
 *   `{t:'present.decline', reqId}`                      → the requester's answer (consent denied)
 *
 * `PearSession` takes an `AuthenticatedChannel`, never a raw `PearChannel` —
 * that's a structural (type-level), not just behavioural, guarantee that no
 * application frame can be sent/received before mutual DID authentication:
 * there is no constructor path into this module that accepts anything less.
 * Since `handshake.ts` builds every `AuthenticatedChannel` from a single
 * connId-pinned `PearConnection` (the A5.2 connection-scoping security
 * fix — see `lane.ts`'s module doc), this module inherits connection
 * isolation for free: a `PearSession`'s `ch.send`/`ch.onFrame` can never
 * reach or be reached by a different connection on the same hyperswarm
 * topic, even an uninvited one that knows the topic (a bare hash of a did)
 * but never completed its own handshake.
 *
 * Hardening decisions (each one is a place a careless implementation could
 * hang forever, crash, or misattribute a response to the wrong request):
 *
 * - **`reqId` correlates a response to the exact request it answers, not
 *   just its TYPE.** Each session keeps one monotonic per-session counter;
 *   every `card.request`/`present.request` this side sends carries the
 *   next `reqId`, and the peer's session echoes that SAME `reqId` back on
 *   whatever it answers with — `card.offer`/`card.decline`/
 *   `present.response`/`present.decline`, including the auto-declines sent
 *   for "no handler registered" and "already handling one, decline the
 *   second". The requester's pending slot remembers the `reqId` it's
 *   waiting on; an incoming response is applied ONLY if its `reqId`
 *   matches — otherwise it's dropped as stale/unmatched (`onProtocolError`,
 *   the pending promise is left untouched). This is what makes a LATE
 *   answer to an already-timed-out request impossible to misattribute to a
 *   subsequently-issued request of the same type: request #2 gets a fresh
 *   `reqId`, so request #1's late answer (still carrying `reqId` #1) can
 *   never match request #2's pending slot — it stays pending until its own
 *   answer or its own timeout.
 * - **Still at most one outstanding request per TYPE.** `reqId` is additive
 *   correlation, not a queueing mechanism — a second call of the same type
 *   while one is in flight is still rejected immediately (`err`, no frame
 *   sent), not queued: queueing would still need this same correlation to
 *   tell two responses apart, so it wouldn't remove the requirement, only
 *   rename it. This is symmetric on the incoming side too: a second
 *   `card.request`/`present.request` arriving while the first is still
 *   awaiting its handler (e.g. a pending consent sheet) is auto-declined
 *   (echoing that second request's OWN `reqId`) without invoking the
 *   handler again, so a chatty or buggy peer can't trigger a second Face-ID
 *   prompt for one decision.
 * - **A request frame missing/non-numeric `reqId` is malformed.** Both
 *   peers run this exact module — there is no older wire shape to stay
 *   compatible with — so a `card.request`/`present.request` without a
 *   numeric `reqId` is reported via `onProtocolError` and dropped with no
 *   response sent, same as any other malformed incoming request.
 * - **Unknown message type → ignore-and-report, not close.** Unlike
 *   `handshake.ts` (pre-auth, where any deviation is inherently
 *   untrustworthy and the channel closes), a frame here comes from a peer
 *   whose DID is already cryptographically verified. Tearing down the whole
 *   session — and every other in-flight request — over one unrecognized or
 *   forward-compatible message type is disproportionate. The frame is
 *   dropped and surfaced via `onProtocolError` for diagnostics; the session
 *   stays usable.
 * - **A response with no matching outstanding request** — arrived after a
 *   timeout (or `close()`) already settled/freed that type's slot, arrived
 *   for a type never requested, two response types crossed, OR arrived
 *   carrying a `reqId` that doesn't match the CURRENTLY pending request of
 *   that type (a late answer to an earlier, now-superseded request) — is
 *   treated the same way: dropped + `onProtocolError`, never thrown, never
 *   misapplied to an unrelated (or merely same-TYPE-but-stale) pending
 *   promise.
 * - **Every outcome is a `Result<T, PearRequestError>`**, where
 *   `PearRequestError = {kind, message}` and `kind` is one of `'declined' |
 *   'timeout' | 'malformed' | 'verification' | 'protocol'` — so a consent
 *   UI (A5.2) can branch on `kind` instead of substring-matching `message`.
 *   `message` remains the existing human-readable diagnostic text.
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

/** Discriminant for `requestCard`/`requestPresentation` failures — lets a
 *  consent UI (A5.2) branch on outcome without substring-matching
 *  `message`. `message` stays the existing human-readable diagnostic. */
export type PearErrorKind = 'declined' | 'timeout' | 'malformed' | 'verification' | 'protocol';

export interface PearRequestError {
  readonly kind: PearErrorKind;
  readonly message: string;
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
  requestCard(): Promise<Result<CardOfferResult, PearRequestError>>;
  /** Ask the peer to present specific claims. Resolves once the peer
   *  answers (`present.response` or `present.decline`), or after timeout.
   *  Same one-at-a-time rule as `requestCard`. */
  requestPresentation(claims: readonly string[]): Promise<Result<PresentResponseResult, PearRequestError>>;
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

/** A requester's pending slot: the `reqId` it's waiting on (assigned when
 *  the request frame was sent) plus the callback that settles its promise.
 *  A response is only ever applied through `settle` if its own `reqId`
 *  matches — see the "reqId correlates..." module-doc bullet. */
interface PendingRequest<T> {
  readonly reqId: number;
  readonly settle: (r: Result<T, PearRequestError>) => void;
}

function pearErr(kind: PearErrorKind, message: string): Result<never, PearRequestError> {
  return err({ kind, message });
}

export function createPearSession(ch: AuthenticatedChannel, opts: PearSessionOptions = {}): PearSession {
  const timeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  let pendingCard: PendingRequest<CardOfferResult> | null = null;
  let pendingPresent: PendingRequest<PresentResponseResult> | null = null;

  // Single per-session monotonic counter shared by both request types — a
  // late answer to a card request and a late answer to a presentation
  // request can never collide on reqId either, which is stronger than
  // strictly necessary (the wire message `t` already disambiguates type)
  // but costs nothing and keeps the allocation logic in one place.
  let nextReqId = 1;
  function allocReqId(): number {
    const id = nextReqId;
    nextReqId += 1;
    return id;
  }

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

  /** `true` if `frame['reqId']` matches `pending.reqId` — the sole gate on
   *  whether an incoming response is allowed to settle anything. A missing
   *  `reqId` (`undefined`) never strictly-equals a real pending `reqId`, so
   *  it falls out of this the same way any other mismatch does. */
  function reqIdMatches<T>(frame: Record<string, unknown>, pending: PendingRequest<T>): boolean {
    return frame['reqId'] === pending.reqId;
  }

  function handleCardOfferFrame(frame: Record<string, unknown>): void {
    const pending = pendingCard;
    if (!pending) {
      reportProtocolError(frame, 'card.offer received with no outstanding card.request');
      return;
    }
    if (!reqIdMatches(frame, pending)) {
      reportProtocolError(
        frame,
        `card.offer reqId mismatch (expected ${String(pending.reqId)}, got ${JSON.stringify(frame['reqId'])}) — dropped as stale/unmatched, request stays pending`
      );
      return;
    }
    const card = frame['card'];
    if (typeof card !== 'string') {
      pendingCard = null;
      pending.settle(pearErr('malformed', 'malformed card.offer: missing string "card" field'));
      return;
    }
    const verified = verifyCompact(card, ch.peerDid);
    if (!verified.ok) {
      pendingCard = null;
      pending.settle(pearErr('verification', `card.offer failed verification: ${verified.error}`));
      return;
    }
    const parsed = parseProfile(verified.value);
    if (!parsed.ok) {
      pendingCard = null;
      pending.settle(pearErr('verification', `card.offer failed profile validation: ${parsed.error}`));
      return;
    }
    pendingCard = null;
    pending.settle(ok({ cardJws: card }));
  }

  function handleCardDeclineFrame(frame: Record<string, unknown>): void {
    const pending = pendingCard;
    if (!pending) {
      reportProtocolError(frame, 'card.decline received with no outstanding card.request');
      return;
    }
    if (!reqIdMatches(frame, pending)) {
      reportProtocolError(
        frame,
        `card.decline reqId mismatch (expected ${String(pending.reqId)}, got ${JSON.stringify(frame['reqId'])}) — dropped as stale/unmatched, request stays pending`
      );
      return;
    }
    pendingCard = null;
    pending.settle(pearErr('declined', 'card request declined by peer'));
  }

  function handlePresentResponseFrame(frame: Record<string, unknown>): void {
    const pending = pendingPresent;
    if (!pending) {
      reportProtocolError(frame, 'present.response received with no outstanding present.request');
      return;
    }
    if (!reqIdMatches(frame, pending)) {
      reportProtocolError(
        frame,
        `present.response reqId mismatch (expected ${String(pending.reqId)}, got ${JSON.stringify(frame['reqId'])}) — dropped as stale/unmatched, request stays pending`
      );
      return;
    }
    const sdJwt = frame['sdJwt'];
    if (typeof sdJwt !== 'string') {
      pendingPresent = null;
      pending.settle(pearErr('malformed', 'malformed present.response: missing string "sdJwt" field'));
      return;
    }
    pendingPresent = null;
    pending.settle(ok({ sdJwt }));
  }

  function handlePresentDeclineFrame(frame: Record<string, unknown>): void {
    const pending = pendingPresent;
    if (!pending) {
      reportProtocolError(frame, 'present.decline received with no outstanding present.request');
      return;
    }
    if (!reqIdMatches(frame, pending)) {
      reportProtocolError(
        frame,
        `present.decline reqId mismatch (expected ${String(pending.reqId)}, got ${JSON.stringify(frame['reqId'])}) — dropped as stale/unmatched, request stays pending`
      );
      return;
    }
    pendingPresent = null;
    pending.settle(pearErr('declined', 'presentation request declined by peer'));
  }

  function handleIncomingCardRequest(frame: Record<string, unknown>): void {
    const reqId = frame['reqId'];
    if (typeof reqId !== 'number') {
      reportProtocolError(frame, 'malformed card.request: missing numeric "reqId" field');
      return;
    }
    if (cardRequestInFlight) {
      // A second request while the first's handler (e.g. a consent sheet)
      // hasn't resolved yet — decline the new one outright rather than
      // invoking the handler again (see module doc). Echoes THIS request's
      // own reqId, not the first (in-flight) one's.
      ch.send({ t: 'card.decline', reqId });
      return;
    }
    const handler = cardRequestHandler;
    if (!handler) {
      ch.send({ t: 'card.decline', reqId });
      return;
    }
    cardRequestInFlight = true;
    handler()
      .then((result) => {
        if ('cardJws' in result) {
          ch.send({ t: 'card.offer', card: result.cardJws, reqId });
        } else {
          ch.send({ t: 'card.decline', reqId });
        }
      })
      .catch((e: unknown) => {
        reportProtocolError(frame, `card request handler threw — ${e instanceof Error ? e.message : String(e)}`);
        ch.send({ t: 'card.decline', reqId });
      })
      .finally(() => {
        cardRequestInFlight = false;
      });
  }

  function handleIncomingPresentRequest(frame: Record<string, unknown>): void {
    const reqId = frame['reqId'];
    if (typeof reqId !== 'number') {
      reportProtocolError(frame, 'malformed present.request: missing numeric "reqId" field');
      return;
    }
    const claims = frame['claims'];
    if (!isStringArray(claims)) {
      reportProtocolError(frame, 'malformed present.request: "claims" must be a string array');
      return;
    }
    if (presentRequestInFlight) {
      ch.send({ t: 'present.decline', reqId });
      return;
    }
    const handler = presentRequestHandler;
    if (!handler) {
      ch.send({ t: 'present.decline', reqId });
      return;
    }
    presentRequestInFlight = true;
    handler(claims)
      .then((result) => {
        if ('sdJwt' in result) {
          ch.send({ t: 'present.response', sdJwt: result.sdJwt, reqId });
        } else {
          ch.send({ t: 'present.decline', reqId });
        }
      })
      .catch((e: unknown) => {
        reportProtocolError(frame, `present request handler threw — ${e instanceof Error ? e.message : String(e)}`);
        ch.send({ t: 'present.decline', reqId });
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

  function requestCard(): Promise<Result<CardOfferResult, PearRequestError>> {
    if (pendingCard) {
      return Promise.resolve(pearErr('protocol', 'a card request is already in flight on this session'));
    }
    const reqId = allocReqId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCard = null;
        resolve(pearErr('timeout', `card.request timed out after ${String(timeoutMs)}ms with no response`));
      }, timeoutMs);
      pendingCard = {
        reqId,
        settle: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      };
      ch.send({ t: 'card.request', reqId });
    });
  }

  function requestPresentation(claims: readonly string[]): Promise<Result<PresentResponseResult, PearRequestError>> {
    if (pendingPresent) {
      return Promise.resolve(pearErr('protocol', 'a presentation request is already in flight on this session'));
    }
    const reqId = allocReqId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingPresent = null;
        resolve(pearErr('timeout', `present.request timed out after ${String(timeoutMs)}ms with no response`));
      }, timeoutMs);
      pendingPresent = {
        reqId,
        settle: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
      };
      ch.send({ t: 'present.request', claims: [...claims], reqId });
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
    if (pendingCard) {
      const pending = pendingCard;
      pendingCard = null;
      pending.settle(pearErr('protocol', 'pear session closed before a response arrived'));
    }
    if (pendingPresent) {
      const pending = pendingPresent;
      pendingPresent = null;
      pending.settle(pearErr('protocol', 'pear session closed before a response arrived'));
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
