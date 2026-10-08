import {
  uuid,
  type BusinessCard,
  type BusinessCardField,
} from '@solidarity/shared';

import {
  buildSnapshot,
  formatSwiftIso8601,
  resolveSelectedFields,
  stableStringify,
  type QRCodeEnvelopePayload,
  type QRSharingPayload,
  type SelectiveDisclosureProof,
  type SolidarityQrPayloadOptions,
} from '@/cards/solidarityQrTypes';
import { buildDidSignedJwt } from '@/cards/didSignedCredentialPayload';

export {
  enabledFieldsFromSharePreferences,
  formatSwiftIso8601,
  shareFieldPreferencesFromFields,
  stableStringify,
  type QRCodeEnvelopePayload,
  type QRDidSignedPayload,
  type QRPlaintextPayload,
  type QRSharingPayload,
  type SelectiveDisclosureProof,
  type ShareFieldPreferences,
  type SharingFormat,
  type SolidarityQrPayloadOptions,
  type SolidarityQrSigner,
} from '@/cards/solidarityQrTypes';
export { buildDidSignedEnvelope } from '@/cards/didSignedCredentialPayload';

// Lazy-loaded so this module stays importable from environments (notably
// Bun's unit-test loader) that haven't installed an `expo-secure-store` shim.
// `encryptionManager` transitively pulls in `react-native`, which trips Bun's
// flow-syntax parser without a mock.
import type * as EncryptionManagerModuleNs from '@/storage/encryptionManager';
type EncryptionManagerModule = typeof EncryptionManagerModuleNs;
let encryptionManagerCache: EncryptionManagerModule | null = null;
async function loadEncryptionManager(): Promise<EncryptionManagerModule> {
  encryptionManagerCache ??= await import('@/storage/encryptionManager');
  return encryptionManagerCache;
}

export function buildSolidarityQrPayload(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): string {
  const sharingLevel = options.sharingLevel ?? 'professional';
  const shareId = options.shareId ?? uuid();
  const selectedFields = resolveSelectedFields(card, sharingLevel, options);
  const envelope: QRCodeEnvelopePayload = {
    version: 2,
    format: 'plaintext',
    sharingLevel,
    selectedFields,
    shareId,
    plaintext: {
      snapshot: buildSnapshot(card, selectedFields, options.sealedRoute),
      shareId,
      createdAt: formatSwiftIso8601(options.now ?? new Date()),
      expirationDate: options.expirationDate
        ? formatSwiftIso8601(options.expirationDate)
        : undefined,
      proofClaims: normalizeProofClaims(options.proofClaims),
      selectedFields,
    },
  };
  return stableStringify(envelope);
}

export async function buildSolidarityQrPayloadAsync(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): Promise<string> {
  if (card.sharingPreferences.sharingFormat === 'didSigned' && options.signer) {
    try {
      const signed = await buildDidSignedJwt(card, options);
      return signed.jwt;
    } catch {
      return buildSolidarityQrPayload(card, options);
    }
  }
  return buildSolidarityQrPayload(card, options);
}

/**
 * Build a zkProof envelope mirroring Swift `buildZKEnvelope`
 * (Services/Card/QRCodeGenerationService.swift L281-353).
 *
 * Same-sender escrow: `encryptJson` uses the user's master key, so the
 * recipient must hold the same key (synced via iCloud Keychain on iOS, or
 * explicitly restored from backup).
 *
 * Attaches three best-effort proofs (each independently failable):
 *   - `sdProof`            via `generateSelectiveDisclosureProof`
 *                          (when `useZK || sharingFormat==='zkProof'`)
 *   - `issuerProof`        via `generateIssuerProof` — Semaphore group
 *                          membership proof, serialised as the FULL
 *                          `SemaphoreProof` envelope JSON (the shape
 *                          `verifyGroupProof` consumes). Null when the user
 *                          isn't a member of any qualifying group. The local
 *                          `issuerCommitment` is deliberately NOT attached:
 *                          a commitment plus the group roster identifies the
 *                          presenter, defeating the proof's anonymity
 *                          (lists-anonymity audit 2026-08-18 §5 — a correct
 *                          Semaphore presentation reveals only
 *                          root/nullifier/signal, and the scan-side verifier
 *                          consumes only the proof envelope, never a
 *                          commitment).
 *   - `proofClaims`        filter of `ShareSettingsStore.selectedProofClaims`
 *                          intersected with the proofs that ACTUALLY landed
 *                          (Swift `filteredProofClaims` lines 354-369).
 *
 * Failure mode: each proof generator is wrapped in try/catch and logged via
 * console.warn; an envelope without proofs is still emitted so QR sharing
 * doesn't block on transient errors.
 */
export async function buildZKEnvelope(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): Promise<QRCodeEnvelopePayload> {
  const sharingLevel = options.sharingLevel ?? 'professional';
  const shareId = options.shareId ?? uuid();
  const selectedFields = resolveSelectedFields(card, sharingLevel, options);
  const now = options.now ?? new Date();
  // Swift default: now + 24h. Mirror that so unset expirations don't last forever.
  const expirationDate =
    options.expirationDate ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Generate the selective-disclosure proof when the card's preferences ask
  // for it (useZK toggle or explicit zkProof format). Lazy-imported so this
  // module stays importable from Bun's unit-test loader; the proof manager
  // pulls in @noble/curves + the SpruceID Nitro module.
  let sdProof: SelectiveDisclosureProof | undefined;
  if (
    card.sharingPreferences.useZK ||
    card.sharingPreferences.sharingFormat === 'zkProof'
  ) {
    try {
      const { generateSelectiveDisclosureProof } = await import(
        '@/zk/proofManager'
      );
      sdProof = await generateSelectiveDisclosureProof({
        businessCard: card,
        selectedFields: new Set(selectedFields),
        recipientId: undefined,
        now,
      });
    } catch (err) {
      console.warn('[buildZKEnvelope] sdProof generation failed', err);
    }
  }

  // Semaphore group-membership proof (best-effort). Skipped on platforms
  // where the native module isn't available or the user isn't in any
  // qualifying group.
  let issuerProof: string | undefined;
  try {
    const { generateIssuerProof, buildShareScope } = await import(
      '@/zk/issuerProof'
    );
    const scope = buildShareScope(selectedFields);
    const issuer = await generateIssuerProof({ message: shareId, scope });
    if (issuer) {
      issuerProof = issuer.proof;
    }
  } catch (err) {
    console.warn('[buildZKEnvelope] issuerProof generation failed', err);
  }

  const proofClaims = await filteredProofClaims({
    hasIssuerProof: issuerProof !== undefined,
    hasSdProof: sdProof !== undefined,
    selectedProofClaims: options.proofClaims,
  });

  const sharingPayload: QRSharingPayload = {
    businessCard: buildSnapshot(card, selectedFields, options.sealedRoute),
    sharingLevel,
    selectedFields,
    scope: buildShareScopeInline(selectedFields),
    expirationDate: formatSwiftIso8601(expirationDate),
    shareId,
    createdAt: formatSwiftIso8601(now),
    format: 'zkProof',
    sealedRoute: options.sealedRoute,
    issuerProof,
    sdProof,
    proofClaims,
  };

  const { encryptJson } = await loadEncryptionManager();
  const encryptedPayload = await encryptJson(sharingPayload);
  return {
    version: 2,
    format: 'zkProof',
    sharingLevel,
    selectedFields,
    shareId,
    encryptedPayload,
  };
}

/**
 * Lightweight inline mirror of `buildShareScope` from `@/zk/issuerProof`,
 * kept in this file to avoid a sync import of the ZK module at envelope
 * build time. Result MUST match `ShareScopeResolver.scope(selectedFields:)`
 * in Swift so the canonical scope string stays interoperable.
 */
function buildShareScopeInline(
  selectedFields: readonly BusinessCardField[]
): string {
  const normalised = new Set<string>(selectedFields);
  normalised.add('name');
  const sorted = [...normalised].sort();
  return `fields:${sorted.join(',')}`;
}

/**
 * Filter `ShareSettingsStore.selectedProofClaims` against the proofs that
 * actually landed in this envelope. Mirrors Swift `filteredProofClaims`
 * (QRCodeGenerationService.swift:354-369) one-to-one:
 *   - `is_human`    only when issuerProof was generated
 *   - `age_over_18` only when sdProof was generated
 *
 * Returns undefined when no claims survive (Swift returns nil to keep the
 * JSON Codable wire format clean).
 */
async function filteredProofClaims(args: {
  readonly hasIssuerProof: boolean;
  readonly hasSdProof: boolean;
  readonly selectedProofClaims?: readonly string[];
}): Promise<readonly string[] | undefined> {
  // Lazy-load the preferences module to dodge MMKV bootstrap during unit
  // tests that don't install the storage mock. On any failure we return
  // undefined — claims are advisory.
  let selected: readonly string[];
  if (args.selectedProofClaims !== undefined) {
    selected = args.selectedProofClaims;
  } else {
    try {
      const prefsMod = (await import('@/settings/preferences')) as {
        readonly usePreferences: {
          getState: () => {
            readonly shareIsHuman: boolean;
            readonly shareAgeOver18: boolean;
          };
        };
      };
      const state = prefsMod.usePreferences.getState();
      const out: string[] = [];
      if (state.shareIsHuman) out.push('is_human');
      if (state.shareAgeOver18) out.push('age_over_18');
      selected = out;
    } catch {
      return undefined;
    }
  }

  const filtered = normalizeProofClaims(selected)?.filter((claim) => {
    if (claim === 'is_human') return args.hasIssuerProof;
    if (claim === 'age_over_18') return args.hasSdProof;
    return false;
  }) ?? [];
  return filtered.length > 0 ? filtered : undefined;
}

function normalizeProofClaims(
  claims: readonly string[] | undefined
): readonly string[] | undefined {
  if (claims === undefined) return undefined;
  const selected = new Set(claims);
  const out: string[] = [];
  if (selected.has('is_human')) out.push('is_human');
  if (selected.has('age_over_18')) out.push('age_over_18');
  return out.length > 0 ? out : undefined;
}
