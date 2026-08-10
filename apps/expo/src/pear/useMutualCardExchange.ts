/**
 * T5 — effectful INITIATOR orchestration for the Pear v1 MUTUAL card exchange
 * (`mutualExchange.ts`). Mirrors `useCardExchange.ts`'s `useCardRequestFlow`
 * (lane join → `firstConnection` → `authenticateChannel` → session), but
 * instead of a one-way `requestCard` it runs `createMutualExchange(...)
 * .startExchange(...)`: it OFFERS this device's public card and, on the
 * peer's accept, saves the peer's card independently (Part-A `mergeVerified`)
 * while the peer saves ours. The RESPONDER half lives in
 * `useCardExchange.ts`'s `useReachableMode` (registered per authenticated
 * connection) — see that module's doc.
 *
 * HONESTY (CLAUDE.md rule 8 + research §5): the exchange is NOT atomic. The
 * terminal `done` phase carries a `MutualExchangeResult` whose two axes are
 * surfaced SEPARATELY and never conflated — `localSave` ("saved on this
 * device") and `peerReceipt` (a concrete status = "peer confirmed", or
 * `'unknown'` = "peer confirmation unknown"). A dropped receipt yields
 * `peerReceipt: 'unknown'`, NEVER a rolled-back local save.
 *
 * `exchangeId` is generated ONCE per hook instance and reused across retries
 * (`start()` again) so a same-session retry dedupes on the peer; a fresh mount
 * gets a fresh id. Deeper cross-reconnect idempotency is guaranteed by the
 * save itself (`mergeVerified` → `alreadyCurrent`), not by this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { uuid } from '@solidarity/shared';

import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';

import { authenticateChannel } from './handshake';
import { ensureLane, releaseLane } from './laneManager';
import { firstConnection, pearTopicFor, type PearChannel } from './lane';
import { buildOwnOffer, createIncomingCardSaver } from './mutualExchangeGlue';
import { createMutualExchange, type MutualExchange, type MutualExchangeResult } from './mutualExchange';
import type { CardRequestError } from './cardRequestState';

const MUTUAL_EXCHANGE_LANE_ID = 'pear:mutual-exchange';

/** Same generous DHT-discovery bound as `useCardRequestFlow`'s connect leg. */
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

export type MutualExchangePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'authenticating' }
  | { readonly kind: 'exchanging' }
  | { readonly kind: 'done'; readonly result: MutualExchangeResult }
  | { readonly kind: 'declined' }
  | { readonly kind: 'error'; readonly error: CardRequestError };

export interface MutualExchangeFlow {
  readonly phase: MutualExchangePhase;
  /** Begin (or retry, from any terminal phase) the connect → authenticate →
   *  exchange sequence against `peerDid`. */
  readonly start: () => void;
  /** Abandon whatever's in flight and return to `idle`. */
  readonly reset: () => void;
}

export function useMutualCardExchange(peerDid: string): MutualExchangeFlow {
  const [phase, setPhaseRaw] = useState<MutualExchangePhase>({ kind: 'idle' });
  const mountedRef = useRef(true);
  const exchangeRef = useRef<MutualExchange | null>(null);
  const unsubCtrlRef = useRef<(() => void) | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable across retries within this hook instance (see module doc).
  const exchangeIdRef = useRef<string>(uuid());

  const setPhase = useCallback((next: MutualExchangePhase) => {
    if (mountedRef.current) setPhaseRaw(next);
  }, []);

  const teardown = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    unsubCtrlRef.current?.();
    unsubCtrlRef.current = null;
    exchangeRef.current?.close();
    exchangeRef.current = null;
    releaseLane(MUTUAL_EXCHANGE_LANE_ID);
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
    const saveIncoming = createIncomingCardSaver();

    // No signed profile on this device → nothing honest to offer; fail before
    // opening a channel rather than dialing and then declining silently.
    const offer = buildOwnOffer();
    if (!offer) {
      setPhase({
        kind: 'error',
        error: { stage: 'connect', kind: 'connection', message: 'no profile saved on this device to exchange' },
      });
      return;
    }

    setPhase({ kind: 'connecting' });

    void getRootDid().then((didResult) => {
      if (!mountedRef.current) return;
      if (!didResult.ok) {
        setPhase({
          kind: 'error',
          error: { stage: 'connect', kind: 'connection', message: rootKeyErrorDiagnostic(didResult.error) },
        });
        return;
      }
      const myDid = didResult.value;

      void getRootSigner().then((signerResult) => {
        if (!mountedRef.current) return;
        if (!signerResult.ok) {
          setPhase({
            kind: 'error',
            error: { stage: 'connect', kind: 'connection', message: rootKeyErrorDiagnostic(signerResult.error) },
          });
          return;
        }

        const laneResult = ensureLane(MUTUAL_EXCHANGE_LANE_ID);
        if (!laneResult.ok) {
          setPhase({
            kind: 'error',
            error: { stage: 'connect', kind: 'connection', message: laneResult.error.message },
          });
          return;
        }

        const topic = pearTopicFor(peerDid);
        const channel: PearChannel = laneResult.value.joinTopic(topic, 'client');

        connectTimeoutRef.current = setTimeout(() => {
          setPhase({
            kind: 'error',
            error: { stage: 'connect', kind: 'connection', message: 'timed out finding this peer' },
          });
          teardown();
        }, CONNECT_TIMEOUT_MS);

        unsubCtrlRef.current = channel.onCtrl((ev) => {
          if (!mountedRef.current) return;
          if (ev.ev === 'error') {
            setPhase({ kind: 'error', error: { stage: 'connect', kind: 'connection', message: ev.message } });
            teardown();
          }
        });

        void firstConnection(channel).then((conn) => {
          if (!mountedRef.current) return;
          setPhase({ kind: 'authenticating' });
          void authenticateChannel(conn, { myDid, peerDid, signer: signerResult.value }).then((authResult) => {
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
            if (!mountedRef.current) return;
            if (!authResult.ok) {
              setPhase({
                kind: 'error',
                error: { stage: 'authenticate', kind: 'authentication', message: authResult.error },
              });
              teardown();
              return;
            }

            const exchange = createMutualExchange(authResult.value);
            exchangeRef.current = exchange;
            setPhase({ kind: 'exchanging' });

            void exchange
              .startExchange({ exchangeId: exchangeIdRef.current, offer, saveIncoming })
              .then((result) => {
                if (!mountedRef.current) return;
                if (!result.ok) {
                  if (result.error.kind === 'declined') {
                    setPhase({ kind: 'declined' });
                  } else {
                    setPhase({
                      kind: 'error',
                      error: { stage: 'request', kind: result.error.kind, message: result.error.message },
                    });
                  }
                  teardown();
                  return;
                }
                setPhase({ kind: 'done', result: result.value });
                teardown(); // one-shot — release the lane; the save already persisted
              });
          });
        });
      });
    });
  }, [peerDid, teardown, setPhase]);

  const reset = useCallback(() => {
    teardown();
    setPhase({ kind: 'idle' });
  }, [teardown, setPhase]);

  return { phase, start, reset };
}
