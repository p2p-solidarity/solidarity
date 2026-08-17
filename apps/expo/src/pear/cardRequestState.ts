/**
 * Pure state machine for the OUTGOING (requester) side of A5.2's full-card
 * exchange — "connecting → authenticating → requesting →
 * received/declined/error", per the phase brief. Deliberately isolated
 * from `useCardExchange.ts`'s effectful orchestration (lane join, hyperswarm
 * `onCtrl`, `authenticateChannel`, `createPearSession`) so the transition
 * table itself is unit-testable without touching React, React Native, or
 * `react-native-bare-kit` — same reasoning as `rootKey.ts`'s lazy-load
 * module doc: a `.ts` file with zero RN-touching imports is safe for `bun
 * test` to load directly.
 *
 * Design notes:
 *   - `'start'` is accepted from `idle` AND from every terminal phase
 *     (`received`/`declined`/`error`) — a "Try again" tap must be able to
 *     restart the whole flow. It's a no-op (ignored, current phase kept)
 *     while a run is already in flight (`connecting`/`authenticating`/
 *     `requesting`) so a double-tap can't fire two overlapping attempts.
 *   - `'failed'` and `'reset'` are accepted from ANY phase — a failure or
 *     an explicit reset can always cut a run short, matching
 *     `protocol.ts`'s own "fail closed, never leave the caller hanging"
 *     posture.
 *   - Every other event is only honored from the ONE phase it's the
 *     expected successor of. An out-of-order event (e.g. `'authenticated'`
 *     while still `idle`, or `'received'` while `connecting`) is dropped —
 *     the phase is returned unchanged — rather than corrupting the machine
 *     by skipping steps. This mirrors A5.1's own "亂序/未驗先送 → 拒收"
 *     (out-of-order / unverified-first → reject) TDD theme in `protocol.ts`.
 */
import type { ProfileRecord } from '@solidarity/shared';

import type { PearErrorKind } from './protocol';

/** Which leg of the flow a failure happened in — `protocol.ts`'s
 *  `PearErrorKind` only covers the request/response wire protocol itself
 *  (`'declined'|'timeout'|'malformed'|'verification'|'protocol'`); the two
 *  extra members here cover the legs BEFORE a `PearSession` even exists:
 *  finding/opening a channel to the peer (`'connection'`), and the mutual
 *  DID-challenge handshake (`'authentication'`, `handshake.ts` — which
 *  returns a plain `Result<_, string>`, not a typed error kind, so this is
 *  a coarser bucket than the wire-protocol kinds). */
export type CardRequestErrorKind = PearErrorKind | 'connection' | 'authentication';

/**
 * `CardRequestErrorKind` → `pearExchange.request.error.<suffix>` i18n key
 * suffix. Single source of truth for the mapping both `PearConnectSection`
 * and `CardExchangeSection` render (was copy-pasted between the two —
 * code-review Finding 2, Task A5.4 follow-up).
 */
export const CARD_REQUEST_ERROR_I18N_SUFFIX: Readonly<Record<CardRequestErrorKind, string>> = {
  declined: 'declined',
  timeout: 'timeout',
  malformed: 'malformed',
  verification: 'verification',
  protocol: 'protocol',
  connection: 'connection',
  authentication: 'authentication',
};

export type CardRequestErrorStage = 'connect' | 'authenticate' | 'request' | 'verify';

export interface CardRequestError {
  readonly stage: CardRequestErrorStage;
  readonly kind: CardRequestErrorKind;
  readonly message: string;
}

export type CardRequestPhase =
  | { readonly kind: 'idle' }
  /** Lane joined, waiting for hyperswarm to actually connect the two sides. */
  | { readonly kind: 'connecting' }
  /** Channel open; running the mutual DID-challenge handshake (Face ID for
   *  this side's challenge-response signature happens here). */
  | { readonly kind: 'authenticating' }
  /** Handshake done; `PearSession.requestCard()` is awaiting the peer's
   *  answer (offer, decline, or timeout). */
  | { readonly kind: 'requesting' }
  /** The peer's `card.offer` verified (compact-JWS signature by the peer's
   *  own did + schema-valid payload) — `record`/`cardJws` are trustworthy. */
  | { readonly kind: 'received'; readonly cardJws: string; readonly record: ProfileRecord }
  | { readonly kind: 'declined' }
  | { readonly kind: 'error'; readonly error: CardRequestError };

export type CardRequestEvent =
  | { readonly type: 'start' }
  | { readonly type: 'connected' }
  | { readonly type: 'authenticated' }
  | { readonly type: 'received'; readonly cardJws: string; readonly record: ProfileRecord }
  | { readonly type: 'declined' }
  | { readonly type: 'failed'; readonly error: CardRequestError }
  | { readonly type: 'reset' };

const TERMINAL_KINDS = new Set<CardRequestPhase['kind']>(['idle', 'received', 'declined', 'error']);

export function cardRequestReducer(phase: CardRequestPhase, event: CardRequestEvent): CardRequestPhase {
  // Always available — a failure or an explicit reset can cut any run short.
  if (event.type === 'failed') return { kind: 'error', error: event.error };
  if (event.type === 'reset') return { kind: 'idle' };

  if (event.type === 'start') {
    // Restart from idle or any terminal phase; ignore a duplicate tap while
    // a run is already in flight (see module doc).
    return TERMINAL_KINDS.has(phase.kind) ? { kind: 'connecting' } : phase;
  }

  switch (phase.kind) {
    case 'connecting':
      return event.type === 'connected' ? { kind: 'authenticating' } : phase;
    case 'authenticating':
      return event.type === 'authenticated' ? { kind: 'requesting' } : phase;
    case 'requesting':
      if (event.type === 'received') return { kind: 'received', cardJws: event.cardJws, record: event.record };
      if (event.type === 'declined') return { kind: 'declined' };
      return phase;
    case 'idle':
    case 'received':
    case 'declined':
    case 'error':
      // Terminal or not-yet-started — every remaining event type
      // ('connected'/'authenticated'/'received'/'declined') is only valid
      // from its one expected predecessor phase above, so anything else
      // reaching here is out of order and dropped.
      return phase;
  }
}
