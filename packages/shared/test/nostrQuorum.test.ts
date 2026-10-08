/**
 * Relay publish quorum (src/nostr/quorum.ts): strict majority, bounded retry
 * on transport failures only, and a per-relay report alongside the verdict.
 */
import { describe, expect, it } from 'bun:test';

import { hexToBytes } from '../src/crypto/hex';
import { signNostrEventWithScalar, type NostrEvent } from '../src/nostr/event';
import { publishToRelays, requiredAcceptances, type PublishEventFn, type RelayPublishOutcome } from '../src/nostr/quorum';

const signed = signNostrEventWithScalar({ kind: 0, tags: [], content: '{}', created_at: 1 }, hexToBytes('11'.repeat(32)));
if (!signed.ok) throw new Error('sign failed');
const event: NostrEvent = signed.value;

const accepted: RelayPublishOutcome = { accepted: true, message: '', elapsedMs: 1 };
const refused: RelayPublishOutcome = { accepted: false, message: 'blocked: policy', elapsedMs: 1 };
const transport: RelayPublishOutcome = { accepted: false, message: 'websocket error', elapsedMs: 1, failure: 'transport' };
const timeout: RelayPublishOutcome = { accepted: false, message: 'timeout', elapsedMs: 1, failure: 'timeout' };

/** A relay whose successive answers are scripted; records how often it was dialled. */
function scripted(script: Record<string, readonly RelayPublishOutcome[]>): { fn: PublishEventFn; dials: Record<string, number> } {
  const dials: Record<string, number> = {};
  const fn: PublishEventFn = async (relay) => {
    dials[relay] = (dials[relay] ?? 0) + 1;
    const answers = script[relay] ?? [refused];
    return answers[Math.min(dials[relay] - 1, answers.length - 1)] ?? refused;
  };
  return { fn, dials };
}

const noSleep = { sleep: async () => undefined };

describe('requiredAcceptances', () => {
  it('is a strict majority', () => {
    expect(requiredAcceptances(1)).toBe(1);
    expect(requiredAcceptances(2)).toBe(2);
    expect(requiredAcceptances(3)).toBe(2);
    expect(requiredAcceptances(4)).toBe(3);
  });
});

describe('publishToRelays', () => {
  it('succeeds on a majority and reports every relay', async () => {
    const { fn } = scripted({ a: [accepted], b: [accepted], c: [refused] });
    const report = await publishToRelays(event, ['a', 'b', 'c'], fn, noSleep);
    expect(report.success).toBe(true);
    expect(report.acceptedCount).toBe(2);
    expect(report.requiredCount).toBe(2);
    expect(report.results.map((r) => [r.relay, r.accepted])).toEqual([['a', true], ['b', true], ['c', false]]);
    expect(report.results[2]?.message).toBe('blocked: policy');
    expect(report.event).toBe(event);
  });

  it('retries a transport failure up to the limit, then counts it as failed', async () => {
    const flaky = scripted({ a: [transport, accepted], b: [transport, transport, transport, accepted], c: [accepted] });
    const report = await publishToRelays(event, ['a', 'b', 'c'], flaky.fn, noSleep);
    expect(flaky.dials['a']).toBe(2);
    expect(flaky.dials['b']).toBe(3); // 1 + TRANSPORT_RETRY_LIMIT, never reaches the 4th answer
    expect(report.results.find((r) => r.relay === 'a')?.accepted).toBe(true);
    expect(report.results.find((r) => r.relay === 'b')?.accepted).toBe(false);
    expect(report.success).toBe(true);
  });

  it('never retries a policy refusal or a timeout', async () => {
    const { fn, dials } = scripted({ a: [refused, accepted], b: [timeout, accepted] });
    const report = await publishToRelays(event, ['a', 'b'], fn, noSleep);
    expect(dials['a']).toBe(1);
    expect(dials['b']).toBe(1);
    expect(report.success).toBe(false);
  });

  it('honours a caller retry limit and sleeps between retries', async () => {
    const slept: number[] = [];
    const { fn, dials } = scripted({ a: [transport, transport, transport] });
    await publishToRelays(event, ['a'], fn, { retryLimit: 1, retryDelayMs: 7, sleep: async (ms) => { slept.push(ms); } });
    expect(dials['a']).toBe(2);
    expect(slept).toEqual([7]);
  });
});
