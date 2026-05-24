/**
 * BusinessCardEnvelope — TS port of
 * solidarity/Services/Identity/BusinessCardCredentialEnvelope.swift.
 *
 * Wraps a `BusinessCard` in a signed transfer envelope. Sender signs a JWT
 * with their hardware-backed key; receiver verifies against the sender
 * DID's resolved public JWK before persisting the card.
 *
 * The JWS lives in `signature` as a compact JWT (`<headerB64>.<payloadB64>.<sigB64>`).
 * `cardJson` mirrors Swift's deterministic JSON encoding so the receiver
 * computes the same digest the signer did.
 */
import { sha256 } from '@noble/hashes/sha2.js';

import {
  base64UrlEncode,
  businessCardSchema,
  err,
  ok,
  resolveDidKey,
  utf8ToBytes,
  verifyJwtEs256,
  type BusinessCard,
  type CardError,
  type PublicKeyJWK,
  type Result,
} from '@solidarity/shared';

import { publicJwk, signJwt } from '@/keychain/signingKey';

export type ResolverFn = (did: string) => Promise<PublicKeyJWK> | PublicKeyJWK;

export interface BusinessCardEnvelope {
  readonly version: 1;
  readonly senderDid: string;
  readonly recipientDid?: string;
  readonly issuedAt: string;
  readonly cardJson: string;
  readonly signature: string;
}

const ENVELOPE_VERSION = 1 as const;
const ENVELOPE_TYP = 'card-envelope+jwt';

interface EnvelopePayload {
  readonly iss: string;
  readonly sub: string;
  readonly iat: number;
  readonly cardDigest: string;
  readonly version: 1;
}

function canonicalCardJson(card: BusinessCard): string {
  const verifiedFields = card.verifiedFields
    ? Array.from(card.verifiedFields).sort()
    : undefined;
  const replacer = (_key: string, value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Set) return Array.from(value).sort();
    return value;
  };
  const payload = { ...card, verifiedFields };
  return JSON.stringify(payload, replacer);
}

function cardDigestBase64Url(cardJson: string): string {
  return base64UrlEncode(sha256(utf8ToBytes(cardJson)));
}

export async function wrap(
  card: BusinessCard,
  opts: { senderDid: string; recipientDid?: string }
): Promise<Result<BusinessCardEnvelope, CardError>> {
  try {
    const issuedAt = new Date().toISOString();
    const cardJson = canonicalCardJson(card);
    const payload: EnvelopePayload = {
      iss: opts.senderDid,
      sub: opts.recipientDid ?? '',
      iat: Math.floor(Date.now() / 1000),
      cardDigest: cardDigestBase64Url(cardJson),
      version: ENVELOPE_VERSION,
    };
    const jws = await signJwt(
      { alg: 'ES256', typ: ENVELOPE_TYP, kid: `${opts.senderDid}#keys-1` },
      payload as unknown as Record<string, unknown>
    );
    return ok({
      version: ENVELOPE_VERSION,
      senderDid: opts.senderDid,
      recipientDid: opts.recipientDid,
      issuedAt,
      cardJson,
      signature: jws,
    });
  } catch (error) {
    return err<CardError>({
      type: 'cryptographicError',
      message: `Failed to wrap business card: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function defaultResolver(did: string): Promise<PublicKeyJWK> {
  if (did.startsWith('did:key:')) return resolveDidKey(did);
  throw new Error(`unsupported sender DID method: ${did}`);
}

export async function unwrap(
  envelope: BusinessCardEnvelope,
  opts: { resolverFn?: ResolverFn } = {}
): Promise<Result<BusinessCard, CardError>> {
  if (envelope.version !== ENVELOPE_VERSION) {
    return err<CardError>({
      type: 'invalidData',
      message: `Unsupported envelope version: ${String(envelope.version)}`,
    });
  }
  try {
    const resolver = opts.resolverFn ?? defaultResolver;
    const jwk = await resolver(envelope.senderDid);
    const { payload } = verifyJwtEs256<EnvelopePayload>(envelope.signature, jwk);
    if (payload.iss !== envelope.senderDid) {
      return err<CardError>({
        type: 'cryptographicError',
        message: 'Envelope iss does not match senderDid',
      });
    }
    const expectedDigest = cardDigestBase64Url(envelope.cardJson);
    if (payload.cardDigest !== expectedDigest) {
      return err<CardError>({
        type: 'cryptographicError',
        message: 'Envelope card digest mismatch',
      });
    }
    const parsed = businessCardSchema.safeParse(JSON.parse(envelope.cardJson));
    if (!parsed.success) {
      return err<CardError>({
        type: 'invalidData',
        message: `Envelope card payload failed validation: ${parsed.error.message}`,
      });
    }
    return ok(parsed.data);
  } catch (error) {
    return err<CardError>({
      type: 'cryptographicError',
      message: `Failed to unwrap business card: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export async function senderPublicJwk(): Promise<PublicKeyJWK> {
  return publicJwk();
}
