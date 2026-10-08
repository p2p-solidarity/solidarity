import { describe, expect, it } from 'bun:test';

import {
  base64UrlEncode,
  bytesToUtf8,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  type Result,
  sha256Bytes,
  signJwtEs256,
  utf8ToBytes,
} from '@solidarity/shared';

import { decompressQR } from '../../src/cards/qrCompression';
import {
  buildPresentationProofPayload,
  buildPresentationProofQrPages,
  disclosureErrorI18nKey,
  initialPresentationClaimIds,
  isPresentationDisabled,
  type PresentationCredential,
  selectPresentationClaims,
} from '../../src/credentials/presentationProof';
import type { DisclosureError } from '../../src/credentials/selectiveDisclosure';
import type { StoredCredential } from '../../src/credentials/store';
import type { ProvableClaimEntity } from '../../src/identity';
import { buildPresentationQrPages } from '../../src/me/presentationQrPages';

function expectOk<T>(result: Result<T, DisclosureError>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

// ---- SD-JWT fixture helpers (RFC 9901 combined format) --------------------
const ISSUER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 5 + 2) & 0xff);
const ISSUER_DID = didKeyFromPublicKey(publicKeyFromPrivate(ISSUER_PRIV));
const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 3 + 1) & 0xff);
const HOLDER_DID = didKeyFromPublicKey(publicKeyFromPrivate(HOLDER_PRIV));

function makeDisclosure(salt: string, name: string, value: unknown): string {
  return base64UrlEncode(utf8ToBytes(JSON.stringify([salt, name, value])));
}
function sdDigest(disclosure: string): string {
  return base64UrlEncode(sha256Bytes(utf8ToBytes(disclosure)));
}

/** Build a signed SD-JWT whose `disclosable` claims are selectively
 *  disclosable, returning the combined string + a name→disclosure map. */
function buildSdJwtFixture(disclosable: Record<string, unknown>): {
  readonly combined: string;
  readonly byName: Record<string, string>;
} {
  const names = Object.keys(disclosable);
  const disclosures = names.map((name, i) => makeDisclosure(`salt-${i}`, name, disclosable[name]));
  const byName: Record<string, string> = {};
  names.forEach((name, i) => (byName[name] = disclosures[i] as string));
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER_DID,
    sub: HOLDER_DID,
    iat: now,
    exp: now + 3600,
    _sd_alg: 'sha-256',
    _sd: disclosures.map(sdDigest),
  };
  const issuerJwt = signJwtEs256({ alg: 'ES256', kid: `${ISSUER_DID}#0` }, payload, ISSUER_PRIV);
  return { combined: `${issuerJwt}~${disclosures.join('~')}~`, byName };
}

type QrEngine = {
  create: (
    value: string,
    opts: { readonly errorCorrectionLevel: 'M' }
  ) => unknown;
};

const now = new Date('2026-06-09T00:00:00Z');

const credential: Pick<StoredCredential, 'id' | 'holderDid' | 'rawJwt' | 'metadataTags'> = {
  id: 'passport-card',
  holderDid: 'did:key:z6MkHolder',
  rawJwt: '{"proof":"passport-proof","publicSignals":["sig-a"]}',
  metadataTags: ['mopro-noir'],
};

const ageClaim: ProvableClaimEntity = {
  id: 'claim-age',
  identityCardId: 'passport-card',
  claimType: 'age_over_18',
  title: 'I am over 18',
  issuerType: 'government',
  trustLevel: 'L3',
  source: 'Passport',
  payload: '{"claim":"age_over_18"}',
  isPresentable: true,
  createdAt: now,
  updatedAt: now,
};

const humanClaim: ProvableClaimEntity = {
  id: 'claim-human',
  identityCardId: 'passport-card',
  claimType: 'is_human',
  title: 'I am human',
  issuerType: 'government',
  trustLevel: 'L3',
  source: 'Passport',
  payload: '{"claim":"is_human"}',
  isPresentable: true,
  createdAt: now,
  updatedAt: now,
};

const claims: readonly ProvableClaimEntity[] = [ageClaim, humanClaim];

async function loadQrEngine(): Promise<QrEngine | null> {
  try {
    const dynamicImport = (id: string): Promise<unknown> => import(id);
    const raw = (await dynamicImport('qrcode')) as {
      readonly create?: QrEngine['create'];
      readonly default?: { readonly create?: QrEngine['create'] };
    };
    const candidate = raw.default ?? raw;
    return typeof candidate.create === 'function'
      ? { create: candidate.create }
      : null;
  } catch {
    return null;
  }
}

function decodePayload(payload: string): Record<string, unknown> {
  const decompressed = payload.startsWith('sce1:')
    ? decompressQR(payload)
    : null;
  const json = decompressed ? bytesToUtf8(decompressed) : payload;
  return JSON.parse(json) as Record<string, unknown>;
}

describe('presentation proof helpers', () => {
  it('preselects every associated claim so Show proof is immediately presentable', () => {
    const selected = initialPresentationClaimIds(claims);

    expect([...selected]).toEqual(['claim-age', 'claim-human']);
    expect(isPresentationDisabled(selected)).toBe(false);
    expect(selectPresentationClaims(claims, selected).map((c) => c.id)).toEqual([
      'claim-age',
      'claim-human',
    ]);
  });

  it('preselects only the requested claim when Show opens from a disclosure row', () => {
    const selected = initialPresentationClaimIds(claims, 'claim-human');

    expect([...selected]).toEqual(['claim-human']);
    expect(isPresentationDisabled(selected)).toBe(false);
    expect(selectPresentationClaims(claims, selected).map((c) => c.claimType)).toEqual([
      'is_human',
    ]);
  });

  it('fails closed when the requested claim is unavailable', () => {
    const selected = initialPresentationClaimIds(claims, 'claim-not-available');

    expect([...selected]).toEqual([]);
    expect(isPresentationDisabled(selected)).toBe(true);
    expect(selectPresentationClaims(claims, selected)).toEqual([]);
  });

  it('treats an empty selection as no proof instead of silently falling back to all claims', () => {
    const selected = new Set<string>();

    expect(isPresentationDisabled(selected)).toBe(true);
    expect(selectPresentationClaims(claims, selected)).toEqual([]);
  });

  it('builds a Swift-shaped proof payload from the raw credential and selected claims', () => {
    const payload = expectOk(
      buildPresentationProofPayload({
        credential,
        selectedClaims: [humanClaim],
        nonce: 'fixed-nonce',
      }),
    );
    const vp = decodePayload(payload);

    expect(vp['@context']).toEqual(['https://www.w3.org/2018/credentials/v1']);
    expect(vp['type']).toEqual(['VerifiablePresentation']);
    expect(vp['holder']).toBe('did:key:z6MkHolder');
    expect(vp['nonce']).toBe('fixed-nonce');
    expect(vp['proof_type']).toBe('mopro-noir');
    expect(vp['selected_claims']).toEqual(['is_human']);
    expect(vp['verifiableCredential']).toEqual([
      { proof: 'passport-proof', publicSignals: ['sig-a'] },
    ]);
    expect(vp['claim_types']).toBeUndefined();
  });

  it('changes the QR payload when SD claim selection changes', () => {
    const allPayload = expectOk(
      buildPresentationProofPayload({
        credential,
        selectedClaims: claims,
        nonce: 'fixed-nonce',
      }),
    );
    const onePayload = expectOk(
      buildPresentationProofPayload({
        credential,
        selectedClaims: [ageClaim],
        nonce: 'fixed-nonce',
      }),
    );

    expect(allPayload).not.toBe(onePayload);
    expect(decodePayload(allPayload)['selected_claims']).toEqual([
      'age_over_18',
      'is_human',
    ]);
    expect(decodePayload(onePayload)['selected_claims']).toEqual(['age_over_18']);
  });

  it('still emits chunkable QR pages for the live preview renderer', () => {
    const pages = expectOk(
      buildPresentationProofQrPages(
        { credential, selectedClaims: claims, nonce: 'fixed-nonce' },
        { maxBytesPerChunk: 512 },
      ),
    );

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.payload.startsWith('sqc1.')).toBe(true);
  });

  it('keeps default chunk frames renderable by react-native-qrcode-svg ecl:M', async () => {
    const engine = await loadQrEngine();
    if (engine === null) return;

    const payload = Array.from({ length: 12_000 }, (_, i) =>
      String.fromCharCode(33 + (i % 90))
    ).join('');
    const pages = buildPresentationQrPages(payload);

    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(() => {
        engine.create(page.payload, { errorCorrectionLevel: 'M' });
      }).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Adversarial: the "selective disclosure" that used to leak the whole VC.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-09T00:00:00Z');

function claim(
  id: string,
  identityCardId: string,
  claimType: string,
): ProvableClaimEntity {
  return {
    id,
    identityCardId,
    claimType,
    title: claimType,
    issuerType: 'issuer',
    trustLevel: 'L1',
    source: 'Card',
    payload: '{}',
    isPresentable: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function signPlainVc(extraSubject: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwtEs256(
    { alg: 'ES256', kid: `${ISSUER_DID}#0` },
    {
      iss: ISSUER_DID,
      sub: HOLDER_DID,
      iat: now,
      exp: now + 3600,
      vc: {
        type: ['VerifiableCredential', 'BusinessCardCredential'],
        credentialSubject: { id: HOLDER_DID, name: 'Ada Lovelace', email: 'ada@example.com', ...extraSubject },
      },
    },
    ISSUER_PRIV,
  );
}

describe('presentation proof — no full-VC leak on a subset', () => {
  const nameClaim = claim('c-name', 'card-1', 'name');
  const emailClaim = claim('c-email', 'card-1', 'email');
  const allCardClaims = [nameClaim, emailClaim];

  it('FAILS CLOSED when only a subset of an ordinary JWT credential is selected (never leaks the rest)', () => {
    const plainCred: PresentationCredential = {
      id: 'card-1',
      holderDid: HOLDER_DID,
      rawJwt: signPlainVc(),
      metadataTags: ['jwt_vc_json', 'imported', 'did:key'],
    };

    const result = buildPresentationProofPayload({
      credential: plainCred,
      selectedClaims: [nameClaim], // subset of {name, email}
      allClaims: allCardClaims,
      nonce: 'n',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-redactable');
    // The whole point: there is NO payload at all, so the full VC (which
    // carries the un-selected `email`) cannot possibly be on the wire.
  });

  it('discloses an ordinary JWT credential IN FULL only when every claim is selected, with no misleading selected_claims', () => {
    const rawJwt = signPlainVc();
    const plainCred: PresentationCredential = {
      id: 'card-1',
      holderDid: HOLDER_DID,
      rawJwt,
      metadataTags: ['jwt_vc_json', 'imported', 'did:key'],
    };

    const payload = expectOk(
      buildPresentationProofPayload({
        credential: plainCred,
        selectedClaims: allCardClaims, // full disclosure
        allClaims: allCardClaims,
        nonce: 'n',
      }),
    );
    const vp = decodePayload(payload);

    expect(vp['disclosure']).toBe('full');
    // Honest: a whole-credential disclosure is NOT dressed up as selective.
    expect(vp['selected_claims']).toBeUndefined();
    expect(vp['verifiableCredential']).toEqual([rawJwt]);
  });

  it('SD-JWT subset: emits only the selected disclosure — the non-selected one is ABSENT, and no full VC is embedded', () => {
    const { combined, byName } = buildSdJwtFixture({
      age_over_18: true,
      nationality: 'JP',
    });
    const sdCred: PresentationCredential = {
      id: 'sd-1',
      holderDid: HOLDER_DID,
      rawJwt: combined,
      metadataTags: ['sd-jwt-fallback'],
    };

    const payload = expectOk(
      buildPresentationProofPayload({
        credential: sdCred,
        selectedClaims: [claim('c-age', 'sd-1', 'age_over_18')],
        allClaims: [
          claim('c-age', 'sd-1', 'age_over_18'),
          claim('c-nat', 'sd-1', 'nationality'),
        ],
        nonce: 'n',
      }),
    );
    const vp = decodePayload(payload);

    expect(vp['disclosure']).toBe('subset');
    // No full credential dump alongside the disclosures.
    expect(vp['verifiableCredential']).toBeUndefined();
    const sdJwt = vp['sd_jwt'] as string;
    // The selected disclosure is present; the withheld one is genuinely gone.
    expect(sdJwt.includes(byName['age_over_18'] as string)).toBe(true);
    expect(sdJwt.includes(byName['nationality'] as string)).toBe(false);
  });

  it('SD-JWT with an injected (unsigned) disclosure fails closed instead of presenting it', () => {
    const { combined } = buildSdJwtFixture({ age_over_18: true });
    const forged = makeDisclosure('evil-salt', 'is_admin', true);
    const tampered = `${combined}${forged}~`;
    const sdCred: PresentationCredential = {
      id: 'sd-2',
      holderDid: HOLDER_DID,
      rawJwt: tampered,
      metadataTags: ['sd-jwt-fallback'],
    };

    const result = buildPresentationProofPayload({
      credential: sdCred,
      selectedClaims: [claim('c-age', 'sd-2', 'age_over_18')],
      allClaims: [claim('c-age', 'sd-2', 'age_over_18')],
      nonce: 'n',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('altered-disclosure');
  });

  it('refuses to present a credential that failed import verification (unverified tag)', () => {
    const plainCred: PresentationCredential = {
      id: 'card-1',
      holderDid: HOLDER_DID,
      rawJwt: signPlainVc(),
      metadataTags: ['jwt_vc_json', 'imported', 'unverified'],
    };

    const result = buildPresentationProofPayload({
      credential: plainCred,
      selectedClaims: allCardClaims,
      allClaims: allCardClaims,
      nonce: 'n',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-redactable');
    expect(result.error.message).toContain('unverified');
  });

  // ZK honesty (CLAUDE.md): "Never present a fallback as a real ZK
  // attestation." An openac-v3 enrollment envelope holds only dsc_chain +
  // passport_adapter — `openac_show` is filtered out of enrollment proving
  // (passport/openacV3.ts) — so it proves NONE of the four claims. Pairing it
  // with `selected_claims` over-claims. Only a fresh openac_show proof, which
  // needs the device-local show-witness, is an honest disclosure.
  it('refuses to present an openac-v3 enrollment envelope as evidence of its claims', () => {
    const openAcV3Cred: PresentationCredential = {
      id: 'passport-card',
      holderDid: HOLDER_DID,
      rawJwt: '{"proof":"dsc-chain+passport-adapter","publicSignals":["a"]}',
      metadataTags: ['passport-openac-v3', 'passport-noir'],
    };

    const result = buildPresentationProofPayload({
      credential: openAcV3Cred,
      selectedClaims: allCardClaims,
      allClaims: allCardClaims,
      nonce: 'n',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('device-witness-missing');
    expect(result.error.message).toContain('openac_show');
    // The remedy shown to the user must NOT be "present all of it, or nothing"
    // (`disclosureNotRedactable`) — that is the over-claim this refusal stops.
    expect(disclosureErrorI18nKey(result.error)).toBe('present.rescanRequiredBody');
  });

  // The refusal must not depend on WHICH claims were selected: an empty or
  // single-claim selection is just as unprovable from this envelope.
  it('refuses the openac-v3 envelope regardless of how few claims are selected', () => {
    const openAcV3Cred: PresentationCredential = {
      id: 'passport-card',
      holderDid: HOLDER_DID,
      rawJwt: '{"proof":"dsc-chain+passport-adapter","publicSignals":["a"]}',
      metadataTags: ['passport-openac-v3'],
    };

    const result = buildPresentationProofPayload({
      credential: openAcV3Cred,
      selectedClaims: allCardClaims.slice(0, 1),
      allClaims: allCardClaims,
      nonce: 'n',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('device-witness-missing');
  });
});
