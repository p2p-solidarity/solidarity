/**
 * Pear v1 MUTUAL card exchange (Task T5, research `notes-1.3.3-...` §5) — a
 * symmetric, two-way full-card swap riding on the SAME already-authenticated
 * `AuthenticatedChannel` (`handshake.ts`) as `protocol.ts`'s one-way session.
 * Where `protocol.ts` is strictly REQUEST→RESPONSE (one side asks, the other
 * answers), this is:
 *
 *   request → accept | decline → DUAL offer → each verifies + saves
 *   independently → DUAL receipt
 *
 * Once BOTH peers consent, EACH sends its own signed PUBLIC `ProfileRecord`,
 * EACH verifies + saves the other's independently (via the injected Part-A
 * `mergeVerified` freshness/conflict policy), and EACH sends a receipt telling
 * the other what it did with the received card. Only the PUBLIC ProfileRecord
 * flows here — VC / private-claim presentation is the separate `present.*`
 * flow (`protocol.ts` / `usePresentRequestFlow.ts`), out of scope.
 *
 * Wire frames (length-prefixed JSON, `frames.ts` codec, over `AuthenticatedChannel`):
 *   {t:'card.exchange.request', reqId, exchangeId, v, digest, size, updatedAt}
 *   {t:'card.exchange.accept',  reqId, exchangeId}
 *   {t:'card.exchange.decline', reqId, exchangeId}
 *   {t:'card.exchange.offer',   exchangeId, card:<compact JWS>, digest}
 *   {t:'card.exchange.receipt', exchangeId, digest, status}
 *
 * TWO correlation ids, each with a distinct job:
 *   - `reqId`      — a per-session monotonic int (mirrors `protocol.ts`).
 *     Correlates an accept/decline back to the exact request it answers.
 *   - `exchangeId` — a RANDOM id the caller supplies, STABLE across retry /
 *     reconnect. It scopes the offer + receipt legs and, within one live
 *     session, DEDUPES a duplicate request frame so a chatty/retrying peer
 *     can never trigger a second consent prompt for the same exchange. Deeper
 *     idempotency across a full reconnect is guaranteed by the SAVE itself
 *     being content-idempotent (`mergeVerified` → `alreadyCurrent`), not by
 *     this session remembering anything.
 *
 * Coexistence: this module attaches its OWN `ch.onFrame` listener and acts on
 * `card.exchange.*` frames only — every other frame type is silently ignored
 * (it belongs to a co-mounted `PearSession` on the same channel). Symmetric-
 * ally, `protocol.ts` ignores `card.exchange.*` so neither reports the other's
 * traffic as an unknown-type protocol error.
 *
 * HONESTY (CLAUDE.md rule 8 + research §5):
 *   - The exchange is NOT atomic and makes NO fairness promise. A peer can
 *     accept, receive your offer, then disconnect before its receipt reaches
 *     you. `localSave` (what WE did with THEIR card) and `peerReceipt` (what
 *     THEY reported doing with OURS) are therefore reported as two INDEPENDENT
 *     values that are never conflated: `peerReceipt: 'unknown'` means exactly
 *     "we never heard back", NOT "they failed". We NEVER roll back a completed
 *     local save because an ack went missing.
 *   - `saveIncoming` is INJECTED — this module never touches the store. It
 *     does the trust checks (verify the offered JWS against the AUTHENTICATED
 *     `ch.peerDid`, strict `parseProfile`, `record.did === peerDid`, size /
 *     updatedAt-shape limits) and hands a PROVEN record to the caller's merge,
 *     so `profileSnapshots.mergeVerified` stays the single place a card is
 *     actually persisted.
 *   - At most one exchange is active per session (initiating or responding).
 *     A second concurrent request (different `exchangeId`) is auto-declined —
 *     no interleaving, no misattribution.
 */
import {
  bytesToHex,
  err,
  ok,
  parseProfile,
  sha256Bytes,
  stableJSON,
  verifyCompact,
  type ProfileRecord,
  type Result,
} from '@solidarity/shared';

import type { AuthenticatedChannel } from './handshake';
import type { PearErrorKind, PearProtocolError, PearRequestError } from './protocol';

/** Hard cap on an offered card's compact-JWS length. Well under `frames.ts`'s
 *  64 KiB frame cap — a public ProfileRecord card is a few KiB at most. */
export const MAX_EXCHANGE_CARD_BYTES = 32 * 1024;

/** No progress within this window settles the exchange with whatever partial
 *  state exists (never hangs, never rolls back a save). */
export const DEFAULT_EXCHANGE_TIMEOUT_MS = 30_000;

/** The four `SnapshotMergeOutcome` kinds a verified save can produce — kept in
 *  lockstep with `profileSnapshots.SnapshotMergeOutcome['kind']` (a test pins
 *  the alignment). */
export type MergeKind = 'saved' | 'alreadyCurrent' | 'keptNewer' | 'conflict';

/** What we did with the peer's offered card. `'failed'` = it never passed the
 *  trust checks (`saveIncoming` was never called). */
export type IncomingSaveStatus = MergeKind | 'failed';

/** "Saved on this device" — how WE handled the peer's card. `'notReceived'`
 *  means the peer never sent (or we never got) their offer. */
export type LocalSaveOutcome = IncomingSaveStatus | 'notReceived';

/** "Peer confirmed saving" (a concrete status) vs "peer confirmation unknown"
 *  (`'unknown'`) — how THE PEER reported handling OUR card. */
export type PeerReceiptOutcome = IncomingSaveStatus | 'unknown';

const SAVE_STATUSES: ReadonlySet<string> = new Set<IncomingSaveStatus>([
  'saved',
  'alreadyCurrent',
  'keptNewer',
  'conflict',
  'failed',
]);

/** Verify-passed incoming card → local merge, returning the merge kind. The
 *  ONLY hook that touches persistent state; the module never calls the store. */
export type SaveIncoming = (
  record: ProfileRecord,
  jws: string,
) => IncomingSaveStatus;

/** Our own card to offer: the compact JWS plus its parsed record (the module
 *  derives digest / size / updatedAt / version from these, so the caller can't
 *  advertise something inconsistent with what it actually sends). */
export interface CardExchangeOffer {
  readonly card: string;
  readonly record: ProfileRecord;
}

/** The advertised summary of an incoming `card.exchange.request` handed to the
 *  responder's consent handler — never the raw card (that only crosses the
 *  wire as an `offer`, after both sides consent). */
export interface IncomingExchangeRequest {
  readonly exchangeId: string;
  readonly v: number;
  readonly digest: string;
  readonly size: number;
  readonly updatedAt: string;
}

export type ExchangeDecision =
  | { readonly accept: true; readonly offer: CardExchangeOffer }
  | { readonly accept: false };

/** The two independent honesty axes — see the module doc. */
export interface MutualExchangeResult {
  readonly exchangeId: string;
  readonly localSave: LocalSaveOutcome;
  readonly peerReceipt: PeerReceiptOutcome;
}

export interface StartExchangeInput {
  readonly exchangeId: string;
  readonly offer: CardExchangeOffer;
  readonly saveIncoming: SaveIncoming;
  readonly timeoutMs?: number;
}

export interface ExchangeResponderConfig {
  /** Consent gate for an incoming request. Returns our card to offer on
   *  accept, or an explicit decline. */
  readonly decide: (req: IncomingExchangeRequest) => Promise<ExchangeDecision>;
  readonly saveIncoming: SaveIncoming;
  /** Observe the RESPONDER-side outcome once its exchange settles (both saves
   *  in, or timeout/close with partials). */
  readonly onComplete?: (result: MutualExchangeResult) => void;
  readonly timeoutMs?: number;
}

export interface MutualExchange {
  /** INITIATOR: run a full mutual exchange against the peer. Resolves `err`
   *  BEFORE any card material moves (declined / timeout waiting for the
   *  accept / session closed pre-accept). Once the peer ACCEPTS, always
   *  resolves `ok(result)` describing what we know — partial results included,
   *  never rolled back. One exchange at a time per session. */
  startExchange(input: StartExchangeInput): Promise<Result<MutualExchangeResult, PearRequestError>>;
  /** RESPONDER: register the consent/offer/save config for an INCOMING
   *  request. Replaces any previously-registered config. */
  onExchangeRequest(config: ExchangeResponderConfig): void;
  /** Diagnostics seam for `card.exchange.*` frames that couldn't be acted on
   *  (orphaned, malformed, mismatched). Returns an unsubscribe function. */
  onProtocolError(cb: (e: PearProtocolError) => void): () => void;
  /** Settles any active exchange (partials for an in-progress one, `err` for
   *  a pre-accept initiator) and closes the underlying channel. */
  close(): void;
}

export interface MutualExchangeOptions {
  /** Test-only default-timeout override; production callers pass per-exchange
   *  `timeoutMs` instead. */
  readonly timeoutMs?: number;
}

/** Failure detail from `evaluateIncomingOffer` — opaque diagnostic string. */
export interface OfferEvalError {
  readonly reason: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mkErr(kind: PearErrorKind, message: string): Result<never, PearRequestError> {
  return err({ kind, message });
}

/** SHA-256(canonical(record)), hex — a stable content fingerprint used to
 *  advertise a card in a request and to tie a receipt back to the exact card
 *  it acknowledges. */
export function profileDigest(record: ProfileRecord): string {
  return bytesToHex(sha256Bytes(stableJSON(record)));
}

/**
 * Trust-check an incoming offered card against the AUTHENTICATED peer DID.
 * Pure and store-free so it's unit-testable in isolation. Order matters:
 *   1. size cap (before any parse work)
 *   2. compact-JWS signature verifies against `peerDid` (the card is
 *      self-attested by whoever offers it — the peer)
 *   3. decoded payload is a schema-valid `ProfileRecord`
 *   4. `record.did === peerDid` (reject a validly-signed card whose embedded
 *      DID isn't the peer's own — the "wrong-peer" case)
 */
export function evaluateIncomingOffer(
  card: string,
  peerDid: string
): Result<{ readonly record: ProfileRecord; readonly jws: string; readonly digest: string }, OfferEvalError> {
  if (card.length > MAX_EXCHANGE_CARD_BYTES) {
    return err({ reason: `offered card exceeds the ${String(MAX_EXCHANGE_CARD_BYTES)}-byte cap` });
  }
  const verified = verifyCompact(card, peerDid);
  if (!verified.ok) {
    return err({ reason: `offer failed JWS verification against the authenticated peer DID: ${verified.error}` });
  }
  const parsed = parseProfile(verified.value);
  if (!parsed.ok) {
    return err({ reason: `offer failed profile validation: ${parsed.error}` });
  }
  if (parsed.value.did !== peerDid) {
    return err({ reason: `offer record.did does not match the authenticated peer DID` });
  }
  return ok({ record: parsed.value, jws: card, digest: profileDigest(parsed.value) });
}

/** Shape-check an incoming request's advertised fields. Returns `null` on any
 *  malformed/oversized field (the caller declines + reports). */
function parseIncomingRequest(frame: Record<string, unknown>): IncomingExchangeRequest | null {
  const exchangeId = frame['exchangeId'];
  const v = frame['v'];
  const digest = frame['digest'];
  const size = frame['size'];
  const updatedAt = frame['updatedAt'];
  if (typeof exchangeId !== 'string' || exchangeId.length === 0) return null;
  if (typeof v !== 'number') return null;
  if (typeof digest !== 'string' || digest.length === 0) return null;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > MAX_EXCHANGE_CARD_BYTES) return null;
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return null;
  return { exchangeId, v, digest, size, updatedAt };
}

type ExchangeRole = 'initiator' | 'responder';

interface ExchangeRun {
  readonly exchangeId: string;
  readonly role: ExchangeRole;
  readonly saveIncoming: SaveIncoming;
  /** Our card to offer — `null` for a responder until its `decide` accepts. */
  myOffer: CardExchangeOffer | null;
  /** The `reqId` of the request leg — ours (initiator) or the one to echo
   *  on accept/decline (responder). */
  reqId: number;
  accepted: boolean;
  offerSent: boolean;
  /** Responder-remembered decision, so a duplicate request is answered
   *  identically without re-prompting. */
  decided: 'accept' | 'decline' | null;
  localSave: LocalSaveOutcome | null;
  peerReceipt: PeerReceiptOutcome | null;
  /** Cached receipt fields for an idempotent re-send on a duplicate offer. */
  lastReceipt: { readonly digest: string; readonly status: IncomingSaveStatus } | null;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  settleInitiator: ((r: Result<MutualExchangeResult, PearRequestError>) => void) | null;
  onComplete: ((r: MutualExchangeResult) => void) | null;
}

export function createMutualExchange(ch: AuthenticatedChannel, opts: MutualExchangeOptions = {}): MutualExchange {
  const defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_EXCHANGE_TIMEOUT_MS;

  let run: ExchangeRun | null = null;
  let responderConfig: ExchangeResponderConfig | null = null;

  let nextReqId = 1;
  function allocReqId(): number {
    const id = nextReqId;
    nextReqId += 1;
    return id;
  }

  const protocolErrorListeners = new Set<(e: PearProtocolError) => void>();
  function report(frame: unknown, message: string): void {
    const e: PearProtocolError = { frame, message };
    for (const cb of protocolErrorListeners) cb(e);
  }

  function requestFrame(exchangeId: string, reqId: number, offer: CardExchangeOffer): Record<string, unknown> {
    return {
      t: 'card.exchange.request',
      reqId,
      exchangeId,
      v: offer.record.v,
      digest: profileDigest(offer.record),
      size: offer.card.length,
      updatedAt: offer.record.updatedAt,
    };
  }
  function offerFrame(exchangeId: string, offer: CardExchangeOffer): Record<string, unknown> {
    return { t: 'card.exchange.offer', exchangeId, card: offer.card, digest: profileDigest(offer.record) };
  }
  function receiptFrame(exchangeId: string, digest: string, status: IncomingSaveStatus): Record<string, unknown> {
    return { t: 'card.exchange.receipt', exchangeId, digest, status };
  }

  function clearRun(r: ExchangeRun): void {
    if (r.settled) return;
    r.settled = true;
    if (r.timer !== null) {
      clearTimeout(r.timer);
      r.timer = null;
    }
    if (run === r) run = null;
  }

  function complete(r: ExchangeRun, localSave: LocalSaveOutcome, peerReceipt: PeerReceiptOutcome): void {
    if (r.settled) return;
    clearRun(r);
    const result: MutualExchangeResult = { exchangeId: r.exchangeId, localSave, peerReceipt };
    if (r.role === 'initiator') r.settleInitiator?.(ok(result));
    else r.onComplete?.(result);
  }

  function maybeComplete(r: ExchangeRun): void {
    if (r.settled) return;
    if (r.localSave !== null && r.peerReceipt !== null) complete(r, r.localSave, r.peerReceipt);
  }

  function onRunTimeout(r: ExchangeRun): void {
    if (r.settled) return;
    if (r.role === 'initiator' && !r.accepted) {
      clearRun(r);
      r.settleInitiator?.(mkErr('timeout', `card.exchange.request timed out after ${String(defaultTimeoutMs)}ms`));
      return;
    }
    // In progress (accepted) — settle with whatever we have; never roll back.
    complete(r, r.localSave ?? 'notReceived', r.peerReceipt ?? 'unknown');
  }

  /** Verify + save an incoming offer and answer with a receipt. Shared by both
   *  roles (offers flow both ways once consent is mutual). */
  function processIncomingOffer(r: ExchangeRun, frame: Record<string, unknown>): void {
    if (r.localSave !== null) {
      // Duplicate offer — re-send the same receipt idempotently, never re-save.
      if (r.lastReceipt) ch.send(receiptFrame(r.exchangeId, r.lastReceipt.digest, r.lastReceipt.status));
      return;
    }
    const card = frame['card'];
    const advertised = frame['digest'];
    const fallbackDigest = typeof advertised === 'string' ? advertised : '';
    if (typeof card !== 'string') {
      report(frame, 'malformed card.exchange.offer: missing string "card" field');
      r.localSave = 'failed';
      r.lastReceipt = { digest: fallbackDigest, status: 'failed' };
      ch.send(receiptFrame(r.exchangeId, fallbackDigest, 'failed'));
      maybeComplete(r);
      return;
    }
    const evaluated = evaluateIncomingOffer(card, ch.peerDid);
    if (!evaluated.ok) {
      report(frame, `card.exchange.offer rejected — ${evaluated.error.reason}`);
      r.localSave = 'failed';
      r.lastReceipt = { digest: fallbackDigest, status: 'failed' };
      ch.send(receiptFrame(r.exchangeId, fallbackDigest, 'failed'));
      maybeComplete(r);
      return;
    }
    const status: IncomingSaveStatus = r.saveIncoming(evaluated.value.record, evaluated.value.jws);
    r.localSave = status;
    r.lastReceipt = { digest: evaluated.value.digest, status };
    ch.send(receiptFrame(r.exchangeId, evaluated.value.digest, status));
    maybeComplete(r);
  }

  function handleIncomingRequest(frame: Record<string, unknown>): void {
    const reqId = frame['reqId'];
    const exchangeId = frame['exchangeId'];
    if (typeof reqId !== 'number') {
      report(frame, 'malformed card.exchange.request: missing numeric "reqId" field');
      return;
    }
    if (typeof exchangeId !== 'string' || exchangeId.length === 0) {
      report(frame, 'malformed card.exchange.request: missing string "exchangeId" field');
      return;
    }

    // Idempotent dedupe of a duplicate request for the SAME active exchange.
    if (run?.role === 'responder' && run.exchangeId === exchangeId) {
      if (run.decided === 'accept') {
        ch.send({ t: 'card.exchange.accept', reqId, exchangeId });
        if (run.offerSent && run.myOffer) ch.send(offerFrame(exchangeId, run.myOffer));
      } else if (run.decided === 'decline') {
        ch.send({ t: 'card.exchange.decline', reqId, exchangeId });
      }
      // else: still deciding (consent open) — drop; the in-flight decide answers.
      return;
    }

    // A different exchange is already active — one at a time, decline the new.
    if (run) {
      ch.send({ t: 'card.exchange.decline', reqId, exchangeId });
      return;
    }

    const config = responderConfig;
    if (!config) {
      ch.send({ t: 'card.exchange.decline', reqId, exchangeId });
      return;
    }
    const req = parseIncomingRequest(frame);
    if (!req) {
      report(frame, 'malformed card.exchange.request: bad v/digest/size/updatedAt shape');
      ch.send({ t: 'card.exchange.decline', reqId, exchangeId });
      return;
    }

    const r: ExchangeRun = {
      exchangeId,
      role: 'responder',
      saveIncoming: config.saveIncoming,
      myOffer: null,
      reqId,
      accepted: false,
      offerSent: false,
      decided: null,
      localSave: null,
      peerReceipt: null,
      lastReceipt: null,
      timer: null,
      settled: false,
      settleInitiator: null,
      onComplete: config.onComplete ?? null,
    };
    run = r;
    const timeoutMs = config.timeoutMs ?? defaultTimeoutMs;

    config
      .decide(req)
      .then((decision) => {
        if (r.settled || run !== r) return;
        if (!decision.accept) {
          r.decided = 'decline';
          ch.send({ t: 'card.exchange.decline', reqId, exchangeId });
          clearRun(r);
          return;
        }
        r.decided = 'accept';
        r.myOffer = decision.offer;
        r.accepted = true;
        ch.send({ t: 'card.exchange.accept', reqId, exchangeId });
        ch.send(offerFrame(exchangeId, decision.offer));
        r.offerSent = true;
        r.timer = setTimeout(() => {
          onRunTimeout(r);
        }, timeoutMs);
        maybeComplete(r);
      })
      .catch((e: unknown) => {
        report(frame, `card exchange decide handler threw — ${e instanceof Error ? e.message : String(e)}`);
        if (run === r && !r.settled) {
          r.decided = 'decline';
          ch.send({ t: 'card.exchange.decline', reqId, exchangeId });
          clearRun(r);
        }
      });
  }

  function handleAccept(frame: Record<string, unknown>): void {
    const r = run;
    if (r?.role !== 'initiator' || r.reqId !== frame['reqId'] || r.exchangeId !== frame['exchangeId']) {
      report(frame, 'card.exchange.accept with no matching outstanding request (reqId/exchangeId mismatch)');
      return;
    }
    if (r.accepted) return; // duplicate accept — ignore
    r.accepted = true;
    if (r.myOffer) {
      ch.send(offerFrame(r.exchangeId, r.myOffer));
      r.offerSent = true;
    }
    maybeComplete(r);
  }

  function handleDecline(frame: Record<string, unknown>): void {
    const r = run;
    if (r?.role !== 'initiator' || r.reqId !== frame['reqId'] || r.exchangeId !== frame['exchangeId']) {
      report(frame, 'card.exchange.decline with no matching outstanding request (reqId/exchangeId mismatch)');
      return;
    }
    clearRun(r);
    r.settleInitiator?.(mkErr('declined', 'card exchange declined by peer'));
  }

  function handleOffer(frame: Record<string, unknown>): void {
    const exchangeId = frame['exchangeId'];
    if (typeof exchangeId !== 'string') {
      report(frame, 'malformed card.exchange.offer: missing string "exchangeId" field');
      return;
    }
    const r = run;
    if (r?.exchangeId !== exchangeId) {
      report(frame, 'card.exchange.offer with no matching active exchange');
      return;
    }
    processIncomingOffer(r, frame);
  }

  function handleReceipt(frame: Record<string, unknown>): void {
    const exchangeId = frame['exchangeId'];
    if (typeof exchangeId !== 'string') {
      report(frame, 'malformed card.exchange.receipt: missing string "exchangeId" field');
      return;
    }
    const r = run;
    if (r?.exchangeId !== exchangeId) {
      report(frame, 'card.exchange.receipt with no matching active exchange');
      return;
    }
    const digest = frame['digest'];
    if (typeof digest === 'string' && r.myOffer && digest !== profileDigest(r.myOffer.record)) {
      report(frame, 'card.exchange.receipt digest does not match our offered card — dropped');
      return;
    }
    const status = frame['status'];
    if (typeof status !== 'string' || !SAVE_STATUSES.has(status)) {
      report(frame, `card.exchange.receipt has an invalid status: ${JSON.stringify(status)}`);
      return;
    }
    if (r.peerReceipt !== null) return; // duplicate receipt — ignore
    r.peerReceipt = status as IncomingSaveStatus;
    maybeComplete(r);
  }

  const unsubFrame = ch.onFrame((frame) => {
    if (!isRecord(frame)) return;
    switch (frame['t']) {
      case 'card.exchange.request':
        handleIncomingRequest(frame);
        return;
      case 'card.exchange.accept':
        handleAccept(frame);
        return;
      case 'card.exchange.decline':
        handleDecline(frame);
        return;
      case 'card.exchange.offer':
        handleOffer(frame);
        return;
      case 'card.exchange.receipt':
        handleReceipt(frame);
        return;
      default:
        // Not ours — a `PearSession` (protocol.ts) on the same channel owns it.
        return;
    }
  });

  function startExchange(input: StartExchangeInput): Promise<Result<MutualExchangeResult, PearRequestError>> {
    if (run) {
      return Promise.resolve(mkErr('protocol', 'a card exchange is already in flight on this session'));
    }
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const reqId = allocReqId();
    return new Promise((resolve) => {
      const r: ExchangeRun = {
        exchangeId: input.exchangeId,
        role: 'initiator',
        saveIncoming: input.saveIncoming,
        myOffer: input.offer,
        reqId,
        accepted: false,
        offerSent: false,
        decided: null,
        localSave: null,
        peerReceipt: null,
        lastReceipt: null,
        timer: null,
        settled: false,
        settleInitiator: resolve,
        onComplete: null,
      };
      run = r;
      r.timer = setTimeout(() => {
        onRunTimeout(r);
      }, timeoutMs);
      ch.send(requestFrame(input.exchangeId, reqId, input.offer));
    });
  }

  function onExchangeRequest(config: ExchangeResponderConfig): void {
    responderConfig = config;
  }

  function onProtocolError(cb: (e: PearProtocolError) => void): () => void {
    protocolErrorListeners.add(cb);
    return () => {
      protocolErrorListeners.delete(cb);
    };
  }

  function close(): void {
    unsubFrame();
    const r = run;
    if (r && !r.settled) {
      if (r.role === 'initiator' && !r.accepted) {
        clearRun(r);
        r.settleInitiator?.(mkErr('protocol', 'mutual exchange closed before the peer answered'));
      } else {
        complete(r, r.localSave ?? 'notReceived', r.peerReceipt ?? 'unknown');
      }
    }
    ch.close();
  }

  return { startExchange, onExchangeRequest, onProtocolError, close };
}
