/**
 * `src/pear/presentBuilder.ts` — pure claim-matching + synthetic-OIDC-request
 * logic for A5.3's SD-JWT-over-Pear presentation.
 */
import { describe, expect, it } from 'bun:test';

import type { StoredCredential } from '../../src/credentials/store';
import type { ProvableClaimEntity } from '../../src/identity/entities';
import {
  buildSyntheticPresentRequest,
  matchPresentableClaims,
} from '../../src/pear/presentBuilder';

function claim(
  id: string,
  claimType: string,
  overrides: Partial<ProvableClaimEntity> = {}
): ProvableClaimEntity {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    identityCardId: `cred-${id}`,
    claimType,
    title: `${claimType} claim`,
    issuerType: 'self',
    trustLevel: 'L1',
    source: 'test',
    payload: '{}',
    isPresentable: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function credential(
  id: string,
  metadataTags: readonly string[] = [],
  rawJwt = 'a.b.c'
): StoredCredential {
  return {
    id,
    type: 'test',
    title: 'Test credential',
    issuerDid: 'did:key:zIssuer',
    holderDid: 'did:key:zHolder',
    trustLevel: 'L1',
    rawJwt,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    metadataTags,
  };
}

describe('matchPresentableClaims', () => {
  it('excludes a ZK-proof-backed passport this mechanism cannot present', () => {
    // An openac-v3 passport is tagged `passport-openac-v3`/`passport-noir` and
    // NEVER `mopro-noir`/`semaphore-zk`, so a proof-type tag cannot recognise
    // it — but its rawJwt is a JSON proof blob, and `buildVpToken` wraps rawJwt
    // verbatim. Offering it produces a consent option that always fails
    // downstream ("not a verifiable JWT credential"), which is exactly the
    // dead-end this filter documents itself as preventing.
    const c = claim('1', 'age_over_18');
    const creds = new Map([[
      c.identityCardId,
      credential(c.identityCardId, ['passport-openac-v3', 'passport-noir'], '{"proof":"0xdeadbeef"}'),
    ]]);
    expect(matchPresentableClaims(['age_over_18'], [c], creds)).toEqual([]);
  });

  it('matches a presentable claim whose claimType was requested and whose credential is sd-jwt-fallback', () => {
    const c = claim('1', 'age_over_18');
    const creds = new Map([[c.identityCardId, credential(c.identityCardId)]]);
    const out = matchPresentableClaims(['age_over_18'], [c], creds);
    expect(out).toEqual([{ id: '1', claimType: 'age_over_18', title: 'age_over_18 claim' }]);
  });

  it('never over-discloses: a presentable claim whose type was NOT requested is excluded', () => {
    const requested = claim('1', 'age_over_18');
    const notRequested = claim('2', 'nationality');
    const creds = new Map([
      [requested.identityCardId, credential(requested.identityCardId)],
      [notRequested.identityCardId, credential(notRequested.identityCardId)],
    ]);
    const out = matchPresentableClaims(['age_over_18'], [requested, notRequested], creds);
    expect(out.map((m) => m.id)).toEqual(['1']);
  });

  it('excludes non-presentable claims even if the type matches', () => {
    const c = claim('1', 'age_over_18', { isPresentable: false });
    const creds = new Map([[c.identityCardId, credential(c.identityCardId)]]);
    const out = matchPresentableClaims(['age_over_18'], [c], creds);
    expect(out).toEqual([]);
  });

  it('excludes a claim whose backing credential no longer exists — never fabricates', () => {
    const c = claim('1', 'age_over_18');
    const out = matchPresentableClaims(['age_over_18'], [c], new Map());
    expect(out).toEqual([]);
  });

  it('excludes a claim backed by a ZK-only credential (mopro-noir) — buildVpToken cannot wrap it', () => {
    const c = claim('1', 'age_over_18');
    const creds = new Map([[c.identityCardId, credential(c.identityCardId, ['mopro-noir'])]]);
    const out = matchPresentableClaims(['age_over_18'], [c], creds);
    expect(out).toEqual([]);
  });

  it('excludes a claim backed by a ZK-only credential (semaphore-zk)', () => {
    const c = claim('1', 'age_over_18');
    const creds = new Map([[c.identityCardId, credential(c.identityCardId, ['semaphore-zk'])]]);
    const out = matchPresentableClaims(['age_over_18'], [c], creds);
    expect(out).toEqual([]);
  });

  it('includes a claim explicitly tagged sd-jwt-fallback', () => {
    const c = claim('1', 'age_over_18');
    const creds = new Map([[c.identityCardId, credential(c.identityCardId, ['sd-jwt-fallback'])]]);
    const out = matchPresentableClaims(['age_over_18'], [c], creds);
    expect(out).toHaveLength(1);
  });

  it('returns empty when nothing matches — the honest "no presentable credential" state', () => {
    const c = claim('1', 'is_human');
    const creds = new Map([[c.identityCardId, credential(c.identityCardId)]]);
    const out = matchPresentableClaims(['age_over_18'], [c], creds);
    expect(out).toEqual([]);
  });

  it('matches multiple requested types against multiple claims', () => {
    const a = claim('1', 'age_over_18');
    const b = claim('2', 'nationality');
    const c = claim('3', 'is_human');
    const creds = new Map([
      [a.identityCardId, credential(a.identityCardId)],
      [b.identityCardId, credential(b.identityCardId)],
      [c.identityCardId, credential(c.identityCardId)],
    ]);
    const out = matchPresentableClaims(['age_over_18', 'nationality'], [a, b, c], creds);
    expect(out.map((m) => m.id).sort()).toEqual(['1', '2']);
  });
});

describe('buildSyntheticPresentRequest', () => {
  it('marks the request source as "pear", never claiming it came from queryparams/a JWT', () => {
    const req = buildSyntheticPresentRequest(['age_over_18'], 'did:key:zAudience', 'nonce-1');
    expect(req.source).toBe('pear');
  });

  it('sets client_id to the supplied audience did (becomes the VP aud claim downstream)', () => {
    const req = buildSyntheticPresentRequest(['age_over_18'], 'did:key:zAudience', 'nonce-1');
    expect(req.request.client_id).toBe('did:key:zAudience');
  });

  it('carries the supplied nonce through unchanged', () => {
    const req = buildSyntheticPresentRequest(['age_over_18'], 'did:key:zAudience', 'nonce-xyz');
    expect(req.request.nonce).toBe('nonce-xyz');
  });

  it('builds one input_descriptor per requested claim type', () => {
    const req = buildSyntheticPresentRequest(['age_over_18', 'nationality'], 'did:key:zAudience', 'n');
    expect(req.request.presentation_definition?.input_descriptors.map((d) => d.id)).toEqual([
      'age_over_18',
      'nationality',
    ]);
  });
});
