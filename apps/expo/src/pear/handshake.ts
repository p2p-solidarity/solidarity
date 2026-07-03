/**
 * Pear channel handshake — mutual DID-challenge authentication over a raw
 * `PearChannel` (A3.3, on top of A3.2's `lane.ts`/`frames.ts`). Neither side
 * trusts the DID it *thinks* it dialed until it has cryptographic proof: on
 * `open`, both peers send `{t:'challenge', c}` (a `pear.card`-purpose
 * `Challenge` from `@solidarity/shared`, addressed at the other side); each
 * side answers the challenge addressed to it with `{t:'challenge.response',
 * jws}`; a side considers the channel authenticated once it has (a)
 * answered the peer's challenge and (b) verified the peer's answer to its
 * own challenge. That's "mutual" without needing an explicit ack frame — a
 * response that verifies was necessarily produced by a valid signer over
 * the exact challenge object sent, so by construction the peer's own
 * verification of our answer (which we can't directly observe) succeeds or
 * fails identically to how ours would over the same inputs.
 *
 * Fails closed on anything that doesn't fit that shape:
 *   - a `challenge` not addressed to us (wrong subject/requester/purpose) —
 *     protocol violation, not silently ignored (an attacker could otherwise
 *     get us to sign a differently-scoped challenge by mislabeling fields).
 *   - a `challenge.response` that fails `verifyChallengeResponse` (wrong
 *     signer, tampered/replayed-from-another-purpose payload, expired) —
 *     verification failure.
 *   - any frame type other than `challenge`/`challenge.response` before
 *     authentication completes — protocol violation (card/present protocol
 *     frames are A5's job, strictly after this handshake authenticates).
 *   - no mutual authentication within `HANDSHAKE_TIMEOUT_MS` — timeout.
 * Every failure path closes the channel and resolves `err(...)` — there is
 * no partial/degraded "authenticated in one direction" state.
 */
import {
  buildChallenge,
  err,
  ok,
  randomChallengeNonce,
  respondChallenge,
  verifyChallengeResponse,
  CHALLENGE_TYP,
  CHALLENGE_VERSION,
  type Challenge,
  type Result,
  type Signer,
} from '@solidarity/shared';

import type { PearChannel } from './lane';

/** Mutual handshake must complete within this window or the attempt is
 *  abandoned and the channel closed. Generous relative to a LAN/relay round
 *  trip (challenge + response each way), tight enough that a dead/silent
 *  peer doesn't hold a channel (and, transitively, a Bare worklet) open
 *  indefinitely. */
export const HANDSHAKE_TIMEOUT_MS = 15_000;

export interface AuthenticateChannelOpts {
  readonly myDid: string;
  readonly peerDid: string;
  readonly signer: Signer;
  /** Inject "now" (epoch ms) for deterministic tests — used both as this
   *  side's outbound challenge `ts` and as `verifyChallengeResponse`'s
   *  clock-skew reference. Defaults to `Date.now()`. */
  readonly nowMs?: number;
  /** Test-only override for `HANDSHAKE_TIMEOUT_MS` so a timeout test doesn't
   *  need to wait 15 real seconds. Production callers must not set this. */
  readonly handshakeTimeoutMs?: number;
}

/** A `PearChannel` that has completed mutual DID-challenge authentication.
 *  `send`/`onFrame` are the SAME underlying channel, just exposed only once
 *  authenticated — callers can't accidentally read/write pre-auth traffic
 *  through this handle because it doesn't exist until `authenticateChannel`
 *  resolves. */
export interface AuthenticatedChannel {
  readonly myDid: string;
  readonly peerDid: string;
  send(frame: Record<string, unknown>): void;
  onFrame(cb: (frame: Record<string, unknown>) => void): () => void;
  close(): void;
}

/** Shape/field validation for a `challenge` frame received from the peer —
 *  must be a well-formed `pear.card` challenge addressed FROM `peerDid` TO
 *  `myDid`, or we must not sign it (see module doc). */
function isChallengeAddressedToMe(c: unknown, myDid: string, peerDid: string): c is Challenge {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) return false;
  const obj = c as Record<string, unknown>;
  return (
    obj['v'] === CHALLENGE_VERSION &&
    obj['typ'] === CHALLENGE_TYP &&
    obj['requester'] === peerDid &&
    obj['subject'] === myDid &&
    obj['purpose'] === 'pear.card' &&
    typeof obj['nonce'] === 'string' &&
    typeof obj['ts'] === 'number'
  );
}

/**
 * Run the mutual DID-challenge handshake over an already-`joinTopic`'d
 * `PearChannel`. Safe to call any time after `joinTopic` — even after
 * `open` already fired (e.g. across an `await` gap before this function's
 * `onCtrl` subscription attaches) — because `PearChannel.onCtrl` replays the
 * topic's last ctrl event to a newly-attached subscriber (`lane.ts`). This
 * function's own `open` handling is already idempotent (`sendMyChallenge`
 * no-ops once `myChallenge` is set), so a replayed `open` behaves the same
 * as a live one.
 */
export async function authenticateChannel(
  ch: PearChannel,
  opts: AuthenticateChannelOpts
): Promise<Result<AuthenticatedChannel, string>> {
  const { myDid, peerDid, signer } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const timeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    let myChallenge: Challenge | null = null;
    let respondedToPeer = false;
    let verifiedPeer = false;

    let unsubFrame: (() => void) | null = null;
    let unsubCtrl: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function stopWatching(): void {
      unsubFrame?.();
      unsubFrame = null;
      unsubCtrl?.();
      unsubCtrl = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function fail(message: string): void {
      if (settled) return;
      settled = true;
      stopWatching();
      try {
        ch.close();
      } catch {
        // Already closed — nothing left to tear down.
      }
      resolve(err(message));
    }

    function succeed(): void {
      if (settled) return;
      settled = true;
      stopWatching();
      resolve(
        ok({
          myDid,
          peerDid,
          send: (frame) => {
            ch.send(frame);
          },
          onFrame: (cb) => ch.onFrame(cb),
          close: () => {
            ch.close();
          },
        })
      );
    }

    function maybeAuthenticated(): void {
      if (respondedToPeer && verifiedPeer) succeed();
    }

    function sendMyChallenge(): void {
      if (myChallenge) return; // already sent — 'open' should only fire once per connection
      myChallenge = buildChallenge({
        requester: myDid,
        subject: peerDid,
        purpose: 'pear.card',
        nonce: randomChallengeNonce(),
        ts: Math.floor(nowMs / 1000),
      });
      ch.send({ t: 'challenge', c: myChallenge });
    }

    async function handleChallengeFrame(rawChallenge: unknown): Promise<void> {
      if (!isChallengeAddressedToMe(rawChallenge, myDid, peerDid)) {
        fail('handshake: protocol violation — challenge not addressed to this pairing (purpose/requester/subject mismatch)');
        return;
      }
      let jws: string;
      try {
        jws = await respondChallenge(rawChallenge, myDid, signer);
      } catch (e) {
        fail(`handshake: signer failed to answer peer challenge — ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (settled) return; // a timeout/other failure raced the (possibly Face-ID-gated) signer
      respondedToPeer = true;
      ch.send({ t: 'challenge.response', jws });
      maybeAuthenticated();
    }

    function handleResponseFrame(rawJws: unknown): void {
      if (!myChallenge) {
        fail('handshake: protocol violation — challenge.response received before this side sent a challenge');
        return;
      }
      if (typeof rawJws !== 'string') {
        fail('handshake: protocol violation — challenge.response missing a string jws field');
        return;
      }
      // Primary replay defense is the fresh per-handshake `randomChallengeNonce()`
      // in `myChallenge` — a captured response can't be replayed into a later
      // handshake because the nonce won't match. The verifier's ±120s clock-skew
      // window (`DEFAULT_MAX_SKEW_SEC` in `@solidarity/shared`) is secondary,
      // bounding how long a captured-but-unused response stays valid at all.
      const verified = verifyChallengeResponse(rawJws, myChallenge, { nowMs });
      if (!verified.ok) {
        fail(`handshake: peer response failed verification — ${verified.error}`);
        return;
      }
      verifiedPeer = true;
      maybeAuthenticated();
    }

    unsubFrame = ch.onFrame((frame) => {
      if (settled) return;
      const t = frame['t'];
      if (t === 'challenge') {
        // `handleChallengeFrame` has its own try/catch around the signer call,
        // but a throw from anything else in its body (e.g. `ch.send`) would
        // otherwise reject this promise with nothing awaiting it. `fail` is
        // idempotent (`settled` guard), so a late/duplicate rejection here is
        // a no-op if the handshake already settled some other way.
        void handleChallengeFrame(frame['c']).catch((e: unknown) => {
          fail(`handshake: unexpected error while handling challenge — ${e instanceof Error ? e.message : String(e)}`);
        });
        return;
      }
      if (t === 'challenge.response') {
        handleResponseFrame(frame['jws']);
        return;
      }
      fail(`handshake: protocol violation — unexpected frame type before authentication (${JSON.stringify(t)})`);
    });

    unsubCtrl = ch.onCtrl((ev) => {
      if (settled) return;
      if (ev.ev === 'open') {
        sendMyChallenge();
      } else if (ev.ev === 'error') {
        fail(`handshake: channel reported an error before authentication — ${ev.message}`);
      } else if (ev.ev === 'close') {
        fail('handshake: channel closed before authentication completed');
      }
    });

    timer = setTimeout(() => {
      fail(`handshake: timed out after ${String(timeoutMs)}ms without mutual authentication`);
    }, timeoutMs);
  });
}
