/**
 * Public/read and OAuth-authenticated/write transport for Solidarity's
 * `app.solidarity.profile/self` ATProto record.
 *
 * Writes use the session's persisted DPoP key and access token. A 401 is
 * allowed exactly one pass through the existing OAuth refresh path, then
 * fails closed. Reads resolve the repository DID document every time and
 * use that repository's advertised HTTPS PDS without authentication.
 * Errors are closed string variants so tokens, handles, DIDs, JWS payloads,
 * and server response bodies never escape through this boundary.
 */
import { err, hexToBytes, ok, type ResolverIoError, type Result } from '@solidarity/shared';

import { buildDpopProof, type DpopKeyPair } from './dpop';
import { extractPdsEndpoint, resolveDidDocument } from './discovery';
import { refreshAtprotoSession } from './oauth';
import {
  getAtprotoSessionStorage,
  toPublicSession,
  type AtprotoSession,
  type PersistedAtprotoSession,
} from './session';

const PROFILE_COLLECTION = 'app.solidarity.profile';
const PROFILE_RKEY = 'self';
const PUT_RECORD_METHOD = 'com.atproto.repo.putRecord';
const GET_RECORD_METHOD = 'com.atproto.repo.getRecord';

export type PdsWriteError =
  | 'insecureEndpoint'
  | 'sessionUnavailable'
  | 'sessionMismatch'
  | 'networkError'
  | 'refreshFailed'
  | 'unauthorized'
  | 'httpError';

type RefreshSession = (fetchImpl: typeof fetch) => Promise<Result<AtprotoSession, string>>;

export interface PutProfileRecordOptions {
  readonly fetchImpl?: typeof fetch;
  /** Test seam; production always defaults to oauth.ts's refresh path. */
  readonly refreshSession?: RefreshSession;
}

export interface GetProfileRecordOptions {
  readonly fetchImpl?: typeof fetch;
}

function xrpcUrl(pdsUrl: string, method: string): Result<string, 'insecureEndpoint'> {
  try {
    const url = new URL(pdsUrl);
    if (url.protocol !== 'https:') return err('insecureEndpoint');
    url.pathname = `${url.pathname.replace(/\/+$/u, '')}/xrpc/${method}`;
    url.search = '';
    url.hash = '';
    return ok(url.toString());
  } catch {
    return err('insecureEndpoint');
  }
}

function dpopKeyPair(session: PersistedAtprotoSession): DpopKeyPair {
  return {
    privateKey: hexToBytes(session.dpopPrivateKeyHex),
    publicJwk: session.dpopPublicJwk,
  };
}

type PutAttempt = Result<void, 'networkError' | 'unauthorized' | 'httpError'>;

async function sendPutRecord(
  session: AtprotoSession,
  keyPair: DpopKeyPair,
  url: string,
  jws: string,
  fetchImpl: typeof fetch
): Promise<PutAttempt> {
  let proof: string;
  try {
    proof = buildDpopProof(keyPair, {
      htm: 'POST',
      htu: url,
      accessToken: session.accessToken,
    });
  } catch {
    return err('networkError');
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `DPoP ${session.accessToken}`,
        'content-type': 'application/json',
        DPoP: proof,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: PROFILE_COLLECTION,
        rkey: PROFILE_RKEY,
        record: { jws },
      }),
    });
  } catch {
    return err('networkError');
  }

  if (response.ok) return ok(undefined);
  if (response.status === 401) return err('unauthorized');
  return err('httpError');
}

function sessionMatches(requested: AtprotoSession, persisted: PersistedAtprotoSession): boolean {
  return requested.did === persisted.did && requested.pdsUrl === persisted.pdsUrl;
}

/**
 * Put the exact supplied compact JWS at the authenticated account's fixed
 * Solidarity collection/rkey. Never retries more than once, and only after
 * the existing OAuth refresh operation succeeds.
 */
export async function putProfileRecord(
  session: AtprotoSession,
  jws: string,
  options: PutProfileRecordOptions = {}
): Promise<Result<void, PdsWriteError>> {
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const stored = await getAtprotoSessionStorage().getSession();
    if (!stored) return err('sessionUnavailable');
    if (!sessionMatches(session, stored)) return err('sessionMismatch');

    const urlResult = xrpcUrl(session.pdsUrl, PUT_RECORD_METHOD);
    if (!urlResult.ok) return urlResult;
    const keyPair = dpopKeyPair(stored);
    const currentSession = toPublicSession(stored);
    const first = await sendPutRecord(currentSession, keyPair, urlResult.value, jws, fetchImpl);
    if (first.ok || first.error !== 'unauthorized') return first;

    const refresh =
      options.refreshSession ??
      ((impl: typeof fetch) => refreshAtprotoSession({ fetchImpl: impl }));
    const refreshed = await refresh(fetchImpl);
    if (!refreshed.ok) return err('refreshFailed');
    if (refreshed.value.did !== session.did || refreshed.value.pdsUrl !== session.pdsUrl) {
      return err('sessionMismatch');
    }

    return await sendPutRecord(refreshed.value, keyPair, urlResult.value, jws, fetchImpl);
  } catch {
    return err('sessionUnavailable');
  }
}

function classifyDidResolutionError(error: string): ResolverIoError {
  if (
    error.startsWith('network error') ||
    error.startsWith('response from') ||
    (/^HTTP \d{3}\b/u.test(error) && !error.startsWith('HTTP 404 '))
  ) {
    return 'unreachable';
  }
  return 'notFound';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function classifyGetRecordFailure(response: Response): Promise<ResolverIoError> {
  if (response.status === 404) return 'notFound';
  if (response.status !== 400) return 'unreachable';
  try {
    const body: unknown = await response.json();
    return isRecord(body) && body['error'] === 'RecordNotFound' ? 'notFound' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Read the fixed public Solidarity record from the repository's own PDS.
 * The repository location is always resolved from its DID document; no
 * caller-supplied PDS or OAuth state influences this path.
 */
export async function getProfileRecord(
  repoDid: string,
  options: GetProfileRecordOptions = {}
): Promise<Result<unknown, ResolverIoError>> {
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const document = await resolveDidDocument(repoDid, fetchImpl);
    if (!document.ok) {
      return err(classifyDidResolutionError(document.error));
    }

    const pds = extractPdsEndpoint(document.value);
    if (!pds.ok) {
      return err(pds.error.includes('must be https') ? 'insecureEndpoint' : 'notFound');
    }

    const urlResult = xrpcUrl(pds.value, GET_RECORD_METHOD);
    if (!urlResult.ok) return urlResult;
    const url = new URL(urlResult.value);
    url.searchParams.set('repo', repoDid);
    url.searchParams.set('collection', PROFILE_COLLECTION);
    url.searchParams.set('rkey', PROFILE_RKEY);

    let response: Response;
    try {
      response = await fetchImpl(url.toString());
    } catch {
      return err('unreachable');
    }
    if (!response.ok) {
      return err(await classifyGetRecordFailure(response));
    }
    try {
      return ok(await response.json());
    } catch {
      return err('unreachable');
    }
  } catch {
    return err('unreachable');
  }
}
