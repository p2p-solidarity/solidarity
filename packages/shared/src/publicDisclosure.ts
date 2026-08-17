/**
 * Root-signed, presence-only public disclosure records (NIP-78).
 *
 * v1 deliberately carries no passport evidence, identifier, digest, or card
 * key. The root identity only self-attests that this device completed its
 * local passport flow and holds the named abstract claim. A later record
 * version can add externally-issued evidence after its issuer-trust path is
 * implemented; it must not be smuggled into this closed v1 shape.
 */
import { z } from 'zod';

import { signCompact, verifyCompact, type Signer } from './jws';
import { err, ok, type Result } from './types/result';

export const PUBLIC_DISCLOSURE_VERSION = 1;
export const PUBLIC_DISCLOSURE_TYP = 'solidarity.publicDisclosure.v1';
export const PUBLIC_DISCLOSURE_BADGE_TYPE = PUBLIC_DISCLOSURE_TYP;
export const PUBLIC_DISCLOSURE_D_TAG_PREFIX = 'solidarity.disclosure.public.v1:';
export const PUBLIC_DISCLOSURE_KIND = 30078;

/** Nationality is intentionally absent in presence-only v1. */
export const PUBLIC_DISCLOSURE_CLAIMS = ['age_over_18', 'age_over_21'] as const;
export type PublicDisclosureClaim = (typeof PUBLIC_DISCLOSURE_CLAIMS)[number];

const PUBLIC_DISCLOSURE_CLAIM_SET: ReadonlySet<string> = new Set(
  PUBLIC_DISCLOSURE_CLAIMS
);

/** Public records expire after at most 30 days. */
export const PUBLIC_DISCLOSURE_MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const PUBLIC_DISCLOSURE_MAX_SKEW_SECONDS = 120;

export interface PublicDisclosureRecordV1 {
  readonly v: 1;
  readonly typ: 'solidarity.publicDisclosure.v1';
  readonly subject: string;
  readonly slot: string;
  readonly claim: PublicDisclosureClaim;
  readonly evidence: {
    readonly format: 'presence';
    /** Closed by the verifier: this is the entire v1 evidence value. */
    readonly value: { readonly claim: PublicDisclosureClaim };
  };
  /** Integer Unix seconds. */
  readonly issuedAt: number;
  /** Integer Unix seconds. */
  readonly expiresAt: number;
}

export interface BuildPublicDisclosureParams {
  readonly subject: string;
  readonly slot: string;
  readonly claim: PublicDisclosureClaim;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type PublicDisclosureVerifyError =
  | { readonly kind: 'malformedEnvelope'; readonly detail: string }
  | { readonly kind: 'signatureInvalid'; readonly detail: string }
  | { readonly kind: 'schemaInvalid'; readonly detail: string }
  | { readonly kind: 'subjectMismatch'; readonly detail: string }
  | { readonly kind: 'claimNotAllowed'; readonly detail: string }
  | { readonly kind: 'forbiddenEvidence'; readonly detail: string }
  | { readonly kind: 'evidenceInvalid'; readonly detail: string }
  | { readonly kind: 'expiryInvalid'; readonly detail: string };

export interface PublicDisclosurePointerError {
  readonly kind: 'invalidPointer';
  readonly detail: string;
}

export interface PublicDisclosureAttestationPointerV1 {
  readonly kind: 30078;
  readonly pubkeyHex: string;
  readonly dTag: string;
  readonly slot: string;
}

export interface PublicDisclosureBadgeReferenceV1 {
  readonly type: 'solidarity.publicDisclosure.v1';
  readonly subject: PublicDisclosureClaim;
  readonly attestation: string;
}

export interface VerifyPublicDisclosureOptions {
  /** Epoch milliseconds; injectable so conformance vectors never age out. */
  readonly nowMs?: number;
}

const SLOT_RE = /^[A-Za-z0-9_-]{16,128}$/u;
const NOSTR_PUBKEY_HEX_RE = /^[0-9a-f]{64}$/u;
const ATTESTATION_PREFIX = `nostr:${String(PUBLIC_DISCLOSURE_KIND)}:`;
const unixSeconds = z.number().int().nonnegative();

const publicDisclosureEnvelopeSchema = z
  .object({
    v: z.literal(PUBLIC_DISCLOSURE_VERSION),
    typ: z.literal(PUBLIC_DISCLOSURE_TYP),
    subject: z.string().min(1),
    slot: z.string().regex(SLOT_RE),
    claim: z.string(),
    evidence: z
      .object({
        format: z.literal('presence'),
        // Kept as an unknown record until the explicit forbidden-field gate.
        value: z.record(z.string(), z.unknown()),
      })
      .strict(),
    issuedAt: unixSeconds,
    expiresAt: unixSeconds,
  })
  .strict();

const presenceValueSchema = z.object({ claim: z.string() }).strict();

export function isPublicDisclosureClaim(value: string): value is PublicDisclosureClaim {
  return PUBLIC_DISCLOSURE_CLAIM_SET.has(value);
}

function validateSlot(slot: string): Result<string, PublicDisclosurePointerError> {
  return SLOT_RE.test(slot)
    ? ok(slot)
    : err({
        kind: 'invalidPointer',
        detail: 'slot must be 16-128 URL-safe opaque characters',
      });
}

export function buildPublicDisclosureDTag(
  slot: string
): Result<string, PublicDisclosurePointerError> {
  const validated = validateSlot(slot);
  return validated.ok
    ? ok(`${PUBLIC_DISCLOSURE_D_TAG_PREFIX}${validated.value}`)
    : validated;
}

/** Build the exact opaque pointer stored in `ProfileRecord.badges[]`. */
export function buildPublicDisclosureAttestationPointer(
  pubkeyHex: string,
  slot: string
): Result<string, PublicDisclosurePointerError> {
  if (!NOSTR_PUBKEY_HEX_RE.test(pubkeyHex)) {
    return err({
      kind: 'invalidPointer',
      detail: 'Nostr pubkey must be 64 lowercase hex characters',
    });
  }
  const dTag = buildPublicDisclosureDTag(slot);
  return dTag.ok ? ok(`${ATTESTATION_PREFIX}${pubkeyHex}:${dTag.value}`) : dTag;
}

/** Parse + validate a v1 public-disclosure Nostr pointer. Never throws. */
export function parsePublicDisclosureAttestationPointer(
  pointer: string
): Result<PublicDisclosureAttestationPointerV1, PublicDisclosurePointerError> {
  if (!pointer.startsWith(ATTESTATION_PREFIX)) {
    return err({ kind: 'invalidPointer', detail: 'pointer prefix is invalid' });
  }
  const tail = pointer.slice(ATTESTATION_PREFIX.length);
  const pubkeyHex = tail.slice(0, 64);
  if (!NOSTR_PUBKEY_HEX_RE.test(pubkeyHex) || tail.charAt(64) !== ':') {
    return err({ kind: 'invalidPointer', detail: 'pointer Nostr pubkey is invalid' });
  }
  const dTag = tail.slice(65);
  if (!dTag.startsWith(PUBLIC_DISCLOSURE_D_TAG_PREFIX)) {
    return err({ kind: 'invalidPointer', detail: 'pointer d-tag prefix is invalid' });
  }
  const slot = dTag.slice(PUBLIC_DISCLOSURE_D_TAG_PREFIX.length);
  const validatedSlot = validateSlot(slot);
  if (!validatedSlot.ok) return validatedSlot;
  return ok({
    kind: PUBLIC_DISCLOSURE_KIND,
    pubkeyHex,
    dTag,
    slot: validatedSlot.value,
  });
}

export function buildPublicDisclosureBadgeReference(
  claim: PublicDisclosureClaim,
  pubkeyHex: string,
  slot: string
): Result<PublicDisclosureBadgeReferenceV1, PublicDisclosurePointerError> {
  const attestation = buildPublicDisclosureAttestationPointer(pubkeyHex, slot);
  if (!attestation.ok) return attestation;
  return ok({
    type: PUBLIC_DISCLOSURE_BADGE_TYPE,
    subject: claim,
    attestation: attestation.value,
  });
}

/** Pure builder: callers cannot supply or accidentally leak an evidence blob. */
export function buildPublicDisclosure(
  params: BuildPublicDisclosureParams
): PublicDisclosureRecordV1 {
  return {
    v: PUBLIC_DISCLOSURE_VERSION,
    typ: PUBLIC_DISCLOSURE_TYP,
    subject: params.subject,
    slot: params.slot,
    claim: params.claim,
    evidence: { format: 'presence', value: { claim: params.claim } },
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
  };
}

/** Root-sign a record; a subject/signer-DID mismatch is a caller bug. */
export async function signPublicDisclosure(
  record: PublicDisclosureRecordV1,
  rootDid: string,
  sign: Signer
): Promise<string> {
  if (record.subject !== rootDid) {
    throw new Error('signPublicDisclosure: rootDid must equal record.subject');
  }
  return signCompact(record, rootDid, sign);
}

function zodDetail(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`
    )
    .join('; ');
}

function checkLifetime(
  issuedAt: number,
  expiresAt: number,
  nowMs: number
): Result<void, string> {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    return err('verification clock must be a finite epoch-millisecond value');
  }
  const lifetime = expiresAt - issuedAt;
  if (lifetime <= 0) return err('expiresAt must be after issuedAt');
  if (lifetime > PUBLIC_DISCLOSURE_MAX_LIFETIME_SECONDS) {
    return err(
      `lifetime ${String(lifetime)}s exceeds ${String(PUBLIC_DISCLOSURE_MAX_LIFETIME_SECONDS)}s`
    );
  }
  const nowSeconds = nowMs / 1000;
  if (nowSeconds < issuedAt - PUBLIC_DISCLOSURE_MAX_SKEW_SECONDS) {
    return err('record is not yet valid');
  }
  if (nowSeconds > expiresAt) return err('record is expired');
  return ok(undefined);
}

/**
 * Verify a public disclosure against the pinned root identity. Signature
 * verification happens before any payload field is trusted. Every nested
 * object is closed, and `evidence.value` has a dedicated exact-key gate so
 * a valid signature can never legitimize a passport identifier hidden next
 * to the abstract claim. Never throws across the verification boundary.
 */
export function verifyPublicDisclosure(
  jws: string,
  expectedSubjectRootDid: string,
  options: VerifyPublicDisclosureOptions = {}
): Result<PublicDisclosureRecordV1, PublicDisclosureVerifyError> {
  try {
    if (jws.split('.').length !== 3) {
      return err({ kind: 'malformedEnvelope', detail: 'expected 3 JWS parts' });
    }

    const verified = verifyCompact(jws, expectedSubjectRootDid);
    if (!verified.ok) {
      return err({ kind: 'signatureInvalid', detail: verified.error });
    }

    const parsed = publicDisclosureEnvelopeSchema.safeParse(verified.value);
    if (!parsed.success) {
      return err({ kind: 'schemaInvalid', detail: zodDetail(parsed.error) });
    }
    const envelope = parsed.data;

    if (envelope.subject !== expectedSubjectRootDid) {
      return err({
        kind: 'subjectMismatch',
        detail: 'record subject does not match the expected root DID',
      });
    }
    if (!isPublicDisclosureClaim(envelope.claim)) {
      return err({
        kind: 'claimNotAllowed',
        detail: `claim is not publishable: ${envelope.claim}`,
      });
    }

    const evidenceKeys = Object.keys(envelope.evidence.value);
    const forbiddenKeys = evidenceKeys.filter((key) => key !== 'claim');
    if (forbiddenKeys.length > 0) {
      return err({
        kind: 'forbiddenEvidence',
        detail: `evidence.value contains forbidden field(s): ${forbiddenKeys.join(', ')}`,
      });
    }
    const presence = presenceValueSchema.safeParse(envelope.evidence.value);
    if (!presence.success) {
      return err({ kind: 'evidenceInvalid', detail: zodDetail(presence.error) });
    }
    if (presence.data.claim !== envelope.claim) {
      return err({
        kind: 'evidenceInvalid',
        detail: 'evidence claim does not match the record claim',
      });
    }

    const lifetime = checkLifetime(
      envelope.issuedAt,
      envelope.expiresAt,
      options.nowMs ?? Date.now()
    );
    if (!lifetime.ok) {
      return err({ kind: 'expiryInvalid', detail: lifetime.error });
    }

    return ok({
      v: PUBLIC_DISCLOSURE_VERSION,
      typ: PUBLIC_DISCLOSURE_TYP,
      subject: envelope.subject,
      slot: envelope.slot,
      claim: envelope.claim,
      evidence: {
        format: 'presence',
        value: { claim: envelope.claim },
      },
      issuedAt: envelope.issuedAt,
      expiresAt: envelope.expiresAt,
    });
  } catch {
    return err({
      kind: 'malformedEnvelope',
      detail: 'public disclosure verification failed safely',
    });
  }
}
