import { atprotoBindingIO } from '@/atproto/bindingIo';
import { fetchVerifiedProfileByNpub } from '@/nostr/resolveProfile';
import {
  verifyProfileJws,
  type VerifiedHandleBinding,
  type VerifiedPageErrorReason,
  type VerifiedPageResult,
} from '@/scan/verifiedPageHandler';
import {
  DEFAULT_HANDLE_RESOLVERS,
  matchHandleResolver,
  normalizeAtprotoHandle,
  resolveHandle,
  verifyDnsBinding,
  verifyEnsBinding,
  type AtprotoBindingIO,
  type HandleResolutionError,
  type HandleResolver,
  type HandleScheme,
} from '@solidarity/shared';

const PROFILE_COLLECTION = 'app.solidarity.profile';
const PROFILE_RKEY = 'self';

type FetchNostrProfile = (npub: string) => Promise<VerifiedPageResult>;

export interface ResolveProfileByHandleOptions {
  readonly io?: AtprotoBindingIO;
  readonly resolvers?: readonly HandleResolver[];
  readonly schemeHint?: HandleScheme;
  readonly fetchNostrProfile?: FetchNostrProfile;
}

interface ProfileRecordEnvelope {
  readonly uri: string;
  readonly jws: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEnvelope(value: unknown): ProfileRecordEnvelope | null {
  if (!isRecord(value) || typeof value['uri'] !== 'string' || !isRecord(value['value'])) {
    return null;
  }
  const jws = value['value']['jws'];
  return typeof jws === 'string' ? { uri: value['uri'], jws } : null;
}

function invalid(reason: VerifiedPageErrorReason, detail: string): VerifiedPageResult {
  return { kind: 'invalid', reason, detail };
}

function resolutionFailure(error: HandleResolutionError): VerifiedPageResult {
  switch (error) {
    case 'unreachable':
      return invalid('unreachable', 'handle lookup could not reach its authoritative sources');
    case 'notFound':
      return invalid('notFound', 'the handle has no current profile binding');
    case 'insecureEndpoint':
      return invalid('insecureEndpoint', 'the handle attempted a non-HTTPS retrieval path');
    case 'malformedDid':
    case 'conflictingRecords':
      return invalid('handleResolutionFailed', `authoritative handle data is invalid: ${error}`);
    case 'unsupportedHandle':
    case 'invalidHandle':
      return invalid('malformedPayload', `handle is not supported: ${error}`);
  }
}

function withBinding(
  result: Extract<VerifiedPageResult, { readonly kind: 'verified' }>,
  handleBinding: VerifiedHandleBinding
): VerifiedPageResult {
  return { ...result, handleBinding };
}

async function readAtprotoProfile(
  handle: string,
  repoDid: string,
  io: AtprotoBindingIO
): Promise<VerifiedPageResult> {
  const fetched = await io.getRecord(repoDid, PROFILE_COLLECTION, PROFILE_RKEY);
  if (!fetched.ok) {
    return fetched.error === 'notFound'
      ? invalid('notFound', 'the ATProto repository has no Solidarity profile record')
      : fetched.error === 'insecureEndpoint'
        ? invalid('insecureEndpoint', 'the ATProto repository advertised an insecure endpoint')
        : invalid('unreachable', 'the ATProto profile repository is unreachable');
  }

  const envelope = readEnvelope(fetched.value);
  if (envelope === null)
    return invalid('malformedPayload', 'the ATProto profile record is malformed');
  const expectedUri = `at://${repoDid}/${PROFILE_COLLECTION}/${PROFILE_RKEY}`;
  if (envelope.uri !== expectedUri) {
    return invalid(
      'bindingMismatch',
      'the fetched ATProto record belongs to a different repository'
    );
  }

  const verified = verifyProfileJws(envelope.jws);
  if (verified.kind !== 'verified') return verified;
  const normalized = normalizeAtprotoHandle(handle);
  return withBinding(verified, {
    scheme: 'atproto',
    handle: normalized,
    state: verified.record.alsoKnownAs.includes(`at://${normalized}`) ? 'verified' : 'declared',
  });
}

async function readSourcedProfile(
  scheme: 'dns' | 'ens',
  handle: string,
  resolution: Extract<Awaited<ReturnType<typeof resolveHandle>>, { readonly ok: true }>,
  fetchNostrProfile: FetchNostrProfile
): Promise<VerifiedPageResult> {
  const source = resolution.value.sources?.[0];
  if (source === undefined) {
    return invalid(
      'profileSourceMissing',
      'the handle resolves to a DID but does not advertise a supported profile source'
    );
  }

  const fetched = await fetchNostrProfile(source.npub);
  if (fetched.kind !== 'verified') return fetched;
  if (fetched.record.did !== resolution.value.did) {
    return invalid('bindingMismatch', 'the retrieved signed profile belongs to a different DID');
  }

  const badge =
    scheme === 'dns'
      ? verifyDnsBinding(fetched.record, handle, resolution)
      : verifyEnsBinding(fetched.record, handle, resolution);
  return withBinding(fetched, { scheme, handle: badge.handle, state: badge.state });
}

/** Handle → DID/source → signed profile → bidirectional badge gate. Never throws. */
export async function resolveProfileByHandle(
  handle: string,
  options: ResolveProfileByHandleOptions = {}
): Promise<VerifiedPageResult> {
  const io = options.io ?? atprotoBindingIO;
  const resolvers = options.resolvers ?? DEFAULT_HANDLE_RESOLVERS;
  const resolverOptions = { schemeHint: options.schemeHint };
  const resolver = matchHandleResolver(handle, resolvers, resolverOptions);
  if (resolver === undefined)
    return invalid('malformedPayload', 'no handle resolver accepted this input');

  try {
    const resolution = await resolveHandle(handle, [resolver], io, resolverOptions);
    if (!resolution.ok) return resolutionFailure(resolution.error);
    if (resolver.scheme === 'atproto') {
      return await readAtprotoProfile(handle, resolution.value.did, io);
    }
    if (resolver.scheme === 'dns' || resolver.scheme === 'ens') {
      return await readSourcedProfile(
        resolver.scheme,
        handle,
        resolution,
        options.fetchNostrProfile ?? fetchVerifiedProfileByNpub
      );
    }
    return invalid(
      'malformedPayload',
      'the matched handle scheme is not supported for profile reads'
    );
  } catch {
    return invalid('unreachable', 'handle profile resolution did not complete');
  }
}
