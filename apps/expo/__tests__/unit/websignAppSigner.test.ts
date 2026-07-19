/**
 * webSign appSigner seam (src/websign/appSigner.ts) — the APP side of the
 * App↔Web per-action signing flow (research §4, T4a). Drives the seam with an
 * in-memory fake root/session signer (no RN, no Face ID, no keychain):
 *   - a freshly built+signed request reviews → approve produces a responseJws
 *     that `verifyWebSignResponse` accepts under the root did and yields the
 *     SAME record the request carried (the anti-substitution round trip);
 *   - a tampered request → review fails closed (signatureInvalid);
 *   - an expired request → review fails closed (expiryInvalid);
 *   - the per-field DIFF model computes added/removed/changed correctly, plus
 *     the initial (no current record) and no-change cases;
 *   - `approveWebSignRequest` refuses a draft whose `did` ≠ root did
 *     (didMismatch), and reports a signer failure as `signFailed` (never an
 *     uncaught rejection).
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  approveWebSignRequest,
  computeWebSignDiff,
  reviewWebSignRequest,
} from '../../src/websign/appSigner';
import {
  buildWebSignRequest,
  didKeyFromPublicKey,
  hexToBytes,
  publicKeyFromPrivate,
  signWebSignRequest,
  verifyWebSignResponse,
  type OutstandingWebSignRequest,
  type ProfileRecord,
  type Signer,
} from '@solidarity/shared';

const ROOT_PRIV = '11'.repeat(32);
const SESSION_PRIV = '22'.repeat(32);

const rootScalar = hexToBytes(ROOT_PRIV);
const sessionScalar = hexToBytes(SESSION_PRIV);
const ROOT_DID = didKeyFromPublicKey(publicKeyFromPrivate(rootScalar));
const SESSION_DID = didKeyFromPublicKey(publicKeyFromPrivate(sessionScalar));

const rootSigner: Signer = async (digest) => p256.sign(digest, rootScalar, { prehash: false });
const sessionSigner: Signer = async (digest) => p256.sign(digest, sessionScalar, { prehash: false });

const REQUEST_ID = Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
const NONCE = Buffer.from(new Uint8Array(16).fill(9)).toString('base64url');

const IAT = 1_700_000_000;
const EXP = IAT + 120;
const NOW_MS = (IAT + 10) * 1000;

const draft: ProfileRecord = {
  v: 1,
  did: ROOT_DID,
  displayName: 'Alice',
  avatar: null,
  bio: 'hello world',
  links: [{ label: 'Web', url: 'https://alice.example' }],
  alsoKnownAs: [],
  badges: [],
  supersededBy: null,
  updatedAt: '2026-07-19T00:00:00.000Z',
};

async function makeRequestJws(
  overrides: { readonly draft?: ProfileRecord; readonly iat?: number; readonly exp?: number } = {}
): Promise<string> {
  const req = buildWebSignRequest({
    requestId: REQUEST_ID,
    nonce: NONCE,
    originHint: 'https://app.solidarity.gg',
    webSessionDid: SESSION_DID,
    draft: overrides.draft ?? draft,
    iat: overrides.iat ?? IAT,
    exp: overrides.exp ?? EXP,
  });
  return signWebSignRequest(req, SESSION_DID, sessionSigner);
}

describe('reviewWebSignRequest + approveWebSignRequest — round trip', () => {
  it('signs the exact draft and returns a responseJws the shared verifier accepts', async () => {
    const jws = await makeRequestJws();
    const reviewed = reviewWebSignRequest(jws, { currentRecord: null, nowMs: NOW_MS });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;

    const approved = await approveWebSignRequest(reviewed.value, {
      rootDid: ROOT_DID,
      rootSigner,
      iat: IAT,
      exp: EXP,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const outstanding: OutstandingWebSignRequest = { jws, request: reviewed.value.request };
    const verified = verifyWebSignResponse(approved.value.responseJws, ROOT_DID, outstanding, {
      nowMs: NOW_MS,
    });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value).toEqual(draft);
  });

  it('rejects a tampered request (signatureInvalid)', async () => {
    const jws = await makeRequestJws();
    const parts = jws.split('.');
    const flipped = parts[2]!.startsWith('A') ? `B${parts[2]!.slice(1)}` : `A${parts[2]!.slice(1)}`;
    const tampered = `${parts[0]!}.${parts[1]!}.${flipped}`;
    const reviewed = reviewWebSignRequest(tampered, { currentRecord: null, nowMs: NOW_MS });
    expect(reviewed.ok).toBe(false);
    if (!reviewed.ok) expect(reviewed.error.kind).toBe('signatureInvalid');
  });

  it('rejects an expired request (expiryInvalid)', async () => {
    const jws = await makeRequestJws();
    const reviewed = reviewWebSignRequest(jws, {
      currentRecord: null,
      nowMs: (EXP + 30) * 1000,
    });
    expect(reviewed.ok).toBe(false);
    if (!reviewed.ok) expect(reviewed.error.kind).toBe('expiryInvalid');
  });

  it('refuses to sign a draft whose did is not the device root did (didMismatch)', async () => {
    const foreignDraft: ProfileRecord = { ...draft, did: SESSION_DID };
    const jws = await makeRequestJws({ draft: foreignDraft });
    const reviewed = reviewWebSignRequest(jws, { currentRecord: null, nowMs: NOW_MS });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    const approved = await approveWebSignRequest(reviewed.value, {
      rootDid: ROOT_DID,
      rootSigner,
      iat: IAT,
      exp: EXP,
    });
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.error.kind).toBe('didMismatch');
  });

  it('reports a signer rejection as signFailed, never an uncaught throw', async () => {
    const throwingSigner: Signer = async () => {
      throw new Error('biometric authentication required');
    };
    const jws = await makeRequestJws();
    const reviewed = reviewWebSignRequest(jws, { currentRecord: null, nowMs: NOW_MS });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    const approved = await approveWebSignRequest(reviewed.value, {
      rootDid: ROOT_DID,
      rootSigner: throwingSigner,
      iat: IAT,
      exp: EXP,
    });
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.error.kind).toBe('signFailed');
  });
});

describe('computeWebSignDiff', () => {
  it('computes added / removed / changed fields against a current record', () => {
    const current: ProfileRecord = {
      ...draft,
      displayName: 'Alice',
      bio: 'same bio',
      links: [
        { label: 'Web', url: 'https://alice.example' },
        { label: 'X', url: 'https://x.com/alice' },
      ],
      alsoKnownAs: ['at://alice.bsky.social'],
      badges: [],
    };
    const next: ProfileRecord = {
      ...draft,
      displayName: 'Alice Cooper',
      bio: 'same bio',
      links: [
        { label: 'Homepage', url: 'https://alice.example' },
        { label: 'GitHub', url: 'https://github.com/alice' },
      ],
      alsoKnownAs: [],
      badges: [{ type: 'solidarity.publicDisclosure.v1', subject: 'age_over_18', attestation: 'nostr:x' }],
    };

    const diff = computeWebSignDiff(current, next);
    expect(diff.isInitial).toBe(false);
    expect(diff.hasChanges).toBe(true);
    expect(diff.displayName.changed).toBe(true);
    expect(diff.bio.changed).toBe(false);
    expect(diff.links.added).toEqual([{ label: 'GitHub', url: 'https://github.com/alice' }]);
    expect(diff.links.removed).toEqual([{ label: 'X', url: 'https://x.com/alice' }]);
    expect(diff.links.changed).toEqual([
      { url: 'https://alice.example', before: 'Web', after: 'Homepage' },
    ]);
    expect(diff.alsoKnownAs.removed).toEqual(['at://alice.bsky.social']);
    expect(diff.alsoKnownAs.added).toEqual([]);
    expect(diff.badges.added.length).toBe(1);
    expect(diff.badges.removed.length).toBe(0);
  });

  it('treats a null current record as an initial (all-new) diff', () => {
    const diff = computeWebSignDiff(null, draft);
    expect(diff.isInitial).toBe(true);
    expect(diff.hasChanges).toBe(true);
    expect(diff.links.added).toEqual(draft.links);
  });

  it('reports no changes when the draft equals the current record', () => {
    const diff = computeWebSignDiff(draft, draft);
    expect(diff.isInitial).toBe(false);
    expect(diff.hasChanges).toBe(false);
    expect(diff.links.added).toEqual([]);
    expect(diff.links.removed).toEqual([]);
  });
});
