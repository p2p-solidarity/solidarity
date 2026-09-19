/**
 * NIP-05 directory client (src/nip05/client.ts): request shapes, NIP-98
 * authorisation, response parsing and failure mapping — against a fake fetch,
 * never the live directory.
 */
import { describe, expect, it } from 'bun:test';

import { base64Decode, bytesToUtf8, utf8ToBytes } from '../src/crypto/base64';
import { sha256Bytes } from '../src/crypto/hash';
import { bytesToHex, hexToBytes } from '../src/crypto/hex';
import { signNostrEventWithScalar, verifyNostrEvent } from '../src/nostr/event';
import {
  NIP98_KIND,
  buildNip98Authorization,
  checkNip05Availability,
  findAvailableNip05Suggestions,
  nip05NameSuggestions,
  registerNip05Name,
  type FetchInitLike,
  type FetchLike,
  type Nip05SignEvent,
} from '../src/nip05/client';

const ORIGIN = 'https://creds.id';
const SCALAR = hexToBytes('11'.repeat(32));
const signEvent: Nip05SignEvent = async (unsigned) => signNostrEventWithScalar(unsigned, SCALAR, 1_700_000_000);

interface Call {
  readonly url: string;
  readonly init: FetchInitLike;
}

function fakeFetch(handler: (url: string, init: FetchInitLike) => { status: number; body: unknown } | 'hang'): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    const answer = handler(url, init);
    if (answer === 'hang') return new Promise(() => undefined);
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      text: () => Promise.resolve(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body)),
    });
  };
  return { fetch, calls };
}

describe('checkNip05Availability', () => {
  it('normalises the name, hits /id/availability, and maps the verdicts', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { name: 'alice', available: true } }));
    expect(await checkNip05Availability('  Alice ', { origin: ORIGIN, fetchImpl: fetch })).toEqual({ status: 'available', name: 'alice' });
    expect(calls[0]?.url).toBe('https://creds.id/id/availability?name=alice');
    expect(calls[0]?.init.method).toBe('GET');

    const taken = fakeFetch(() => ({ status: 200, body: { name: 'alice', available: false, reason: 'taken' } }));
    expect(await checkNip05Availability('alice', { origin: ORIGIN, fetchImpl: taken.fetch })).toEqual({ status: 'unavailable', name: 'alice', reason: 'taken' });
  });

  it('treats a 404 landing page, a mismatched body, or a hang as unreachable — never available', async () => {
    const html = fakeFetch(() => ({ status: 404, body: '<!doctype html>' }));
    expect(await checkNip05Availability('alice', { origin: ORIGIN, fetchImpl: html.fetch })).toEqual({ status: 'unreachable', name: 'alice' });
    const wrongName = fakeFetch(() => ({ status: 200, body: { name: 'bob', available: true } }));
    expect(await checkNip05Availability('alice', { origin: ORIGIN, fetchImpl: wrongName.fetch })).toEqual({ status: 'unreachable', name: 'alice' });
    const hang = fakeFetch(() => 'hang');
    expect(await checkNip05Availability('alice', { origin: ORIGIN, fetchImpl: hang.fetch, timeoutMs: 5 })).toEqual({ status: 'unreachable', name: 'alice' });
  });
});

describe('name suggestions', () => {
  it('derives numbered candidates and keeps only the available ones', async () => {
    expect(nip05NameSuggestions('Ali ce!')).toEqual(['alice1', 'alice2', 'alice3']);
    expect(nip05NameSuggestions('a')).toEqual([]);
    const { fetch } = fakeFetch((url) => ({ status: 200, body: { name: new URL(url).searchParams.get('name'), available: url.endsWith('alice2') } }));
    expect(await findAvailableNip05Suggestions('alice', { origin: ORIGIN, fetchImpl: fetch })).toEqual(['alice2']);
  });
});

describe('buildNip98Authorization / registerNip05Name', () => {
  it('signs a kind-27235 event pinning url, method and payload hash', async () => {
    const auth = await buildNip98Authorization('https://creds.id/id/register', 'post', '{"a":1}', signEvent);
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.value.startsWith('Nostr ')).toBe(true);
    const event = JSON.parse(bytesToUtf8(base64Decode(auth.value.slice('Nostr '.length))));
    expect(event.kind).toBe(NIP98_KIND);
    expect(event.tags).toEqual([
      ['u', 'https://creds.id/id/register'],
      ['method', 'POST'],
      ['payload', bytesToHex(sha256Bytes(utf8ToBytes('{"a":1}')))],
    ]);
    expect(event.content).toBe('');
    expect(verifyNostrEvent(event)).toBe(true);
  });

  it('registers with a NIP-98 header and returns the directory identifier', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 200, body: { name: 'alice', pubkey: 'ab'.repeat(32), identifier: 'alice@creds.id' } }));
    const result = await registerNip05Name({ origin: ORIGIN, fetchImpl: fetch, name: 'Alice', relays: ['wss://r.example'], signEvent });
    expect(result).toEqual({ ok: true, name: 'alice', pubkey: 'ab'.repeat(32), identifier: 'alice@creds.id' });
    const call = calls[0];
    expect(call?.url).toBe('https://creds.id/id/register');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe(JSON.stringify({ name: 'alice', relays: ['wss://r.example'], consent: true }));
    expect(call?.init.headers['authorization']?.startsWith('Nostr ')).toBe(true);
    expect(call?.init.headers['content-type']).toBe('application/json');
  });

  it('maps every directory failure to its contractual error', async () => {
    const cases: readonly [number, unknown, string][] = [
      [409, { error: 'name_taken' }, 'name_taken'],
      [429, { error: 'rename_too_soon', retryAt: 99 }, 'rename_too_soon'],
      [429, { error: 'rate_limit_exceeded' }, 'rate_limited'],
      [401, { error: 'invalid_auth' }, 'invalid_auth'],
      [400, { error: 'invalid_request' }, 'invalid_request'],
      [500, { error: 'storage_failed' }, 'server_error'],
      [200, { name: 'someone-else', pubkey: 'x', identifier: 'x' }, 'server_error'],
    ];
    for (const [status, body, expected] of cases) {
      const { fetch } = fakeFetch(() => ({ status, body }));
      const result = await registerNip05Name({ origin: ORIGIN, fetchImpl: fetch, name: 'alice', relays: [], signEvent });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(expected);
      if (!result.ok && status === 429 && expected === 'rename_too_soon') expect(result.retryAt).toBe(99);
    }
    const hang = fakeFetch(() => 'hang');
    const result = await registerNip05Name({ origin: ORIGIN, fetchImpl: hang.fetch, name: 'alice', relays: [], signEvent, timeoutMs: 5 });
    expect(result).toEqual({ ok: false, error: 'unreachable' });
    const refusing: Nip05SignEvent = async () => ({ ok: false, error: 'locked' });
    const signerless = await registerNip05Name({ origin: ORIGIN, fetchImpl: hang.fetch, name: 'alice', relays: [], signEvent: refusing });
    expect(signerless).toEqual({ ok: false, error: 'invalid_auth' });
  });
});
