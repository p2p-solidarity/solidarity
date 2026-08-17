/**
 * `src/oidc/proofVerifier.ts` — `verifyVpToken` holder-binding hardening
 * (A5.3). Investigated while wiring SD-JWT presentation over the Pear
 * channel: the pre-existing implementation verified the OUTER VP signature
 * (self-certifying against its own `iss`/`kid` did:key) and verified EACH
 * embedded VC's own issuer signature independently, but never checked that
 * an embedded VC's holder (`sub`/`credentialSubject.id`) actually matches
 * the VP's own holder. That gap would let whoever controls the VP-signing
 * key wrap ANY credential JWT they merely hold a copy of — including one
 * bound to a different holder — and have it accepted. This suite pins the
 * fix: same-holder wraps verify; different-holder wraps are rejected.
 *
 * No mocking needed — `proofVerifier.ts` has zero store/keychain
 * dependencies, so it's directly callable with hand-signed fixtures (same
 * `signJwtEs256` primitive `spruceDid.parity.test.ts` uses).
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  signJwtEs256,
  signCompact,
  type Signer,
} from '@solidarity/shared';

import { verifyVpToken } from '../../src/oidc/proofVerifier';

const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);
const HOLDER_PUB = publicKeyFromPrivate(HOLDER_PRIV);
const HOLDER_DID = didKeyFromPublicKey(HOLDER_PUB);
const HOLDER_JWK = publicKeyToJwk(HOLDER_PUB);
void HOLDER_JWK;

const OTHER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
const OTHER_PUB = publicKeyFromPrivate(OTHER_PRIV);
const OTHER_DID = didKeyFromPublicKey(OTHER_PUB);

const ROOT_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 11 + 5) & 0xff);
const ROOT_PUB = publicKeyFromPrivate(ROOT_PRIV);
const ROOT_DID = didKeyFromPublicKey(ROOT_PUB);

const OTHER_ROOT_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 13 + 9) & 0xff);
const OTHER_ROOT_PUB = publicKeyFromPrivate(OTHER_ROOT_PRIV);
const OTHER_ROOT_DID = didKeyFromPublicKey(OTHER_ROOT_PUB);

const NOW = Math.floor(Date.now() / 1000);

function signVc(subjectDid: string, subjectPriv: Uint8Array): string {
  // Self-issued (`iss === sub`) for test simplicity — trust level isn't
  // what's under test here, holder binding is.
  return signJwtEs256(
    { alg: 'ES256', kid: `${subjectDid}#0` },
    { iss: subjectDid, sub: subjectDid, iat: NOW, exp: NOW + 3600 },
    subjectPriv
  );
}

function signVp(
  holderDid: string,
  holderPriv: Uint8Array,
  vcJwts: readonly string[],
  opts: { readonly aud?: string; readonly nonce?: string; readonly cardKeyBinding?: string } = {}
): string {
  return signJwtEs256(
    { alg: 'ES256', typ: 'vp+jwt', kid: `${holderDid}#0` },
    {
      iss: holderDid,
      sub: holderDid,
      iat: NOW,
      exp: NOW + 300,
      ...(opts.aud ? { aud: opts.aud } : {}),
      ...(opts.nonce ? { nonce: opts.nonce } : {}),
      ...(opts.cardKeyBinding ? { solidarity: { cardKeyBinding: opts.cardKeyBinding } } : {}),
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: vcJwts,
      },
    },
    holderPriv
  );
}

function signerFor(privateKey: Uint8Array): Signer {
  return async (digest) => p256.sign(digest, privateKey, { prehash: false });
}

async function signCardKeyBinding(opts: {
  readonly rootDid: string;
  readonly rootPriv: Uint8Array;
  readonly cardDid: string;
  readonly aud: string;
  readonly nonce: string;
}): Promise<string> {
  return signCompact(
    {
      typ: 'solidarity.cardKeyBinding.v1',
      rootDid: opts.rootDid,
      cardDid: opts.cardDid,
      aud: opts.aud,
      nonce: opts.nonce,
      iat: NOW,
      exp: NOW + 300,
    },
    opts.rootDid,
    signerFor(opts.rootPriv)
  );
}

async function expectRejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect(e instanceof Error ? e.message : String(e)).toMatch(pattern);
    return;
  }
  throw new Error('expected promise to reject');
}

describe('verifyVpToken — holder binding', () => {
  it('accepts a VP wrapping a VC bound to the SAME holder that signed the VP', async () => {
    const vc = signVc(HOLDER_DID, HOLDER_PRIV);
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [vc]);

    const result = await verifyVpToken(vp);
    expect(result.holderDid).toBe(HOLDER_DID);
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0]?.holderDid).toBe(HOLDER_DID);
  });

  it('REJECTS a VP wrapping a VC bound to a DIFFERENT holder — cannot present someone else\'s credential', async () => {
    // Holder signs the VP, but wraps a VC that was issued to (and bound to)
    // a different subject — the "presenting a borrowed credential" attack.
    const othersVc = signVc(OTHER_DID, OTHER_PRIV);
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [othersVc]);

    await expectRejectsWith(verifyVpToken(vp), /different holder/u);
  });

  it('rejects a VP wrapping a mix of own + someone-else\'s credentials (fail closed, not partial accept)', async () => {
    const ownVc = signVc(HOLDER_DID, HOLDER_PRIV);
    const othersVc = signVc(OTHER_DID, OTHER_PRIV);
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [ownVc, othersVc]);

    await expectRejectsWith(verifyVpToken(vp), /different holder/u);
  });

  it('still enforces the outer VP signature — a forged holder claim fails signature verification first', async () => {
    // "Other" tries to claim they are HOLDER_DID without HOLDER's key —
    // the outer signature check must fail before holder-binding is even
    // reached.
    const vc = signVc(HOLDER_DID, HOLDER_PRIV);
    const forgedVp = signVp(HOLDER_DID, OTHER_PRIV, [vc]);

    await expectRejectsWith(verifyVpToken(forgedVp), /signature/iu);
  });

  it('expectedAud rejects a VP minted for a different audience', async () => {
    const vc = signVc(HOLDER_DID, HOLDER_PRIV);
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [vc], { aud: 'did:key:zSomeOtherVerifier' });

    await expectRejectsWith(
      verifyVpToken(vp, { expectedAud: 'did:key:zMe' }),
      /aud mismatch/u
    );
  });

  it('expectedAud accepts a VP minted for exactly this verifier', async () => {
    const vc = signVc(HOLDER_DID, HOLDER_PRIV);
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [vc], { aud: 'did:key:zMe' });

    const result = await verifyVpToken(vp, { expectedAud: 'did:key:zMe' });
    expect(result.holderDid).toBe(HOLDER_DID);
  });

  it('expectedRootDid rejects a Pear VP with no root-to-card binding', async () => {
    const vc = signVc(HOLDER_DID, HOLDER_PRIV);
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [vc], {
      aud: 'did:key:zMe',
      nonce: 'pear-nonce',
    });

    await expectRejectsWith(
      verifyVpToken(vp, {
        expectedAud: 'did:key:zMe',
        expectedRootDid: ROOT_DID,
      }),
      /card-key binding/u
    );
  });

  it('expectedRootDid rejects a Pear VP whose card key is bound to a different root DID', async () => {
    const vc = signVc(HOLDER_DID, HOLDER_PRIV);
    const binding = await signCardKeyBinding({
      rootDid: ROOT_DID,
      rootPriv: ROOT_PRIV,
      cardDid: HOLDER_DID,
      aud: 'did:key:zMe',
      nonce: 'pear-nonce',
    });
    const vp = signVp(HOLDER_DID, HOLDER_PRIV, [vc], {
      aud: 'did:key:zMe',
      nonce: 'pear-nonce',
      cardKeyBinding: binding,
    });

    await expectRejectsWith(
      verifyVpToken(vp, {
        expectedAud: 'did:key:zMe',
        expectedRootDid: OTHER_ROOT_DID,
      }),
      /root DID/u
    );
  });
});
