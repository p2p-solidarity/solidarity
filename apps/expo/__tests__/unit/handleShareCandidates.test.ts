/**
 * Round-trip proof for the `@handle` share URLs `meProfileModel.ts`
 * builds: every URL a share candidate produces must be recognised by BOTH
 * consumers a scanned/typed URL can hit — the deep-link parser
 * (`src/deeplink/parser.ts`, used for `https://` universal links) and the
 * scan classifier (`src/scan/verifiedPageHandler.ts`'s
 * `classifyVerifiedPagePayload`, used for camera-scanned QR payloads) —
 * and must decode back to the EXACT handle string the candidate encoded,
 * including the dns `:` scheme prefix (T2 brief §"dns colon-encoding
 * decision").
 */
import { describe, expect, it } from 'bun:test';

import { handleShareCandidates } from '@/components/me/meProfileModel';
import { parseDeepLink } from '@/deeplink/parser';
import { classifyVerifiedPagePayload } from '@/scan/verifiedPageHandler';
import {
  DEFAULT_HANDLE_RESOLVERS,
  matchHandleResolver,
  type ProfileRecord,
} from '@solidarity/shared';

const PROFILE: ProfileRecord = {
  v: 1,
  did: 'did:key:z6MkrJYzZkexamplelongidentifier',
  displayName: 'Alice',
  avatar: null,
  bio: '',
  links: [],
  alsoKnownAs: [],
  badges: [],
  supersededBy: null,
  updatedAt: '2026-07-16T00:00:00.000Z',
};

function candidateFor(alsoKnownAs: string): { readonly url: string; readonly handle: string } {
  const [candidate] = handleShareCandidates({ ...PROFILE, alsoKnownAs: [alsoKnownAs] });
  if (candidate === undefined) throw new Error(`expected a candidate for ${alsoKnownAs}`);
  return candidate;
}

describe('@handle share URL round-trip', () => {
  it('atproto: parseDeepLink recognises the bare handle route', () => {
    const candidate = candidateFor('at://alice.bsky.social');
    const route = parseDeepLink(candidate.url);
    expect(route).toEqual({ kind: 'verifiedHandle', handle: candidate.handle });
  });

  it('atproto: classifyVerifiedPagePayload recognises it as a scanned handle', () => {
    const candidate = candidateFor('at://alice.bsky.social');
    expect(classifyVerifiedPagePayload(candidate.url)).toEqual({
      kind: 'handle',
      handle: candidate.handle,
    });
  });

  it('ens: parseDeepLink recognises the bare .eth route', () => {
    const candidate = candidateFor('ens:alice.eth');
    expect(parseDeepLink(candidate.url)).toEqual({
      kind: 'verifiedHandle',
      handle: candidate.handle,
    });
  });

  it('ens: classifyVerifiedPagePayload recognises it as a scanned handle', () => {
    const candidate = candidateFor('ens:alice.eth');
    expect(classifyVerifiedPagePayload(candidate.url)).toEqual({
      kind: 'handle',
      handle: candidate.handle,
    });
  });

  it('dns: parseDeepLink decodes the dns: prefix back exactly (no percent-encoding lost)', () => {
    const candidate = candidateFor('dns:example.com');
    expect(candidate.url).toBe('https://creds.id/@dns:example.com');
    expect(parseDeepLink(candidate.url)).toEqual({
      kind: 'verifiedHandle',
      handle: 'dns:example.com',
    });
  });

  it('dns: classifyVerifiedPagePayload decodes the dns: prefix back exactly', () => {
    const candidate = candidateFor('dns:example.com');
    expect(classifyVerifiedPagePayload(candidate.url)).toEqual({
      kind: 'handle',
      handle: 'dns:example.com',
    });
  });

  it('dns: a bare (unprefixed) domain would misroute to atproto — proof the prefix is load-bearing', () => {
    // Same registry the deep-link parser and scan classifier both use
    // (`matchHandleResolver`/`DEFAULT_HANDLE_RESOLVERS`): a bare domain
    // resolves as ATPROTO, not DNS — exactly the ambiguity
    // `handleShareCandidates` avoids by keeping the `dns:` prefix on every
    // dns candidate's URL.
    expect(matchHandleResolver('example.com', DEFAULT_HANDLE_RESOLVERS)?.scheme).toBe('atproto');
    expect(matchHandleResolver('dns:example.com', DEFAULT_HANDLE_RESOLVERS)?.scheme).toBe('dns');
    // A dns candidate's URL round-trips through the deep-link parser as
    // the identical prefixed handle string, never the bare, misrouted form.
    const route = parseDeepLink('https://app.solidarity.gg/@example.com');
    expect(route).toEqual({ kind: 'verifiedHandle', handle: 'example.com' });
  });
});
