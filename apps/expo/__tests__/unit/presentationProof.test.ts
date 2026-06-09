import { describe, expect, it } from 'bun:test';

import { bytesToUtf8 } from '@solidarity/shared';

import { decompressQR } from '../../src/cards/qrCompression';
import {
  buildPresentationProofPayload,
  buildPresentationProofQrPages,
  initialPresentationClaimIds,
  isPresentationDisabled,
  selectPresentationClaims,
} from '../../src/credentials/presentationProof';
import type { StoredCredential } from '../../src/credentials/store';
import type { ProvableClaimEntity } from '../../src/identity';

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

  it('treats an empty selection as no proof instead of silently falling back to all claims', () => {
    const selected = new Set<string>();

    expect(isPresentationDisabled(selected)).toBe(true);
    expect(selectPresentationClaims(claims, selected)).toEqual([]);
  });

  it('builds a Swift-shaped proof payload from the raw credential and selected claims', () => {
    const payload = buildPresentationProofPayload({
      credential,
      selectedClaims: [humanClaim],
      nonce: 'fixed-nonce',
    });
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
    const allPayload = buildPresentationProofPayload({
      credential,
      selectedClaims: claims,
      nonce: 'fixed-nonce',
    });
    const onePayload = buildPresentationProofPayload({
      credential,
      selectedClaims: [ageClaim],
      nonce: 'fixed-nonce',
    });

    expect(allPayload).not.toBe(onePayload);
    expect(decodePayload(allPayload)['selected_claims']).toEqual([
      'age_over_18',
      'is_human',
    ]);
    expect(decodePayload(onePayload)['selected_claims']).toEqual(['age_over_18']);
  });

  it('still emits chunkable QR pages for the live preview renderer', () => {
    const pages = buildPresentationProofQrPages(
      { credential, selectedClaims: claims, nonce: 'fixed-nonce' },
      { maxBytesPerChunk: 512 },
    );

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.payload.startsWith('sqc1.')).toBe(true);
  });
});
