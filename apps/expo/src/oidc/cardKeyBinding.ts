import { signCompact, verifyCompact, type Signer } from '@solidarity/shared';

export const CARD_KEY_BINDING_TYPE = 'solidarity.cardKeyBinding.v1';
const DEFAULT_LIFETIME_SECONDS = 300;

export interface CardKeyBindingClaims {
  readonly typ: typeof CARD_KEY_BINDING_TYPE;
  readonly rootDid: string;
  readonly cardDid: string;
  readonly aud: string;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

export interface BuildCardKeyBindingInput {
  readonly rootDid: string;
  readonly cardDid: string;
  readonly audienceDid: string;
  readonly nonce: string;
  readonly sign: Signer;
  readonly now?: number;
  readonly lifetimeSeconds?: number;
}

export interface VerifyCardKeyBindingOptions {
  readonly expectedRootDid: string;
  readonly expectedCardDid: string;
  readonly expectedAud?: string;
  readonly expectedNonce?: string;
  readonly now?: number;
}

export async function buildCardKeyBindingJws(
  input: BuildCardKeyBindingInput
): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const lifetime = input.lifetimeSeconds ?? DEFAULT_LIFETIME_SECONDS;
  const payload: CardKeyBindingClaims = {
    typ: CARD_KEY_BINDING_TYPE,
    rootDid: input.rootDid,
    cardDid: input.cardDid,
    aud: input.audienceDid,
    nonce: input.nonce,
    iat: now,
    exp: now + lifetime,
  };
  return signCompact(payload, input.rootDid, input.sign);
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`card-key binding has invalid ${key}`);
  }
  return value;
}

function readNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`card-key binding has invalid ${key}`);
  }
  return value;
}

function toClaims(payload: object): CardKeyBindingClaims {
  const record = payload as Record<string, unknown>;
  return {
    typ: readString(record, 'typ') as typeof CARD_KEY_BINDING_TYPE,
    rootDid: readString(record, 'rootDid'),
    cardDid: readString(record, 'cardDid'),
    aud: readString(record, 'aud'),
    nonce: readString(record, 'nonce'),
    iat: readNumber(record, 'iat'),
    exp: readNumber(record, 'exp'),
  };
}

export function verifyCardKeyBindingJws(
  jws: string,
  opts: VerifyCardKeyBindingOptions
): CardKeyBindingClaims {
  const verified = verifyCompact(jws, opts.expectedRootDid);
  if (!verified.ok) {
    throw new Error(`card-key binding root DID verification failed: ${verified.error}`);
  }

  const claims = toClaims(verified.value);
  if (claims.typ !== CARD_KEY_BINDING_TYPE) {
    throw new Error(`card-key binding has wrong typ: ${claims.typ}`);
  }
  if (claims.rootDid !== opts.expectedRootDid) {
    throw new Error(
      `card-key binding root DID mismatch (expected ${opts.expectedRootDid}, got ${claims.rootDid})`
    );
  }
  if (claims.cardDid !== opts.expectedCardDid) {
    throw new Error(
      `card-key binding card DID mismatch (expected ${opts.expectedCardDid}, got ${claims.cardDid})`
    );
  }
  if (opts.expectedAud !== undefined && claims.aud !== opts.expectedAud) {
    throw new Error(
      `card-key binding aud mismatch (expected ${opts.expectedAud}, got ${claims.aud})`
    );
  }
  if (opts.expectedNonce !== undefined && claims.nonce !== opts.expectedNonce) {
    throw new Error('card-key binding nonce mismatch');
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (now >= claims.exp) {
    throw new Error(`card-key binding expired at ${String(claims.exp)}`);
  }
  if (now < claims.iat - 60) {
    throw new Error(`card-key binding issued in the future (iat=${String(claims.iat)})`);
  }
  return claims;
}
