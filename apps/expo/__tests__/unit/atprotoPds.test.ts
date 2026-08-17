/**
 * atproto profile-record XRPC transport (task S2).
 *
 * All network and secure-session IO is in-memory. These tests pin the
 * DPoP-bound write, the single 401 refresh retry, and public read routing
 * through the repository DID document's own HTTPS PDS.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import { generateDpopKeyPair } from '@/atproto/dpop';
import { getProfileRecord, putProfileRecord } from '@/atproto/pds';
import {
  __setAtprotoSessionStorageForTesting,
  toPublicSession,
  type AtprotoSessionStorage,
  type PendingAtprotoFlow,
  type PersistedAtprotoSession,
} from '@/atproto/session';
import { base64UrlDecode, base64UrlEncode, bytesToHex, ok, sha256Bytes } from '@solidarity/shared';

const DID = 'did:plc:aliceexample1234';
const PDS_URL = 'https://pds.example.social';
const PUT_URL = `${PDS_URL}/xrpc/com.atproto.repo.putRecord`;
const GET_PATH = '/xrpc/com.atproto.repo.getRecord';

let storedSession: PersistedAtprotoSession | null;
let pendingFlow: PendingAtprotoFlow | null;

const storage: AtprotoSessionStorage = {
  getSession: () => Promise.resolve(storedSession),
  setSession: (session) => {
    storedSession = session;
    return Promise.resolve();
  },
  deleteSession: () => {
    storedSession = null;
    return Promise.resolve();
  },
  getPendingFlow: () => Promise.resolve(pendingFlow),
  setPendingFlow: (flow) => {
    pendingFlow = flow;
    return Promise.resolve();
  },
  deletePendingFlow: () => {
    pendingFlow = null;
    return Promise.resolve();
  },
};

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function makePersistedSession(accessToken = 'access-token-old'): PersistedAtprotoSession {
  const dpop = generateDpopKeyPair();
  return {
    did: DID,
    handle: 'alice.example.social',
    pdsUrl: PDS_URL,
    authServerIssuer: 'https://auth.example.social',
    tokenEndpoint: 'https://auth.example.social/oauth/token',
    accessToken,
    accessTokenExpiresAtMs: Date.now() + 300_000,
    scope: 'atproto transition:generic',
    refreshToken: 'refresh-token-secret',
    dpopPrivateKeyHex: bytesToHex(dpop.privateKey),
    dpopPublicJwk: dpop.publicJwk,
  };
}

function queuedFetch(responses: readonly Response[], captured: CapturedRequest[]): typeof fetch {
  let index = 0;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, init });
    const response = responses[index];
    index += 1;
    if (!response) return Promise.reject(new Error('unmocked fetch'));
    return Promise.resolve(response);
  }) as typeof fetch;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function dpopPayload(proof: string): Record<string, unknown> {
  const payload = proof.split('.')[1];
  if (!payload) throw new Error('malformed DPoP proof in test');
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Record<string, unknown>;
}

beforeEach(() => {
  storedSession = makePersistedSession();
  pendingFlow = null;
  __setAtprotoSessionStorageForTesting(storage);
});

describe('putProfileRecord', () => {
  it('writes app.solidarity.profile/self to the session PDS with a DPoP-bound access token', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = queuedFetch(
      [json({ uri: `at://${DID}/app.solidarity.profile/self` })],
      captured
    );
    const session = toPublicSession(storedSession as PersistedAtprotoSession);

    const result = await putProfileRecord(session, 'new.profile.jws', { fetchImpl });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request?.url).toBe(PUT_URL);
    expect(request?.init?.method).toBe('POST');
    const headers = new Headers(request?.init?.headers);
    expect(headers.get('authorization')).toBe(`DPoP ${session.accessToken}`);
    const proof = headers.get('dpop');
    expect(proof).not.toBeNull();
    if (!proof) return;
    expect(dpopPayload(proof)).toMatchObject({
      htm: 'POST',
      htu: PUT_URL,
      ath: base64UrlEncode(sha256Bytes(session.accessToken)),
    });
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      repo: DID,
      collection: 'app.solidarity.profile',
      rkey: 'self',
      record: { jws: 'new.profile.jws' },
    });
  });

  it('uses the existing refresh path exactly once after 401, then retries with its new token', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = queuedFetch(
      [
        json({ error: 'ExpiredToken' }, 401),
        json({ error: 'use_dpop_nonce' }, 400, { 'DPoP-Nonce': 'refresh-nonce' }),
        json(
          {
            access_token: 'access-token-refreshed',
            token_type: 'DPoP',
            refresh_token: 'refresh-token-rotated',
            sub: DID,
            scope: 'atproto transition:generic',
            expires_in: 300,
          },
          200,
          { 'DPoP-Nonce': 'refresh-nonce-2' }
        ),
        json({ uri: 'ok' }),
      ],
      captured
    );
    const session = toPublicSession(storedSession as PersistedAtprotoSession);

    const result = await putProfileRecord(session, 'new.profile.jws', { fetchImpl });

    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(4);
    expect(new Headers(captured[0]?.init?.headers).get('authorization')).toBe(
      'DPoP access-token-old'
    );
    expect(captured[1]?.url).toBe(session.tokenEndpoint);
    expect(captured[2]?.url).toBe(session.tokenEndpoint);
    expect(new Headers(captured[3]?.init?.headers).get('authorization')).toBe(
      'DPoP access-token-refreshed'
    );
    expect(storedSession?.accessToken).toBe('access-token-refreshed');
    expect(storedSession?.refreshToken).toBe('refresh-token-rotated');
  });

  it('fails closed after the one refresh retry also returns 401', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = queuedFetch(
      [json({ error: 'ExpiredToken' }, 401), json({ error: 'InvalidToken' }, 401)],
      captured
    );
    const session = toPublicSession(storedSession as PersistedAtprotoSession);
    let refreshCalls = 0;

    const result = await putProfileRecord(session, 'new.profile.jws', {
      fetchImpl,
      refreshSession: () => {
        refreshCalls += 1;
        return Promise.resolve(ok({ ...session, accessToken: 'still-invalid' }));
      },
    });

    expect(result).toEqual({ ok: false, error: 'unauthorized' });
    expect(refreshCalls).toBe(1);
    expect(captured).toHaveLength(2);
  });

  it('returns a typed network error and never rejects', async () => {
    const session = toPublicSession(storedSession as PersistedAtprotoSession);
    const fetchImpl = (() =>
      Promise.reject(new Error('request included secret@example.test'))) as unknown as typeof fetch;
    const result = await putProfileRecord(session, 'new.profile.jws', { fetchImpl });
    expect(result).toEqual({ ok: false, error: 'networkError' });
  });
});

describe('getProfileRecord', () => {
  it("resolves the repo DID document, then reads the public record from that repo's PDS", async () => {
    const captured: CapturedRequest[] = [];
    const record = {
      uri: `at://${DID}/app.solidarity.profile/self`,
      value: { jws: 'profile.jws' },
    };
    const didDocument = {
      id: DID,
      alsoKnownAs: ['at://alice.example.social'],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: `${PDS_URL}/`,
        },
      ],
    };
    const fetchImpl = queuedFetch([json(didDocument), json(record)], captured);

    const result = await getProfileRecord(DID, { fetchImpl });

    expect(result).toEqual({ ok: true, value: record });
    expect(captured[0]?.url).toBe(`https://plc.directory/${encodeURIComponent(DID)}`);
    const getUrl = new URL(captured[1]?.url ?? 'https://invalid.example');
    expect(getUrl.origin).toBe(PDS_URL);
    expect(getUrl.pathname).toBe(GET_PATH);
    expect(getUrl.searchParams.get('repo')).toBe(DID);
    expect(getUrl.searchParams.get('collection')).toBe('app.solidarity.profile');
    expect(getUrl.searchParams.get('rkey')).toBe('self');
    expect(captured[1]?.init?.headers).toBeUndefined();
  });

  it('rejects a non-HTTPS PDS endpoint before issuing the record request', async () => {
    const captured: CapturedRequest[] = [];
    const didDocument = {
      id: DID,
      alsoKnownAs: ['at://alice.example.social'],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: 'http://pds.attacker.test',
        },
      ],
    };
    const fetchImpl = queuedFetch([json(didDocument)], captured);

    const result = await getProfileRecord(DID, { fetchImpl });

    expect(result).toEqual({ ok: false, error: 'insecureEndpoint' });
    expect(captured).toHaveLength(1);
  });

  it('maps a rate-limited DID-document lookup to unreachable, not notFound', async () => {
    const fetchImpl = queuedFetch([json({ error: 'rate limited' }, 429)], []);
    expect(await getProfileRecord(DID, { fetchImpl })).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('maps a rate-limited PDS record lookup to unreachable, not notFound', async () => {
    const didDocument = {
      id: DID,
      alsoKnownAs: ['at://alice.example.social'],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: PDS_URL,
        },
      ],
    };
    const fetchImpl = queuedFetch([json(didDocument), json({ error: 'rate limited' }, 429)], []);
    expect(await getProfileRecord(DID, { fetchImpl })).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('maps the XRPC RecordNotFound error code to notFound even when transported as HTTP 400', async () => {
    const didDocument = {
      id: DID,
      alsoKnownAs: ['at://alice.example.social'],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: PDS_URL,
        },
      ],
    };
    const fetchImpl = queuedFetch(
      [json(didDocument), json({ error: 'RecordNotFound', message: 'record does not exist' }, 400)],
      []
    );
    expect(await getProfileRecord(DID, { fetchImpl })).toEqual({
      ok: false,
      error: 'notFound',
    });
  });
});
