import {
  decodeJwtUnsafe,
  type BusinessCard,
} from '@solidarity/shared';

import {
  buildDidSignedEnvelope,
  type ShareFieldPreferences,
  type SolidarityQrSigner,
} from '@/cards/solidarityQrPayload';
import type { StoredCredential } from './store';

export interface CreateDidKeyCredentialOptions {
  readonly now?: Date;
  readonly credentialId?: string;
  readonly shareFieldPreferences?: ShareFieldPreferences;
  readonly signer?: SolidarityQrSigner;
  readonly persistCredential?: (credential: StoredCredential) => Promise<void>;
}

interface DecodedBusinessCardCredential {
  readonly iat?: number;
  readonly exp?: number;
}

export async function createDidKeyBusinessCardCredential(
  card: BusinessCard,
  options: CreateDidKeyCredentialOptions = {}
): Promise<StoredCredential> {
  const signer = options.signer ?? await resolveDefaultSigner();
  const holderDid = signer.holderDid ?? signer.issuerDid;
  const envelope = await buildDidSignedEnvelope(card, {
    sharingLevel: 'professional',
    now: options.now,
    credentialId: options.credentialId,
    shareFieldPreferences: options.shareFieldPreferences,
    signer: { ...signer, holderDid },
  });
  const jwt = envelope?.didSigned?.jwt;
  if (!jwt) throw new Error('Failed to create did:key VC envelope.');

  const { payload } = decodeJwtUnsafe<DecodedBusinessCardCredential>(jwt);
  const issuedAtSec =
    payload.iat ?? Math.round((options.now ?? new Date()).getTime() / 1000);
  const credential: StoredCredential = {
    id: options.credentialId ?? envelope.shareId,
    type: 'business_card',
    title: 'Business Card',
    issuerDid: signer.issuerDid,
    holderDid,
    trustLevel: 'L1',
    rawJwt: jwt,
    issuedAt: new Date(issuedAtSec * 1000),
    ...(payload.exp ? { expiresAt: new Date(payload.exp * 1000) } : {}),
    metadataTags: ['jwt_vc_json', 'did:key', 'self_issued'],
  };
  await (options.persistCredential ?? persistToCredentialStore)(credential);
  return credential;
}

async function persistToCredentialStore(credential: StoredCredential): Promise<void> {
  const { useCredentialStore } = await import('./store');
  await useCredentialStore.getState().add(credential);
}

async function resolveDefaultSigner(): Promise<SolidarityQrSigner> {
  const {
    didKeyForCurrentIdentity,
    publicJwk,
    signJwt,
  } = await import('@/keychain/signingKey');
  const [issuerDid, jwk] = await Promise.all([
    didKeyForCurrentIdentity(),
    publicJwk(),
  ]);
  return {
    issuerDid,
    holderDid: issuerDid,
    publicKeyJwk: jwk,
    signJwt,
  };
}
