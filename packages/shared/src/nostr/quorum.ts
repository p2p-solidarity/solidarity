/**
 * Relay publish quorum — the app's `nostr/publish.ts` rules, factored out so
 * the web builder publishes with the SAME verdict logic:
 *   - a strict majority of the relay set must accept (`floor(n/2)+1`);
 *   - a connection-level failure (`failure: 'transport'`) is retried a bounded
 *     number of times — measured relay flakiness (~25% first-dial errors on
 *     relay.damus.io) must not count as a rejection;
 *   - a policy refusal (an OK frame with `accepted: false`) or a timeout is
 *     never retried: the relay answered, or another dial just doubles the stall.
 *
 * The transport itself is injected (`PublishEventFn`) — WebSocket code stays
 * platform-specific and testable with fakes.
 */
import type { NostrEvent } from './event';

export interface RelayPublishOutcome {
  readonly accepted: boolean;
  readonly message: string;
  readonly elapsedMs: number;
  /** Absent when the relay gave a verdict (OK frame). */
  readonly failure?: 'timeout' | 'transport';
}

export type PublishEventFn = (relay: string, event: NostrEvent, timeoutMs?: number) => Promise<RelayPublishOutcome>;

/** One relay's outcome for a publish attempt. */
export interface RelayPublishResult {
  readonly relay: string;
  readonly accepted: boolean;
  readonly message: string;
  readonly elapsedMs: number;
}

/**
 * Full publish outcome: the signed event that was sent, every relay's
 * individual result, and the aggregate `success` verdict — always alongside
 * the per-relay detail so a UI can say which relay refused and why.
 */
export interface PublishReport {
  readonly event: NostrEvent;
  readonly results: readonly RelayPublishResult[];
  readonly acceptedCount: number;
  readonly requiredCount: number;
  readonly success: boolean;
}

export interface PublishToRelaysOptions {
  readonly timeoutMs?: number;
  /** Extra attempts after a transport failure (default 2). */
  readonly retryLimit?: number;
  /** Delay before each retry (default 300 ms). */
  readonly retryDelayMs?: number;
  /** Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export const TRANSPORT_RETRY_LIMIT = 2;
export const TRANSPORT_RETRY_DELAY_MS = 300;

/** Strict majority: 3 relays → 2, 4 → 3, 1 → 1. */
export function requiredAcceptances(relayCount: number): number {
  return Math.floor(relayCount / 2) + 1;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function publishWithTransportRetry(
  relay: string,
  event: NostrEvent,
  publishFn: PublishEventFn,
  options: PublishToRelaysOptions
): Promise<RelayPublishResult> {
  const retryLimit = options.retryLimit ?? TRANSPORT_RETRY_LIMIT;
  const sleep = options.sleep ?? defaultSleep;
  let outcome = await publishFn(relay, event, options.timeoutMs);
  for (let retry = 0; retry < retryLimit && outcome.failure === 'transport'; retry++) {
    await sleep(options.retryDelayMs ?? TRANSPORT_RETRY_DELAY_MS);
    outcome = await publishFn(relay, event, options.timeoutMs);
  }
  return { relay, accepted: outcome.accepted, message: outcome.message, elapsedMs: outcome.elapsedMs };
}

export async function publishToRelays(
  event: NostrEvent,
  relays: readonly string[],
  publishFn: PublishEventFn,
  options: PublishToRelaysOptions = {}
): Promise<PublishReport> {
  const results = await Promise.all(relays.map((relay) => publishWithTransportRetry(relay, event, publishFn, options)));
  const acceptedCount = results.filter((result) => result.accepted).length;
  const requiredCount = requiredAcceptances(relays.length);
  return { event, results, acceptedCount, requiredCount, success: acceptedCount >= requiredCount };
}
