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
 * 3. Only the FIRST connection `useReachableMode` sees on its topic is
 *    authenticated. A second, concurrent `open` event on the same topic
 *    while already authenticating/authenticated is ignored. For a
 *    reachable-to-one-peer topic this is already the expected case (nobody
 *    else can compute `pearTopicFor(myDid)`'s preimage without the did,
 *    which only the intended peer was given), so this is a defensive floor,
 *    not a real multi-peer feature gap.
 * 4. `useReachableMode` deliberately does NOT call `authenticateChannel`
 *    until the channel's `onCtrl` reports `'open'` — unlike
 *    `useCardRequestFlow` (REQUESTER) and the existing `/dev/pear-lane.tsx`
 *    lab, both of which call it immediately after `joinTopic` and rely on
 *    its internal `HANDSHAKE_TIMEOUT_MS` (15s) as a bounded "attempt this
 *    now or give up" budget. That's correct for an ACTIVE dial (the user
 *    just tapped "Request full card" and expects a bounded wait) but wrong
 *    for a passive, open-ended "reachable" toggle: `authenticateChannel`'s
 *    15s timer starts the instant it's called, REGARDLESS of whether a peer
 *    has connected yet, and on timeout it CLOSES the channel (see
 *    `handshake.ts`'s `fail()`). Calling it eagerly here would make
 *    "reachable" mode spuriously die ~15 seconds after being toggled on if
 *    the peer hasn't shown up yet — exactly the kind of fake "still
 *    working" state CLAUDE.md rule 8 forbids. Deferring to `'open'` means
 *    the 15s handshake budget only starts once a real connection exists,
 *    which is the correct bound for an actual handshake attempt.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { parseProfile, verifyCompact } from '@solidarity/shared';

import { requireBiometric } from '@/keychain/biometric';
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { useProfileStore } from '@/profile/store';

import { makeCardRequestHandler } from './cardRelease';
import {
  cardRequestReducer,
  type CardRequestEvent,
  type CardRequestPhase,
} from './cardRequestState';
import { askCardConsent } from './consent';
import { authenticateChannel } from './handshake';
import { ensureLane, releaseLane } from './laneManager';
import { pearTopicFor, type PearChannel } from './lane';
import { createPearSession, type PearSession } from './protocol';

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

        void authenticateChannel(channel, { myDid, peerDid, signer: signerResult.value }).then((authResult) => {
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
  }, [dispatch, peerDid, teardown]);

  const reset = useCallback(() => {
    teardown();
    dispatch({ type: 'reset' });
  }, [dispatch, teardown]);

  return { phase, start, reset };
}

export type ReachableStatus =
  | { readonly kind: 'off' }
  | { readonly kind: 'listening' }
  | { readonly kind: 'authenticating' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

export interface ReachableMode {
  readonly status: ReachableStatus;
  readonly toggle: () => void;
}

/** RESPONDER side, scoped to exactly `peerDid` — see module doc. `peerLabel`
 *  is a pre-formatted string (`formatPeerLabel(peerDid, verifiedDisplayName)`
 *  from the caller) shown on the consent sheet — this hook never derives
 *  display text from the wire. */
export function useReachableMode(peerDid: string, peerLabel: string): ReachableMode {
  const [status, setStatusRaw] = useState<ReachableStatus>({ kind: 'off' });
  const mountedRef = useRef(true);
  const sessionRef = useRef<PearSession | null>(null);
  const unsubCtrlRef = useRef<(() => void) | null>(null);

  const setStatus = useCallback((next: ReachableStatus) => {
    if (mountedRef.current) setStatusRaw(next);
  }, []);

  const teardown = useCallback(() => {
    unsubCtrlRef.current?.();
    unsubCtrlRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
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
        setStatus({ kind: 'error', message: rootKeyErrorDiagnostic(didResult.error) });
        return;
      }
      const myDid = didResult.value;

      const laneResult = ensureLane(REACHABLE_LANE_ID);
      if (!laneResult.ok) {
        setStatus({ kind: 'error', message: laneResult.error.message });
        return;
      }
      const topic = pearTopicFor(myDid);
      const channel: PearChannel = laneResult.value.joinTopic(topic, 'server');

      // See module doc point 4 — deferred to 'open' on purpose, unlike the
      // requester side above.
      let handshakeStarted = false;
      unsubCtrlRef.current = channel.onCtrl((ev) => {
        if (!mountedRef.current) return;
        if (ev.ev === 'open' && !handshakeStarted) {
          // Only the first connection on this topic is handled — see
          // module doc point 3.
          handshakeStarted = true;
          setStatus({ kind: 'authenticating' });

          void getRootSigner().then((signerResult) => {
            if (!mountedRef.current) return;
            if (!signerResult.ok) {
              setStatus({ kind: 'error', message: rootKeyErrorDiagnostic(signerResult.error) });
              teardown();
              return;
            }
            void authenticateChannel(channel, { myDid, peerDid, signer: signerResult.value }).then((authResult) => {
              if (!mountedRef.current) return;
              if (!authResult.ok) {
                setStatus({ kind: 'error', message: authResult.error });
                teardown();
                return;
              }
              const session = createPearSession(authResult.value);
              sessionRef.current = session;
              session.onCardRequest(
                makeCardRequestHandler({
                  askConsent: () => askCardConsent(peerLabel),
                  requireBiometric: () => requireBiometric('exchange'),
                  getCardJws: () => useProfileStore.getState().jws,
                })
              );
              setStatus({ kind: 'ready' });
            });
          });
        } else if (ev.ev === 'error') {
          setStatus({ kind: 'error', message: ev.message });
          teardown();
        }
      });
    });
  }, [peerDid, peerLabel, teardown, setStatus]);

  const toggle = useCallback(() => {
    if (status.kind === 'off' || status.kind === 'error') start();
    else stop();
  }, [status.kind, start, stop]);

  return { status, toggle };
}
