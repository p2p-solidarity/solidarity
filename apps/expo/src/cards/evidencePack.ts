/**
 * Evidence pack (證據包) — the profile-side CRD1 pack from mock v3's
 * `pg-pack` sheet: the owner picks claims, watches the live character
 * budget, and mints ONE offline-verifiable QR (no PDF).
 *
 * Honesty rules (Rule 8 / CREDS.md):
 *   - A row is `verified` ONLY when the badge-status cache holds a completed
 *     live check whose state is `verified`; its `checkedAt` travels in the
 *     pack. `stale`/`declared` bindings and plain links ship as `declared`.
 *     `revoked` bindings are not packable at all.
 *   - No server countersignature and no transparency-log position — this
 *     app has neither; the pack carries exactly one signature (holder
 *     did:key) and claims nothing more.
 *
 * The identity row (display name + username + did) is the pack's subject and
 * is always included; binding and link rows are selectable.
 */
import {
  CRD1_MAX_VALIDITY_SECONDS,
  encodeCrd1,
  estimateCrd1,
  type Crd1Claims,
  type Crd1EncodeOutcome,
  type Crd1Signer,
  type ProfileRecord,
  type VerifyAtprotoBindingResult,
  type VerifyNostrBindingResult,
} from '@solidarity/shared';

import type { CachedBadgeResult } from '@/badges/badgeStatusCache';

export const EVIDENCE_PACK_TYP = 'gg.solidarity.evidence-pack.v1';

export interface EvidencePackRow {
  /** Stable selection id (kind + value). */
  readonly id: string;
  readonly kind: 'binding' | 'link';
  readonly label: string;
  readonly value: string;
  readonly status: 'verified' | 'declared';
  /** How the standing was established — only present when `verified`. */
  readonly method?: string;
  /** Epoch seconds of the completed live check — only when `verified`. */
  readonly checkedAt?: number;
}

export interface EvidencePackSource {
  readonly record: ProfileRecord;
  readonly username: string | null;
  readonly nostr: CachedBadgeResult<VerifyNostrBindingResult> | null;
  readonly atproto: CachedBadgeResult<VerifyAtprotoBindingResult> | null;
}

/** Selectable claim rows for the pack sheet, derived from real store state. */
export function buildEvidencePackRows(source: EvidencePackSource): readonly EvidencePackRow[] {
  const rows: EvidencePackRow[] = [];

  const nostr = source.nostr;
  if (nostr?.result.npub && nostr.result.state !== 'revoked') {
    rows.push(
      bindingRow('nostr', nostr.result.npub, nostr.result.state === 'verified', 'nostr kind-0 dual link', nostr.checkedAt)
    );
  }
  const atproto = source.atproto;
  if (atproto?.result.handle && atproto.result.state !== 'revoked') {
    rows.push(
      bindingRow('bluesky', atproto.result.handle, atproto.result.state === 'verified', 'atproto dual link', atproto.checkedAt)
    );
  }
  for (const link of source.record.links) {
    rows.push({
      id: `link:${link.url}`,
      kind: 'link',
      label: link.label.length > 0 ? link.label : link.url,
      value: link.url,
      status: 'declared',
    });
  }
  return rows;
}

function bindingRow(
  network: string,
  value: string,
  verified: boolean,
  method: string,
  checkedAtMs: number
): EvidencePackRow {
  return {
    id: `binding:${network}:${value}`,
    kind: 'binding',
    label: network,
    value,
    status: verified ? 'verified' : 'declared',
    ...(verified
      ? { method, checkedAt: Math.floor(checkedAtMs / 1000) }
      : {}),
  };
}

export interface EvidencePackClaims extends Crd1Claims {
  readonly typ: typeof EVIDENCE_PACK_TYP;
  readonly sub: string;
  readonly name: string;
  readonly username?: string;
  readonly claims: readonly {
    readonly kind: EvidencePackRow['kind'];
    readonly label: string;
    readonly value: string;
    readonly status: EvidencePackRow['status'];
    readonly method?: string;
    readonly checkedAt?: number;
  }[];
}

export function buildEvidencePackClaims(
  source: EvidencePackSource,
  selected: readonly EvidencePackRow[],
  now: Date = new Date()
): EvidencePackClaims {
  const iat = Math.floor(now.getTime() / 1000);
  return {
    typ: EVIDENCE_PACK_TYP,
    iss: source.record.did,
    sub: source.record.did,
    iat,
    exp: iat + CRD1_MAX_VALIDITY_SECONDS,
    name: source.record.displayName,
    ...(source.username ? { username: source.username } : {}),
    claims: selected.map((row) => ({
      kind: row.kind,
      label: row.label,
      value: row.value,
      status: row.status,
      ...(row.method ? { method: row.method } : {}),
      ...(row.checkedAt !== undefined ? { checkedAt: row.checkedAt } : {}),
    })),
  };
}

/** Live size for the counter + over-capacity gate — no signing, no prompt. */
export function estimateEvidencePack(
  source: EvidencePackSource,
  selected: readonly EvidencePackRow[],
  now?: Date
): Crd1EncodeOutcome {
  const claims = buildEvidencePackClaims(source, selected, now);
  return estimateCrd1(claims, source.record.did);
}

/** Sign the pack under the profile's root did:key. */
export async function signEvidencePack(
  source: EvidencePackSource,
  selected: readonly EvidencePackRow[],
  sign: Crd1Signer,
  now?: Date
): Promise<Crd1EncodeOutcome> {
  const claims = buildEvidencePackClaims(source, selected, now);
  return encodeCrd1(claims, source.record.did, sign);
}
