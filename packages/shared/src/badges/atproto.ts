/**
 * ATProto badge bidirectional-binding verifier.
 *
 * Direction 1: the supplied ProfileRecord claims `at://<handle>`.
 * Direction 2: that handle resolves to the repo named by the returned AT
 * URI, and `app.solidarity.profile/self` contains the exact profile in a
 * compact JWS signed by profile.did.
 *
 * Both directions are required for `verified`. An observed missing,
 * malformed, wrong-repo, or wrong-signer record is `declared`; incomplete
 * DNS/HTTPS/PDS IO is `stale`. All external IO is injected so app and web
 * replay the same verifier and conformance vectors.
 */
import { stableJSON } from '../canonical';
import {
  AtprotoHandleResolver,
  resolveHandle,
  type ResolverIO,
  type ResolverIoError,
} from '../handles';
import { verifyCompact } from '../jws';
import { parseProfile, type ProfileRecord } from '../profile';
import type { Result } from '../types/result';
import type { BadgeState } from './types';

const ATPROTO_URI_PREFIX = 'at://';
const PROFILE_COLLECTION = 'app.solidarity.profile';
const PROFILE_RKEY = 'self';

export interface AtprotoBindingIO extends ResolverIO {
  readonly getRecord: (
    repoDid: string,
    collection: typeof PROFILE_COLLECTION,
    rkey: typeof PROFILE_RKEY
  ) => Promise<Result<unknown, ResolverIoError>>;
}

export interface AtprotoBindingEvidence {
  readonly handleClaim: string | null;
  readonly repoDid: string | null;
  readonly recordUri: string | null;
  readonly direction1: boolean;
  readonly direction2: boolean | null;
  readonly reason: string;
}

export interface VerifyAtprotoBindingResult {
  readonly state: BadgeState;
  readonly handle: string | null;
  readonly evidence: AtprotoBindingEvidence;
}

interface ProfileRecordEnvelope {
  readonly uri: string;
  readonly jws: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractHandleClaim(profile: ProfileRecord): string | null {
  const claim = profile.alsoKnownAs.find((aka) => aka.startsWith(ATPROTO_URI_PREFIX));
  return claim === undefined ? null : claim.slice(ATPROTO_URI_PREFIX.length);
}

function readProfileRecordEnvelope(value: unknown): ProfileRecordEnvelope | null {
  if (!isRecord(value)) return null;
  const record = value;
  const payload = record['value'];
  if (typeof record['uri'] !== 'string' || !isRecord(payload)) return null;
  const jws = payload['jws'];
  return typeof jws === 'string' ? { uri: record['uri'], jws } : null;
}

function result(
  state: BadgeState,
  handle: string | null,
  evidence: Omit<AtprotoBindingEvidence, 'handleClaim'>
): VerifyAtprotoBindingResult {
  return {
    state,
    handle,
    evidence: { handleClaim: handle, ...evidence },
  };
}

function unresolvedResult(
  handle: string,
  state: Extract<BadgeState, 'declared' | 'stale'>,
  reason: string
): VerifyAtprotoBindingResult {
  return result(state, handle, {
    repoDid: null,
    recordUri: null,
    direction1: true,
    direction2: state === 'stale' ? null : false,
    reason,
  });
}

export async function verifyAtprotoBinding(
  profile: ProfileRecord,
  io: AtprotoBindingIO
): Promise<VerifyAtprotoBindingResult> {
  const handle = extractHandleClaim(profile);
  if (handle === null) {
    return result('declared', null, {
      repoDid: null,
      recordUri: null,
      direction1: false,
      direction2: null,
      reason: 'profile.alsoKnownAs carries no at:// handle — no ATProto binding is claimed',
    });
  }

  const resolver = new AtprotoHandleResolver();
  if (!resolver.matches(handle)) {
    return result('declared', handle, {
      repoDid: null,
      recordUri: null,
      direction1: false,
      direction2: null,
      reason: 'profile carries a malformed at:// handle claim',
    });
  }

  const resolved = await resolveHandle(handle, [resolver], io);
  if (!resolved.ok) {
    return unresolvedResult(
      handle,
      resolved.error === 'unreachable' ? 'stale' : 'declared',
      `handle resolution failed: ${resolved.error}`
    );
  }
  const repoDid = resolved.value.did;

  let fetched: Result<unknown, ResolverIoError>;
  try {
    fetched = await io.getRecord(repoDid, PROFILE_COLLECTION, PROFILE_RKEY);
  } catch {
    return result('stale', handle, {
      repoDid,
      recordUri: null,
      direction1: true,
      direction2: null,
      reason: 'profile record is unreachable right now',
    });
  }
  if (!fetched.ok) {
    const stale = fetched.error === 'unreachable';
    return result(stale ? 'stale' : 'declared', handle, {
      repoDid,
      recordUri: null,
      direction1: true,
      direction2: stale ? null : false,
      reason: `profile record lookup failed: ${fetched.error}`,
    });
  }

  const envelope = readProfileRecordEnvelope(fetched.value);
  if (envelope === null) {
    return result('declared', handle, {
      repoDid,
      recordUri: null,
      direction1: true,
      direction2: false,
      reason: 'profile record is malformed',
    });
  }

  const expectedRecordUri = `at://${repoDid}/${PROFILE_COLLECTION}/${PROFILE_RKEY}`;
  if (envelope.uri !== expectedRecordUri) {
    return result('declared', handle, {
      repoDid,
      recordUri: envelope.uri,
      direction1: true,
      direction2: false,
      reason: `record repository mismatch: expected ${expectedRecordUri}`,
    });
  }

  const verified = verifyCompact(envelope.jws, profile.did);
  if (!verified.ok) {
    return result('declared', handle, {
      repoDid,
      recordUri: envelope.uri,
      direction1: true,
      direction2: false,
      reason: `profile record JWS did not verify: ${verified.error}`,
    });
  }

  const signedProfile = parseProfile(verified.value);
  if (!signedProfile.ok || stableJSON(signedProfile.value) !== stableJSON(profile)) {
    return result('declared', handle, {
      repoDid,
      recordUri: envelope.uri,
      direction1: true,
      direction2: false,
      reason: 'profile record JWS does not contain the exact profile being verified',
    });
  }

  return result('verified', handle, {
    repoDid,
    recordUri: envelope.uri,
    direction1: true,
    direction2: true,
    reason:
      'both directions confirmed: profile claims handle and its repository holds the signed profile record',
  });
}
