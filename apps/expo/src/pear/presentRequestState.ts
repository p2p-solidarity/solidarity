/**
 * Pure state machine for the OUTGOING (requester) side of A5.3's SD-JWT
 * presentation — "connecting → authenticating → requesting →
 * verified/declined/error". Deliberately isolated from
 * `useCardExchange.ts`'s effectful orchestration, mirroring
 * `cardRequestState.ts`'s module doc almost verbatim: a `.ts` file with
 * zero RN-touching imports is safe for `bun test` to load directly.
 *
 * This machine has no `received` phase the way `cardRequestState.ts` does —
 * A5.3's requester doesn't just receive an opaque `sdJwt` string and stop;
 * it locally VERIFIES it (`oidc/proofVerifier.ts`'s `verifyVpToken`, reused
 * per the phase brief) before the flow can be considered done. `verified`
 * is therefore the one success terminal, carrying both the raw string (for
 * display/audit) and the verified result (holder + embedded credentials) —
 * never a phase that claims "received" without having actually checked it.
 *
 * Design notes (mirroring `cardRequestState.ts`):
 *   - `'start'` is accepted from `idle` AND from every terminal phase
 *     (`verified`/`declined`/`error`) — a "Try again" tap restarts the
 *     whole flow. No-op while a run is already in flight.
 *   - `'failed'` and `'reset'` are accepted from ANY phase.
 *   - Every other event is only honored from the ONE phase it's the
 *     expected successor of; an out-of-order event is dropped (phase
 *     unchanged) rather than corrupting the machine.
 */
import type { VerifiedVp } from '@/oidc/proofVerifier';

import type { PearErrorKind } from './protocol';

/** Which leg of the flow a failure happened in. `'verify'` is A5.3-specific
 *  — the local `verifyVpToken` call after a `present.response` arrives —
 *  and has no `cardRequestState.ts` analogue since the card-exchange flow
 *  never re-verifies past `protocol.ts`'s own signature check. */
export type PresentRequestErrorKind = PearErrorKind | 'connection' | 'authentication' | 'verification';

export type PresentRequestErrorStage = 'connect' | 'authenticate' | 'request' | 'verify';

export interface PresentRequestError {
  readonly stage: PresentRequestErrorStage;
  readonly kind: PresentRequestErrorKind;
  readonly message: string;
}

export type PresentRequestPhase =
  | { readonly kind: 'idle' }
  /** Lane joined, waiting for hyperswarm to actually connect the two sides. */
  | { readonly kind: 'connecting' }
  /** Channel open; running the mutual DID-challenge handshake. */
  | { readonly kind: 'authenticating' }
  /** Handshake done; `PearSession.requestPresentation()` is awaiting the
   *  peer's answer (response, decline, or timeout). */
  | { readonly kind: 'requesting' }
  /** The peer's `present.response` arrived AND `verifyVpToken` accepted it
   *  — signature, expiry, aud, and holder binding all checked. Only now is
   *  `verified.credentials` trustworthy to render. */
  | { readonly kind: 'verified'; readonly sdJwt: string; readonly verified: VerifiedVp }
  | { readonly kind: 'declined' }
  | { readonly kind: 'error'; readonly error: PresentRequestError };

export type PresentRequestEvent =
  | { readonly type: 'start' }
  | { readonly type: 'connected' }
  | { readonly type: 'authenticated' }
  | { readonly type: 'verified'; readonly sdJwt: string; readonly verified: VerifiedVp }
  | { readonly type: 'declined' }
  | { readonly type: 'failed'; readonly error: PresentRequestError }
  | { readonly type: 'reset' };

const TERMINAL_KINDS = new Set<PresentRequestPhase['kind']>(['idle', 'verified', 'declined', 'error']);

export function presentRequestReducer(
  phase: PresentRequestPhase,
  event: PresentRequestEvent
): PresentRequestPhase {
  // Always available — a failure or an explicit reset can cut any run short.
  if (event.type === 'failed') return { kind: 'error', error: event.error };
  if (event.type === 'reset') return { kind: 'idle' };

  if (event.type === 'start') {
    return TERMINAL_KINDS.has(phase.kind) ? { kind: 'connecting' } : phase;
  }

  switch (phase.kind) {
    case 'connecting':
      return event.type === 'connected' ? { kind: 'authenticating' } : phase;
    case 'authenticating':
      return event.type === 'authenticated' ? { kind: 'requesting' } : phase;
    case 'requesting':
      if (event.type === 'verified') {
        return { kind: 'verified', sdJwt: event.sdJwt, verified: event.verified };
      }
      if (event.type === 'declined') return { kind: 'declined' };
      return phase;
    case 'idle':
    case 'verified':
    case 'declined':
    case 'error':
      return phase;
  }
}
