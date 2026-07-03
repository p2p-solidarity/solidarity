/**
 * A5.3 — REQUESTER side of the SD-JWT-over-Pear presentation flow, plus the
 * effectful VP-building glue (`buildPearPresentation`) shared with the
 * RESPONDER side (`useCardExchange.ts`'s `useReachableMode`, which wires
 * `onPresentRequest` on the SAME connection-scoped session that already
 * handles `onCardRequest` — present is a peer of card-exchange, not a
 * separate connection). Split out from `useCardExchange.ts` to keep that
 * file under its line budget; this hook otherwise belongs conceptually
 * alongside it and follows its exact conventions (module-scoped lane id,
 * connect-timeout bound, one-shot teardown-on-terminal-phase).
 *
 * Deliberately its own hook rather than refactored to share the
 * connect→authenticate boilerplate with `useCardRequestFlow`
 * (`useCardExchange.ts`) — a pragmatic call documented in A5.3's report:
 * that hook carries several security-invariant-bearing comments this task
 * chose not to risk disturbing for a DRY refactor with no test coverage of
 * the hook itself (only its pure reducer/handler pieces are unit tested —
 * see `cardRequestState.ts`/`cardRelease.ts`'s suites, and this file's
 * `presentRequestState.ts` analogue).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { useIdentityData } from '@/identity';
import { getRootDid, getRootSigner, type RootKeyError } from '@/identity/rootKey';
import { buildVpToken } from '@/oidc/presenter';
import { verifyVpToken } from '@/oidc/proofVerifier';

import { authenticateChannel } from './handshake';
import { ensureLane, releaseLane } from './laneManager';
import { firstConnection, pearTopicFor, type PearChannel } from './lane';
import { buildSyntheticPresentRequest } from './presentBuilder';
import type { BuildPresentationResult } from './presentRelease';
import {
  presentRequestReducer,
  type PresentRequestEvent,
  type PresentRequestPhase,
} from './presentRequestState';
import { createPearSession, type PearSession } from './protocol';

const PRESENT_REQUEST_LANE_ID = 'pear:present-request';

/** Mirrors `useCardExchange.ts`'s `CONNECT_TIMEOUT_MS` — same reasoning
 *  (bounds the REQUESTER's `connecting` phase only). */
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

/**
 * Build the SD-JWT (VP-wrapped) presentation for the Pear channel — the
 * effectful glue between `presentBuilder.ts`'s pure `buildSyntheticPresentRequest`
 * and the EXISTING, REUSED `oidc/presenter.ts::buildVpToken` (A5.3's "SD-JWT
 * 出示走既有 presenter" requirement — no VP-building logic is reimplemented
 * here). `audienceDid` is the REQUESTER's own root did — `ch.peerDid` from
 * the RESPONDER's side of the already-authenticated Pear connection — which
 * becomes the VP's `aud` claim, so the requester's own
 * `verifyVpToken({expectedAud: myRootDid})` call below can bind acceptance
 * to itself specifically. See `presentBuilder.ts`'s module doc for why
 * `nonce` doesn't round-trip a caller-chosen value. Exported for
 * `useCardExchange.ts`'s `useReachableMode` (the RESPONDER side) to reuse.
 *
 * `selectedClaimIds` are `PresentableClaim.id`s (e.g. `'claim-age-over-18'`)
 * — `presentRelease.ts`'s `PresentReleaseDeps.buildPresentation` contract,
 * which only carries ids forward past the consent sheet (never the fuller
 * `PresentableClaim` shape). `buildSyntheticPresentRequest`'s first param is
 * `requestedClaimTypes` though (e.g. `'age_over_18'`) — it becomes
 * `presentation_definition.input_descriptors[].id`, which
 * `oidc/presenter.ts::buildVpToken` echoes into the (currently-discarded-
 * by-this-function) `presentationSubmission.descriptor_map`. Passing the
 * raw ids straight through would silently mislabel every descriptor. So we
 * resolve ids -> claim TYPES here via `useIdentityData`, mirroring
 * `presenter.ts`'s own `rawCredentialIdsFor` id->entity lookup against the
 * exact same store.
 */
export async function buildPearPresentation(
  selectedClaimIds: readonly string[],
  audienceDid: string
): Promise<BuildPresentationResult> {
  const claimTypes = claimTypesForSelectedIds(selectedClaimIds);
  const request = buildSyntheticPresentRequest(claimTypes, audienceDid, cryptoRandomNonce());
  const result = await buildVpToken({ request, selectedClaimIds, holderDid: '' });
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true, sdJwt: result.value.vpJwt };
}

/** Resolve selected `PresentableClaim.id`s to their `claimType`s for
 *  `buildSyntheticPresentRequest`'s `requestedClaimTypes` param — see
 *  `buildPearPresentation`'s doc above for why this lookup exists.
 *  Deduped (two selected claims could theoretically share a type); ids
 *  that no longer resolve (claim vanished between match and build) are
 *  silently skipped, same as `rawCredentialIdsFor`'s "just omit it" stance
 *  — `buildVpToken` will itself fail closed with "No credentials selected"
 *  if that leaves nothing presentable. */
function claimTypesForSelectedIds(claimIds: readonly string[]): readonly string[] {
  const claims = useIdentityData.getState().provableClaims;
  const claimById = new Map(claims.map((c) => [c.id, c] as const));
  const types = new Set<string>();
  for (const id of claimIds) {
    const claim = claimById.get(id);
    if (claim) types.add(claim.claimType);
  }
  return Array.from(types);
}

/** Cryptographically-random hex nonce for the synthetic present request. */
function cryptoRandomNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PresentRequestFlow {
  readonly phase: PresentRequestPhase;
  /** Begin (or retry, from any terminal phase) the full connect →
   *  authenticate → request → LOCAL VERIFY sequence against `peerDid` for
   *  `claimTypes`. Callers should pass a stable `claimTypes` reference
   *  (e.g. a module-level constant) — a fresh array literal every render
   *  churns `start`'s identity without changing behaviour. */
  readonly start: () => void;
  /** Abandon whatever's in flight and return to `idle`. */
  readonly reset: () => void;
}

/**
 * REQUESTER side of A5.3's SD-JWT presentation. Mirrors
 * `useCardExchange.ts`'s `useCardRequestFlow` for the connect → authenticate
 * leg (same lane lifecycle, same connect-timeout bound, same one-shot
 * "tear down once a terminal phase is reached" contract). The one real
 * difference: after `session.requestPresentation` resolves with an
 * `sdJwt`, this hook does NOT treat that as done — it locally VERIFIES the
 * SD-JWT via the EXISTING, REUSED `oidc/proofVerifier.ts::verifyVpToken`
 * (in-channel, no HTTP), binding `expectedAud` to THIS device's own root
 * did (the audience the responder embedded, per `buildPearPresentation`'s
 * doc). Only a verify that actually passes (signature, expiry, aud, AND
 * holder binding — see `proofVerifier.ts`'s A5.3 hardening) reaches the
 * `verified` terminal phase; a throw is surfaced as `error` with
 * `kind: 'verification'`, never silently treated as success.
 */
export function usePresentRequestFlow(
  peerDid: string,
  claimTypes: readonly string[]
): PresentRequestFlow {
  const [phase, dispatchRaw] = useReducer(presentRequestReducer, { kind: 'idle' } as PresentRequestPhase);
  const mountedRef = useRef(true);
  const sessionRef = useRef<PearSession | null>(null);
  const unsubCtrlRef = useRef<(() => void) | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dispatch = useCallback((event: PresentRequestEvent) => {
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
    releaseLane(PRESENT_REQUEST_LANE_ID);
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

        const laneResult = ensureLane(PRESENT_REQUEST_LANE_ID);
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

            void session.requestPresentation(claimTypes).then((presentResult) => {
              if (!mountedRef.current) return;
              if (!presentResult.ok) {
                if (presentResult.error.kind === 'declined') {
                  dispatch({ type: 'declined' });
                } else {
                  dispatch({
                    type: 'failed',
                    error: { stage: 'request', kind: presentResult.error.kind, message: presentResult.error.message },
                  });
                }
                teardown();
                return;
              }

              const { sdJwt } = presentResult.value;
              void verifyVpToken(sdJwt, { expectedAud: myDid })
                .then((verified) => {
                  if (!mountedRef.current) return;
                  dispatch({ type: 'verified', sdJwt, verified });
                  teardown();
                })
                .catch((e: unknown) => {
                  if (!mountedRef.current) return;
                  const message = e instanceof Error ? e.message : String(e);
                  dispatch({
                    type: 'failed',
                    error: { stage: 'verify', kind: 'verification', message },
                  });
                  teardown();
                });
            });
          });
        });
      });
    });
  }, [dispatch, peerDid, claimTypes, teardown]);

  const reset = useCallback(() => {
    teardown();
    dispatch({ type: 'reset' });
  }, [dispatch, teardown]);

  return { phase, start, reset };
}
