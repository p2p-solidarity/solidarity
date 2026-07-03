/**
 * A5.2 — effectful orchestration for both directions of the Pear v1
 * full-card exchange. Pure decision logic lives elsewhere so it's testable
 * without React/RN (`cardRequestState.ts`'s reducer, `cardRelease.ts`'s
 * consent-handler composition); this file just wires those to real lanes,
 * the real handshake, and the real `PearSession` — verified by typecheck +
 * reading, per the task brief ("UI wiring verified by typecheck + reading").
 *
 * Two hooks, one per direction:
 *
 *   `useCardRequestFlow(peerDid)` — REQUESTER. Drives
 *   `cardRequestReducer`'s connecting→authenticating→requesting→
 *   received/declined/error machine by joining `pearTopicFor(peerDid)` as a
 *   client, authenticating (Face ID for THIS side's challenge-response
 *   signature, inside `getRootSigner()`'s `Signer`), then
 *   `session.requestCard()`. One-shot: the lane is released as soon as the
 *   flow reaches a terminal phase (received/declined/error), and `start()`
 *   can be called again afterward to retry from scratch.
 *
 *   `useReachableMode(peerDid, peerLabel)` — RESPONDER, v1-scoped to ONE
 *   already-known, already-verified peer (see module doc below for why).
 *   Joins `pearTopicFor(myOwnDid)` as a server and WAITS — indefinitely,
 *   while this screen is mounted — for `peerDid` specifically to connect,
 *   then authenticates and registers a `cardRelease.ts`-composed
 *   `onCardRequest` handler that shows `consent.tsx`'s sheet and gates
 *   release behind Face ID.
 *
 * ── v1 scope limits (deliberate, documented here so nobody "fixes" them
 *    into scope creep) ──────────────────────────────────────────────────
 *
 * 1. "Reachable" is scoped to ONE peer, not "anyone who dials in". This
 *    isn't just a simplification — it's required by two things: (a)
 *    `handshake.ts`'s `authenticateChannel` needs `peerDid` up front to
 *    validate an incoming challenge is addressed correctly (it fails closed
 *    on a challenge whose `requester` doesn't match), so the responder must
 *    already know who it's willing to authenticate with; (b) `protocol.ts`'s
 *    `CardRequestHandler` takes NO arguments — it never learns which peer
 *    asked — so the ONLY honest way to show "who's asking" on the consent
 *    sheet (CLAUDE.md rule 8) is for the caller to already know, statically,
 *    which did this session is scoped to. Both point at the same v1 design:
 *    reachable-to-one-known-peer, not a general inbox.
 * 2. "Reachable while this screen is open" is literal, not marketing copy —
 *    there is no background responder. `laneManager.ts`'s AppState hook
 *    tears down every lane on backgrounding (see that module's doc), and
 *    this hook's own unmount cleanup releases the lane too. A user who
 *    backgrounds the app or navigates away stops being reachable; toggling
 *    back on re-arms it. A durable/background responder is out of scope for
 *    v1 (battery/lifecycle tradeoffs per 01-spec §8) — this is the same
 *    honesty tradeoff `pear-lane.tsx`'s cross-network lab already documents
 *    for its own timeouts.
 * 3. `useReachableMode` handles EVERY connection it sees on its topic —
 *    independently, each with its own handshake + (if authentication
 *    succeeds) its own `PearSession` — not just the first. This used to be
 *    "only the first `open` event is authenticated, later ones ignored" on
 *    the theory that `pearTopicFor(myDid)`'s preimage was effectively
 *    private to the intended peer. That premise was WRONG and was the root
 *    cause of a real card-leak bug (task A5.2 round-1 security fix,
 *    connection-scoping): `pearTopicFor` is an UNKEYED, non-secret hash of
 *    this device's own did — and the entire point of "reachable" is that an
 *    already-verified contact, who by definition already has this did from
 *    an earlier scan/exchange, can dial it. Anyone else who has ever seen
 *    that did (it's shown on a business card / QR / prior presentation) can
 *    compute the same topic and join it too, with no handshake required.
 *    "First connection wins" therefore let an uninvited third party who
 *    merely raced the real peer's connection attempt occupy the one
 *    handled slot — and, before the connection-scoping fix, even a SECOND,
 *    concurrent connection's raw frames were delivered to whatever session
 *    was authenticated on the first (topic-scoped `PearChannel.onFrame` had
 *    no concept of "which connection"). Every connId now gets its own
 *    `PearConnection` (`lane.ts`), so an uninvited connection's failed
 *    handshake can never block, delay, or leak data to a different,
 *    legitimate connection on the same topic — see `lane.ts`'s
 *    connection-scoping doc and this hook's `ConnAttempt`
 *    bookkeeping below.
 * 4. No caller — `useReachableMode` here, `useCardRequestFlow` below, or the
 *    `/dev/pear-lane.tsx` lab — can call `authenticateChannel` until a
 *    `connId` actually exists (the channel's `onCtrl` reports `'open'`):
 *    since the connection-scoping fix, `authenticateChannel` takes a
 *    `PearConnection` (`channel.connection(connId)`), which structurally
 *    cannot be constructed before a connId is known. This used to be a
 *    behavioural discipline only `useReachableMode` bothered with (the
 *    REQUESTER side and the dev lab called `authenticateChannel` on the
 *    topic-level channel immediately after `joinTopic`, relying on its
 *    internal `HANDSHAKE_TIMEOUT_MS` (15s) as a bounded "attempt this now or
 *    give up" budget) — it's now enforced for every caller by the type
 *    system. That still matters here specifically: `useReachableMode` is a
 *    passive, open-ended toggle, not a bounded dial, so it must never start
 *    a 15s "authenticate or CLOSE the connection" clock (`handshake.ts`'s
 *    `fail()`) before a peer has actually shown up — that would make
 *    "reachable" mode spuriously die on a stale connId, exactly the kind of
 *    fake "still working" state CLAUDE.md rule 8 forbids. Each incoming
 *    connId's 15s handshake budget only starts once THAT connection's
 *    `'open'` fires (`handleConnectionOpen` below), which is the correct
 *    bound for an actual handshake attempt.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { parseProfile, verifyCompact } from '@solidarity/shared';

import { useCredentialStore } from '@/credentials/store';
import { useIdentityData } from '@/identity';
import { requireBiometric } from '@/keychain/biometric';
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { useProfileStore } from '@/profile/store';

import { makeCardRequestHandler } from './cardRelease';
import {
  cardRequestReducer,
  type CardRequestEvent,
  type CardRequestPhase,
} from './cardRequestState';
import { askCardConsent, askPresentConsent } from './consent';
import { authenticateChannel } from './handshake';
import { ensureLane, releaseLane } from './laneManager';
import { firstConnection, pearTopicFor, type PearChannel } from './lane';
import { matchPresentableClaims } from './presentBuilder';
import { makePresentRequestHandler } from './presentRelease';
import { createPearSession, type PearSession } from './protocol';
// A5.3 — `buildPearPresentation` is the RESPONDER-side VP-building glue;
// it lives in `usePresentRequestFlow.ts` alongside the REQUESTER hook it
// was extracted with (see that module's doc), and is reused here for
// `useReachableMode`'s `onPresentRequest` handler below.
import { buildPearPresentation } from './usePresentRequestFlow';

const CARD_REQUEST_LANE_ID = 'pear:card-request';
const REACHABLE_LANE_ID = 'pear:reachable';

/** Bounds the `connecting` phase (lane join → hyperswarm `'open'`) for the
 *  REQUESTER only — generous relative to real DHT discovery + connect
 *  (typically low single-digit seconds per `pear-lane.tsx`'s own note),
 *  short enough that an unreachable peer reads as an honest error instead
 *  of an indefinite spinner. Not used by `useReachableMode` — see module
 *  doc point 4 for why that side waits unbounded instead. */
const CONNECT_TIMEOUT_MS = 30_000;

function rootKeyErrorDiagnostic(e: RootKeyError): string {
  switch (e.kind) {
    case 'notProvisioned':
      return 'no root identity is set up on this device yet';
    case 'biometricDenied':
      return 'biometric authentication was denied';
    case 'invalidMnemonic':
    case 'storageFailed':
      return e.message;
  }
}

export interface CardRequestFlow {
  readonly phase: CardRequestPhase;
  /** Begin (or retry, from any terminal phase) the full connect →
   *  authenticate → request sequence against `peerDid`. */
  readonly start: () => void;
  /** Abandon whatever's in flight and return to `idle`. */
  readonly reset: () => void;
}

/** REQUESTER side — see module doc. */
export function useCardRequestFlow(peerDid: string): CardRequestFlow {
  const [phase, dispatchRaw] = useReducer(cardRequestReducer, { kind: 'idle' } as CardRequestPhase);
  const mountedRef = useRef(true);
  const sessionRef = useRef<PearSession | null>(null);
  const unsubCtrlRef = useRef<(() => void) | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatch = useCallback((event: CardRequestEvent) => {
    if (mountedRef.current) dispatchRaw(event);
  }, []);

  const teardown = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    unsubCtrlRef.current?.();
    unsubCtrlRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    releaseLane(CARD_REQUEST_LANE_ID);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const start = useCallback(() => {
    teardown();
    dispatch({ type: 'start' });

    void getRootDid().then((didResult) => {
      if (!mountedRef.current) return;
      if (!didResult.ok) {
        dispatch({
          type: 'failed',
          error: { stage: 'connect', kind: 'connection', message: rootKeyErrorDiagnostic(didResult.error) },
        });
        return;
      }
      const myDid = didResult.value;

      void getRootSigner().then((signerResult) => {
        if (!mountedRef.current) return;
        if (!signerResult.ok) {
          dispatch({
            type: 'failed',
            error: { stage: 'connect', kind: 'connection', message: rootKeyErrorDiagnostic(signerResult.error) },
          });
          return;
        }

        const laneResult = ensureLane(CARD_REQUEST_LANE_ID);
        if (!laneResult.ok) {
          dispatch({
            type: 'failed',
            error: { stage: 'connect', kind: 'connection', message: laneResult.error.message },
          });
          return;
        }

        const topic = pearTopicFor(peerDid);
        const channel: PearChannel = laneResult.value.joinTopic(topic, 'client');

        connectTimeoutRef.current = setTimeout(() => {
          dispatch({
            type: 'failed',
            error: { stage: 'connect', kind: 'connection', message: 'timed out finding this peer' },
          });
          teardown();
        }, CONNECT_TIMEOUT_MS);

        unsubCtrlRef.current = channel.onCtrl((ev) => {
          if (!mountedRef.current) return;
          if (ev.ev === 'open') {
            dispatch({ type: 'connected' });
          } else if (ev.ev === 'error') {
            dispatch({ type: 'failed', error: { stage: 'connect', kind: 'connection', message: ev.message } });
            teardown();
          }
        });

        // A `mode:'client'` dial produces exactly one outbound connection —
        // `firstConnection` resolves with the `PearConnection` pinned to
        // that `connId` once it opens (connection-scoping fix, `lane.ts`'s
        // module doc). `authenticateChannel` (and the `PearSession` built
        // on it below) then only ever sends/receives on THAT connection.
        void firstConnection(channel).then((conn) => {
          if (!mountedRef.current) return;
          void authenticateChannel(conn, { myDid, peerDid, signer: signerResult.value }).then((authResult) => {
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            if (!mountedRef.current) return;
            if (!authResult.ok) {
              dispatch({
                type: 'failed',
                error: { stage: 'authenticate', kind: 'authentication', message: authResult.error },
              });
              teardown();
              return;
            }
            dispatch({ type: 'authenticated' });

            const session = createPearSession(authResult.value);
            sessionRef.current = session;

            void session.requestCard().then((cardResult) => {
              if (!mountedRef.current) return;
              if (!cardResult.ok) {
                if (cardResult.error.kind === 'declined') {
                  dispatch({ type: 'declined' });
                } else {
                  dispatch({
                    type: 'failed',
                    error: { stage: 'request', kind: cardResult.error.kind, message: cardResult.error.message },
                  });
                }
                teardown();
                return;
              }

              // Belt-and-suspenders re-derivation, not a new trust decision:
              // `protocol.ts` already verified `card.offer` (compact-JWS
              // signature by the peer's OWN did + schema-valid payload)
              // before resolving `ok(...)` — see that module's doc. Its
              // success type only carries the raw `cardJws` string though, so
              // this is the only way to get a `ProfileRecord` to render; both
              // calls are pure and deterministic over the SAME already-proven
              // inputs (`cardJws`, `peerDid`).
              const verified = verifyCompact(cardResult.value.cardJws, peerDid);
              if (!verified.ok) {
                dispatch({ type: 'failed', error: { stage: 'verify', kind: 'verification', message: verified.error } });
                teardown();
                return;
              }
              const parsed = parseProfile(verified.value);
              if (!parsed.ok) {
                dispatch({ type: 'failed', error: { stage: 'verify', kind: 'malformed', message: parsed.error } });
                teardown();
                return;
              }

              dispatch({ type: 'received', cardJws: cardResult.value.cardJws, record: parsed.value });
              teardown(); // one-shot — release the lane once we have what we came for
            });
          });
        });
      });
    });
  }, [dispatch, peerDid, teardown]);

  const reset = useCallback(() => {
    teardown();
    dispatch({ type: 'reset' });
  }, [dispatch, teardown]);

  return { phase, start, reset };
}

/** No raw diagnostic text ever reaches `ReachableStatus` — see
 *  `CardExchangeSection.tsx`'s `ERROR_I18N_SUFFIX` for the analogous
 *  requester-side pattern this mirrors. `'connection'` covers everything
 *  needed before a specific peer connection can even be evaluated (no
 *  local identity / signer, or the topic itself failed to join) — these
 *  are session-ending: `useReachableMode` stops and the user must retoggle.
 *  `'protocol'` covers a connection attempt that reached (and failed)
 *  mutual authentication — see `ConnAttempt`/`recomputeStatus` below for
 *  why that is deliberately NOT session-ending: anyone who has ever seen
 *  this device's did can dial the topic and predictably fail auth, so one
 *  failed attempt must never look like (or behave like) reachable mode
 *  being broken. */
export type ReachableErrorKind = 'connection' | 'protocol';

export type ReachableStatus =
  | { readonly kind: 'off' }
  | { readonly kind: 'listening' }
  | { readonly kind: 'authenticating' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly errorKind: ReachableErrorKind };

export interface ReachableMode {
  readonly status: ReachableStatus;
  readonly toggle: () => void;
}

/** Per-connection bookkeeping for `useReachableMode` — one entry per
 *  `connId` currently mid-handshake or already authenticated (see module
 *  doc point 3). Lives in a ref, not React state: it's an imperative
 *  in-flight/handle collection, not something that itself needs to be
 *  rendered (CLAUDE.md rule 9) — `status` is the one small derived value
 *  that does. */
interface ConnAttempt {
  /** `null` while the handshake for this connId is still in flight. */
  session: PearSession | null;
  unsubConnCtrl: (() => void) | null;
}

/** RESPONDER side, scoped to exactly `peerDid` — see module doc. `peerLabel`
 *  is a pre-formatted string (`formatPeerLabel(peerDid, verifiedDisplayName)`
 *  from the caller) shown on the consent sheet — this hook never derives
 *  display text from the wire. */
export function useReachableMode(peerDid: string, peerLabel: string): ReachableMode {
  const [status, setStatusRaw] = useState<ReachableStatus>({ kind: 'off' });
  const mountedRef = useRef(true);
  const unsubCtrlRef = useRef<(() => void) | null>(null);
  // One independent handshake/session attempt PER incoming connId — see
  // module doc point 3. An uninvited connection that fails its own
  // handshake never touches another connId's entry.
  const connectionsRef = useRef<Map<number, ConnAttempt>>(new Map());
  // The most recent PER-CONNECTION authentication failure kind, shown only
  // as a transient 'error' status when nothing is currently authenticating/
  // ready (see `recomputeStatus`) — self-heals the moment a new connection
  // starts handshaking, never requires the user to retoggle.
  const lastConnErrorRef = useRef<ReachableErrorKind | null>(null);

  const setStatus = useCallback((next: ReachableStatus) => {
    if (mountedRef.current) setStatusRaw(next);
  }, []);

  /** Recomputes the single displayed status from every in-flight/ready
   *  connection: 'ready' beats 'authenticating' beats a transient 'error'
   *  beats 'listening'. A rejected/uninvited connection attempt on some
   *  OTHER connId can never regress an already-`ready` legitimate session —
   *  and, symmetrically, a fresh connection attempt always supersedes a
   *  stale transient error instead of requiring an explicit clear. */
  const recomputeStatus = useCallback(() => {
    if (!mountedRef.current) return;
    const attempts = [...connectionsRef.current.values()];
    if (attempts.some((a) => a.session !== null)) {
      lastConnErrorRef.current = null;
      setStatus({ kind: 'ready' });
    } else if (attempts.length > 0) {
      setStatus({ kind: 'authenticating' });
    } else if (lastConnErrorRef.current) {
      setStatus({ kind: 'error', errorKind: lastConnErrorRef.current });
    } else {
      setStatus({ kind: 'listening' });
    }
  }, [setStatus]);

  /** Drops one connId's bookkeeping (unsubscribes its ctrl listener, closes
   *  its session if it had one) and recomputes the displayed status. Safe
   *  to call for a connId that's already gone. */
  const dropConnection = useCallback(
    (connId: number) => {
      const attempt = connectionsRef.current.get(connId);
      if (!attempt) return;
      attempt.unsubConnCtrl?.();
      attempt.session?.close();
      connectionsRef.current.delete(connId);
      recomputeStatus();
    },
    [recomputeStatus]
  );

  const teardown = useCallback(() => {
    unsubCtrlRef.current?.();
    unsubCtrlRef.current = null;
    for (const attempt of connectionsRef.current.values()) {
      attempt.unsubConnCtrl?.();
      attempt.session?.close();
    }
    connectionsRef.current.clear();
    lastConnErrorRef.current = null;
    releaseLane(REACHABLE_LANE_ID);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus({ kind: 'off' });
  }, [teardown, setStatus]);

  const start = useCallback(() => {
    teardown();
    setStatus({ kind: 'listening' });

    void getRootDid().then((didResult) => {
      if (!mountedRef.current) return;
      if (!didResult.ok) {
        setStatus({ kind: 'error', errorKind: 'connection' });
        return;
      }
      const myDid = didResult.value;

      const laneResult = ensureLane(REACHABLE_LANE_ID);
      if (!laneResult.ok) {
        setStatus({ kind: 'error', errorKind: 'connection' });
        return;
      }
      const topic = pearTopicFor(myDid);
      const channel: PearChannel = laneResult.value.joinTopic(topic, 'server');

      /** Runs an independent handshake + (on success) session attempt for
       *  one incoming connId — see module doc point 3. Never touches any
       *  other connId's `ConnAttempt`. */
      const handleConnectionOpen = (connId: number): void => {
        if (connectionsRef.current.has(connId)) return; // 'open' should only fire once per connId
        const conn = channel.connection(connId);
        const attempt: ConnAttempt = { session: null, unsubConnCtrl: null };
        connectionsRef.current.set(connId, attempt);
        recomputeStatus();

        attempt.unsubConnCtrl = conn.onCtrl((ev) => {
          if (ev.ev === 'close' || ev.ev === 'error') dropConnection(connId);
        });

        void getRootSigner().then((signerResult) => {
          if (!mountedRef.current) return;
          if (!connectionsRef.current.has(connId)) return; // already dropped while we awaited
          if (!signerResult.ok) {
            // Not specific to this connection — the whole device can't
            // produce a signer, so every future connection would fail
            // identically. Unlike a per-connection handshake failure (see
            // below), this genuinely ends the reachable session.
            conn.close();
            dropConnection(connId);
            setStatus({ kind: 'error', errorKind: 'connection' });
            teardown();
            return;
          }
          void authenticateChannel(conn, { myDid, peerDid, signer: signerResult.value }).then((authResult) => {
            if (!mountedRef.current) return;
            if (!connectionsRef.current.has(connId)) return; // already dropped while we awaited
            if (!authResult.ok) {
              // Routine/expected: THIS connection failed mutual
              // authentication — could be the uninvited-stranger case the
              // connection-scoping fix defends against (anyone who has seen
              // this device's did can dial the topic and predictably fail),
              // or just a dropped connect. `authenticateChannel` already
              // closed `conn`. Only this connId is torn down; a
              // concurrently-authenticating or already-`ready` legitimate
              // connection is completely unaffected — see module doc
              // point 3 and `recomputeStatus`.
              lastConnErrorRef.current = 'protocol';
              dropConnection(connId);
              return;
            }
            const session = createPearSession(authResult.value);
            session.onCardRequest(
              makeCardRequestHandler({
                askConsent: () => askCardConsent(peerLabel),
                requireBiometric: () => requireBiometric('cardRelease'),
                getCardJws: () => useProfileStore.getState().jws,
              })
            );
            // A5.3 — present is a peer of card-exchange on this SAME
            // connection-scoped session (`protocol.ts`'s `onCardRequest`/
            // `onPresentRequest` are independent handler slots on one
            // `PearSession`, not separate connections). `getMatchedClaims`/
            // `buildPresentation` re-read the credential/claim stores fresh
            // on every incoming request rather than closing over a stale
            // snapshot taken at `start()` time. `audienceDid: peerDid` is
            // THIS specific, already-authenticated requester's root did —
            // see `buildPearPresentation`'s doc for why that becomes the
            // VP's `aud`.
            session.onPresentRequest(
              makePresentRequestHandler({
                getMatchedClaims: (claimTypes) =>
                  matchPresentableClaims(
                    claimTypes,
                    useIdentityData.getState().provableClaims,
                    useCredentialStore.getState().details
                  ),
                askConsent: (matched) => askPresentConsent(peerLabel, matched),
                requireBiometric: () => requireBiometric('cardRelease'),
                buildPresentation: (selectedClaimIds) => buildPearPresentation(selectedClaimIds, peerDid),
              })
            );
            const current = connectionsRef.current.get(connId);
            if (current) current.session = session;
            recomputeStatus();
          });
        });
      };

      unsubCtrlRef.current = channel.onCtrl((ev) => {
        if (!mountedRef.current) return;
        if (ev.ev === 'open') {
          handleConnectionOpen(ev.connId);
        } else if (ev.ev === 'error' && ev.connId === undefined) {
          // Topic-wide failure (join failed / DHT bootstrap timed out) —
          // fatal for the whole reachable session, unlike a per-connection
          // error (handled inside `handleConnectionOpen`/`dropConnection`
          // above).
          setStatus({ kind: 'error', errorKind: 'connection' });
          teardown();
        }
      });
    });
  }, [peerDid, peerLabel, teardown, setStatus, recomputeStatus, dropConnection]);

  const toggle = useCallback(() => {
    if (status.kind === 'off' || status.kind === 'error') start();
    else stop();
  }, [status.kind, start, stop]);

  return { status, toggle };
}
