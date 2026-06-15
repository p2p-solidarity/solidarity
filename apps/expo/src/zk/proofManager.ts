/**
 * `ProofGenerationManager` — TS port of
 * solidarity/Services/ZK/ProofGenerationManager.swift
 * + ProofGenerationManager+Verification.swift (generate + verify paths).
 *
 * Scope: selective-disclosure proofs only. Attribute proofs and range proofs
 * (Swift's `generateAttributeProof` / `generateRangeProof`) are out of scope
 * — the zkProof QR envelope only attaches `sdProof`.
 *
 * Commitment format (must match Swift v2):
 *   `0x02 || SHA256("solidarity.fieldCommit.v2" || "<field>:<value>" || (recipient ?? "") || masterKey)`
 *
 * Canonical signing data (must match Swift):
 *   `businessCardId|<sorted-field-list>|<recipient ?? "">|<unix-seconds>` (UTF-8)
 *
 * Signature: raw P-256 ECDSA `r||s` (64 bytes). On iOS Swift this is the
 * direct CryptoKit `rawRepresentation`. On Expo we route through SpruceID
 * (hardware-backed Secure Enclave / StrongBox key) which wraps the signing
 * input as a JWS envelope; see `signRawEs256` in `signingKey.ts` for the
 * exact wrapping rule and the cross-platform implication captured in the
 * `verifySelectiveDisclosureProof` reason string.
 */
import {
  base64Decode,
  base64Encode,
  utf8ToBytes,
  uuid,
  type BusinessCard,
  type BusinessCardField,
} from '@solidarity/shared';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { signRawEs256, wrapRawSigningInputForSpruce } from '@/keychain/signingKey';
import { getMasterKey } from '@/storage/secureMasterKey';

import { formatSwiftIso8601 } from '@/cards/solidarityQrPayload';

/**
 * v2 commitment domain separator. Swift uses the same constant string
 * (ProofGenerationManager.swift:225). Bumping this version invalidates all
 * existing v2 commitments on both platforms.
 */
const COMMITMENT_DOMAIN_SEPARATOR = 'solidarity.fieldCommit.v2';
const COMMITMENT_VERSION_V2 = 0x02;

/**
 * Canonical iteration order for BusinessCardField commitments. Mirrors
 * Swift `BusinessCardField.allCases` (the synthesised CaseIterable order
 * matches the declaration order in solidarity/Models/BusinessCard.swift,
 * which in turn matches @solidarity/shared's `businessCardFieldSchema`).
 *
 * If this list ever diverges from Swift, cross-platform verification of
 * unselected-field commitments breaks silently. The selected-field
 * signature still verifies (canonical signing data sorts alphabetically),
 * but the recipient cannot recompute the hidden-field commitments.
 */
const ALL_FIELDS: readonly BusinessCardField[] = [
  'name',
  'title',
  'company',
  'email',
  'phone',
  'profileImage',
  'socialNetworks',
  'skills',
];

export interface SelectiveDisclosureProof {
  readonly proofId: string;
  readonly businessCardId: string;
  /** BusinessCardField → revealed UTF-8 value. Set excludes "name" only when
   * the user explicitly omits it (which the resolver prevents). */
  readonly disclosedFields: Readonly<Partial<Record<BusinessCardField, string>>>;
  /** BusinessCardField → base64(0x02 || sha256 digest). 33 raw bytes per entry. */
  readonly fieldCommitments: Readonly<Partial<Record<BusinessCardField, string>>>;
  readonly recipientId?: string;
  /** base64 of raw P-256 ECDSA signature (64 bytes: r||s). */
  readonly signature: string;
  /** base64 of raw P-256 public key (64 bytes: X||Y, no leading 0x04). */
  readonly signerPublicKey?: string;
  /** ISO 8601, matches `formatSwiftIso8601`. */
  readonly createdAt: string;
  /** ISO 8601, 24h after createdAt. Mirrors Swift Calendar.current.date(byAdding:.hour, value:24). */
  readonly expiresAt: string;
  /**
   * Internal marker so the verifier knows which signing-input wrapper to
   * apply. `'expo-v2'` = `signRawEs256` JWS wrapping (this file).
   * `'swift-v2'` = raw bytes ECDSA (Swift Codable path). When absent, we
   * assume `'swift-v2'` for backwards compatibility.
   */
  readonly format?: 'expo-v2' | 'swift-v2';
}

export interface ProofVerificationResult {
  readonly isValid: boolean;
  readonly reason?: string;
}

interface GenerateArgs {
  readonly businessCard: BusinessCard;
  readonly selectedFields: ReadonlySet<BusinessCardField>;
  readonly recipientId?: string;
  /** Override for tests; defaults to `new Date()`. */
  readonly now?: Date;
}

/**
 * Mirror Swift `ProofGenerationManager.getFieldValue(from:field:)`
 * (ProofGenerationManager.swift:98-110). The exact stringification for
 * `socialNetworks` and `skills` matches Swift byte-for-byte so commitments
 * recompute identically on the verifier side.
 */
function getFieldValue(card: BusinessCard, field: BusinessCardField): string {
  switch (field) {
    case 'name':
      return card.name;
    case 'title':
      return card.title ?? '';
    case 'company':
      return card.company ?? '';
    case 'email':
      return card.email ?? '';
    case 'phone':
      return card.phone ?? '';
    case 'profileImage':
      return card.profileImage ?? '';
    case 'socialNetworks':
      return card.socialNetworks
        .map((p) => `${p.platform}: ${p.username}`)
        .join(', ');
    case 'skills':
      return card.skills.map((s) => s.name).join(',');
  }
}

/**
 * v2 digest (32 bytes) — the SHA256 hash without the version byte. Exposed
 * so verifiers can recompute and compare deterministically. Matches Swift
 * `ProofGenerationManager.computeV2Digest(field:value:masterKey:recipientId:)`.
 */
export function computeV2Digest(args: {
  readonly field: BusinessCardField;
  readonly value: string;
  readonly masterKey: Uint8Array;
  readonly recipientId?: string;
}): Uint8Array {
  const domain = utf8ToBytes(COMMITMENT_DOMAIN_SEPARATOR);
  const fieldData = utf8ToBytes(`${args.field}:${args.value}`);
  const recipientData = utf8ToBytes(args.recipientId ?? '');
  const input = new Uint8Array(
    domain.length + fieldData.length + recipientData.length + args.masterKey.length
  );
  let offset = 0;
  input.set(domain, offset);
  offset += domain.length;
  input.set(fieldData, offset);
  offset += fieldData.length;
  input.set(recipientData, offset);
  offset += recipientData.length;
  input.set(args.masterKey, offset);
  return sha256(input);
}

/** v2 commitment (33 bytes): `0x02 || digest`. */
function v2Commitment(args: {
  readonly field: BusinessCardField;
  readonly value: string;
  readonly masterKey: Uint8Array;
  readonly recipientId?: string;
}): Uint8Array {
  const digest = computeV2Digest(args);
  const out = new Uint8Array(1 + digest.length);
  out[0] = COMMITMENT_VERSION_V2;
  out.set(digest, 1);
  return out;
}

/**
 * Canonical signing payload — `businessCardId|<sorted-fields>|<recipient>|<unix-secs>`.
 * Matches Swift `canonicalProofSigningData(businessCardId:selectedFields:recipientId:timestamp:)`
 * byte-for-byte.
 */
function canonicalSigningBytes(args: {
  readonly businessCardId: string;
  readonly selectedFields: ReadonlySet<BusinessCardField>;
  readonly recipientId?: string;
  readonly timestamp: Date;
}): Uint8Array {
  const sorted = [...args.selectedFields].sort();
  const ts = Math.floor(args.timestamp.getTime() / 1000).toString();
  const recipient = args.recipientId ?? '';
  const canonical = [
    args.businessCardId,
    sorted.join(','),
    recipient,
    ts,
  ].join('|');
  return utf8ToBytes(canonical);
}

/**
 * Generate a selective-disclosure proof for `businessCard`. Selected fields
 * are revealed verbatim; unselected fields are hidden behind a v2 commitment
 * so the recipient can later "open" them out-of-band by re-presenting the
 * value + shared salts.
 *
 * Returns a proof shaped EXACTLY like Swift's `SelectiveDisclosureProof`
 * (ProofModels.swift:10-26) — Data fields are base64-encoded so the JSON
 * Codable wire format matches Swift's default `Data` strategy.
 */
export async function generateSelectiveDisclosureProof(
  args: GenerateArgs
): Promise<SelectiveDisclosureProof> {
  const { businessCard, selectedFields, recipientId } = args;
  const now = args.now ?? new Date();
  const masterKey = await getMasterKey();

  const disclosedFields: Partial<Record<BusinessCardField, string>> = {};
  const fieldCommitments: Partial<Record<BusinessCardField, string>> = {};

  for (const field of ALL_FIELDS) {
    const value = getFieldValue(businessCard, field);
    if (selectedFields.has(field)) {
      disclosedFields[field] = value;
    } else {
      const commitment = v2Commitment({ field, value, masterKey, recipientId });
      fieldCommitments[field] = base64Encode(commitment);
    }
  }

  const canonical = canonicalSigningBytes({
    businessCardId: businessCard.id,
    selectedFields,
    recipientId,
    timestamp: now,
  });

  const { signature, publicKeyRaw } = await signRawEs256(canonical);

  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    proofId: uuid(),
    businessCardId: businessCard.id,
    disclosedFields,
    fieldCommitments,
    recipientId,
    signature: base64Encode(signature),
    signerPublicKey: base64Encode(publicKeyRaw),
    createdAt: formatSwiftIso8601(now),
    expiresAt: formatSwiftIso8601(expiresAt),
    format: 'expo-v2',
  };
}

/**
 * Verify a selective-disclosure proof. Checks expiration, business-card
 * identifier match, and the ECDSA signature over the canonical payload.
 *
 * Cross-platform: `proof.format` selects which signing-input rule to apply.
 * Expo v2 now signs SHA-256(canonical) through native raw P-256, matching
 * Swift's raw signature format without the old Spruce JWS wrapper.
 *
 * `signerPublicKey` is mandatory in v2. Returns `{ isValid: false }`
 * with a reason when missing — the legacy fallback to the local
 * KeyManager pair (Swift line 162-195) is out of scope for the Expo
 * port because the hardware-backed key never reaches JS.
 */
// Async signature kept for parity with Swift `verifySelectiveDisclosureProof`
// (returns `Result`; future iterations may need to await trust-anchor lookups
// or device-key resolution, neither of which has landed yet).
// eslint-disable-next-line @typescript-eslint/require-await
export async function verifySelectiveDisclosureProof(
  proof: SelectiveDisclosureProof,
  expectedBusinessCardId: string,
  now: Date = new Date()
): Promise<ProofVerificationResult> {
  // 1. Expiration.
  const expiresAt = parseIsoDate(proof.expiresAt);
  if (!expiresAt || expiresAt.getTime() < now.getTime()) {
    return { isValid: false, reason: 'Proof has expired' };
  }

  // 2. Business-card ID match.
  if (proof.businessCardId !== expectedBusinessCardId) {
    return { isValid: false, reason: 'Business card ID mismatch' };
  }

  // 3. Reconstruct canonical signing bytes.
  const createdAt = parseIsoDate(proof.createdAt);
  if (!createdAt) {
    return { isValid: false, reason: 'Failed to reconstruct proof data' };
  }
  const selectedFields = new Set<BusinessCardField>(
    Object.keys(proof.disclosedFields).filter((k): k is BusinessCardField =>
      (ALL_FIELDS as readonly string[]).includes(k)
    )
  );
  const canonical = canonicalSigningBytes({
    businessCardId: proof.businessCardId,
    selectedFields,
    recipientId: proof.recipientId,
    timestamp: createdAt,
  });

  // 4. Decode signature + public key.
  let sigBytes: Uint8Array;
  let pubBytes: Uint8Array;
  try {
    sigBytes = base64Decode(proof.signature);
  } catch {
    return { isValid: false, reason: 'Malformed signature' };
  }
  if (sigBytes.length !== 64) {
    return { isValid: false, reason: 'Invalid signature length' };
  }
  if (!proof.signerPublicKey) {
    return { isValid: false, reason: 'Missing signerPublicKey (v2 required)' };
  }
  try {
    pubBytes = base64Decode(proof.signerPublicKey);
  } catch {
    return { isValid: false, reason: 'Malformed signerPublicKey' };
  }
  if (pubBytes.length !== 64) {
    return { isValid: false, reason: 'Invalid signerPublicKey length' };
  }

  // 5. ECDSA verify. `wrapRawSigningInputForSpruce` returns the digest that
  //    native signed for Expo v2; Swift v2 signs SHA-256(canonical).
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(pubBytes, 1);

  // For Expo-generated proofs, the signed input is the JWS signing-input
  // bytes that wrap the canonical proof bytes. For Swift-generated proofs,
  // it's the canonical bytes directly. We try the platform that matches
  // `format`; if absent, fall back to "swift-v2" since pre-format proofs
  // came from Swift.
  const inputs: readonly Uint8Array[] =
    proof.format === 'expo-v2'
      ? [wrapRawSigningInputForSpruce(canonical)]
      : [sha256(canonical)];

  for (const input of inputs) {
    try {
      if (p256.verify(sigBytes, input, uncompressed, { prehash: false })) {
        return { isValid: true };
      }
    } catch {
      // Malformed signature bytes — fall through to the next format
      // candidate (none right now) or the invalid path.
    }
  }
  return { isValid: false, reason: 'Invalid signature' };
}

/**
 * Strict ISO 8601 parse. Returns null on malformed inputs so the caller
 * surfaces "Failed to reconstruct proof data" instead of throwing.
 */
function parseIsoDate(value: string): Date | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Re-export for tests that need to inspect the canonical wire format.
/** @internal — exposed for parity tests. */
export const _internal = {
  canonicalSigningBytes,
  computeV2Digest,
  v2Commitment,
  getFieldValue,
  ALL_FIELDS,
} as const;
