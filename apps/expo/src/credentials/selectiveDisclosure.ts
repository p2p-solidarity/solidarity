/**
 * Selective-disclosure primitives — the honesty boundary between "the user
 * ticked some claim rows" and "the wire artifact actually discloses only
 * those claims".
 *
 * Two credential shapes reach a presentation builder today:
 *
 *   - an ordinary signed VC JWT (`<h>.<p>.<s>`) — ATOMIC. Deleting or copying
 *     fields client-side turns it into a self-assertion and breaks the issuer
 *     signature, so there is NO honest way to present a strict subset of it.
 *     The only honest options are "present the whole credential" or "refuse".
 *   - a ZK proof object (mopro-noir / semaphore-zk) — the proof itself IS the
 *     disclosure; it carries no raw fields to leak. Handled by the callers,
 *     not here.
 *
 * A real SD-JWT (RFC 9901 / draft-ietf-oauth-selective-disclosure-jwt) is the
 * one shape where a subset CAN be presented honestly: the issuer signs digests
 * of salted disclosures, so omitting a disclosure leaves the signature intact
 * and simply hides that claim. This module implements exactly that math —
 * parse the combined format, recompute digests, drop non-selected disclosures,
 * and (for the verifier) reject any disclosure whose digest the issuer never
 * signed (an injected / altered disclosure).
 *
 * Pure + dependency-injectable: only `@solidarity/shared` crypto helpers, no
 * RN / keychain / network. Security-path discipline — tagged `Result`, never
 * throw for an expected "can't disclose this" outcome, never log PII.
 */
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToUtf8,
  err,
  ok,
  type Result,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

export type CredentialFormat = 'sd-jwt' | 'jwt-vc' | 'zk-proof' | 'opaque';

export type DisclosureErrorCode =
  /** Ordinary JWT VC — a strict subset was requested but the credential is
   *  atomic, so redaction is impossible without forging a self-assertion. */
  | 'not-redactable'
  /** SD-JWT, but none of the selected claim names have a matching disclosure. */
  | 'unsatisfiable'
  /** A present disclosure's digest is not one the issuer signed — tampered. */
  | 'altered-disclosure'
  /** The credential could not be parsed into any known format. */
  | 'malformed'
  /** An OpenAC-v3 passport whose stored envelope proves none of its claims: a
   *  fresh `openac_show` proof is the only honest disclosure, and that needs
   *  the device-local show-witness this device does not hold. Distinct from
   *  `not-redactable` because the remedy is different — re-scan here, rather
   *  than "present all of it or nothing" (which would be the over-claim). */
  | 'device-witness-missing';

export interface DisclosureError {
  readonly code: DisclosureErrorCode;
  readonly message: string;
}

export function disclosureError(
  code: DisclosureErrorCode,
  message: string,
): DisclosureError {
  return { code, message };
}

/**
 * Classify a stored credential's `rawJwt` by its ON-DISK STRUCTURE, never by
 * a metadata tag — a `sd-jwt-fallback` tag on a plain JWT must NOT be trusted
 * to mean "safely redactable". A tampered tag cannot upgrade a plain JWT into
 * a redactable one; only the bytes decide.
 */
export function classifyCredentialFormat(rawJwt: string): CredentialFormat {
  const trimmed = rawJwt.trim();
  if (trimmed.length === 0) return 'opaque';
  // A ZK proof / structured object serialises as JSON — try that first so a
  // `{ "proof": ... }` blob never looks like a JWT.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'zk-proof';
    } catch {
      return 'opaque';
    }
  }
  if (trimmed.includes('~')) {
    return looksLikeSdJwt(trimmed) ? 'sd-jwt' : 'opaque';
  }
  return isThreePartJwt(trimmed) ? 'jwt-vc' : 'opaque';
}

function isThreePartJwt(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0);
}

function looksLikeSdJwt(combined: string): boolean {
  const parsed = parseSdJwt(combined);
  if (!parsed.ok) return false;
  const payload = decodeJwtPayload(parsed.value.issuerJwt);
  if (!payload) return false;
  // Real SD-JWTs advertise the disclosure hashing algorithm and/or carry `_sd`
  // digests. Requiring one of these stops a plain `a.b.c~garbage` string from
  // being treated as redactable.
  return collectSdDigests(payload).size > 0 || '_sd_alg' in payload;
}

export interface SdJwtParts {
  readonly issuerJwt: string;
  readonly disclosures: readonly string[];
  readonly keyBindingJwt?: string;
}

/**
 * Split the RFC 9901 combined format `<issuer-jwt>~<d1>~<d2>~...~[<kb-jwt>]`.
 * Disclosures are base64url of a JSON array (no `.`); a key-binding JWT, when
 * present as the final element, is a three-part JWT (two `.`s). A trailing `~`
 * with nothing after it means "no key binding".
 */
export function parseSdJwt(combined: string): Result<SdJwtParts, DisclosureError> {
  const segments = combined.split('~');
  const issuerJwt = segments[0];
  if (issuerJwt === undefined || !isThreePartJwt(issuerJwt)) {
    return err(disclosureError('malformed', 'SD-JWT issuer segment is not a JWT'));
  }
  const rest = segments.slice(1);
  // Drop a single trailing empty segment (the canonical trailing `~`).
  if (rest.length > 0 && rest[rest.length - 1] === '') rest.pop();
  let keyBindingJwt: string | undefined;
  const last = rest[rest.length - 1];
  if (last?.includes('.')) {
    keyBindingJwt = last;
    rest.pop();
  }
  if (rest.some((d) => d.length === 0)) {
    return err(disclosureError('malformed', 'SD-JWT has an empty disclosure segment'));
  }
  return ok({
    issuerJwt,
    disclosures: rest,
    ...(keyBindingJwt ? { keyBindingJwt } : {}),
  });
}

/** RFC 9901 disclosure digest: base64url(SHA-256(ASCII(disclosure))). */
export function sdDisclosureDigest(disclosure: string): string {
  return base64UrlEncode(sha256Bytes(utf8ToBytes(disclosure)));
}

export interface DecodedDisclosure {
  readonly salt: string;
  /** Object-property disclosures carry a name; array-element ones do not. */
  readonly name?: string;
  readonly value: unknown;
}

export function decodeSdDisclosure(
  disclosure: string,
): DecodedDisclosure | null {
  try {
    const arr = JSON.parse(bytesToUtf8(base64UrlDecode(disclosure))) as unknown;
    if (!Array.isArray(arr)) return null;
    if (arr.length === 3 && typeof arr[1] === 'string') {
      return { salt: String(arr[0]), name: arr[1], value: arr[2] };
    }
    if (arr.length === 2) {
      return { salt: String(arr[0]), value: arr[1] };
    }
    return null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const obj = JSON.parse(bytesToUtf8(base64UrlDecode(parts[1]))) as unknown;
    return obj && typeof obj === 'object' && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Every digest the issuer actually signed, gathered recursively from `_sd`
 *  arrays (object properties) and `{ "...": digest }` array-element forms. */
export function collectSdDigests(node: unknown): Set<string> {
  const out = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>)['...'] === 'string'
        ) {
          out.add((item as Record<string, unknown>)['...'] as string);
        } else {
          visit(item);
        }
      }
      return;
    }
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const sd = obj['_sd'];
      if (Array.isArray(sd)) {
        for (const d of sd) if (typeof d === 'string') out.add(d);
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === '_sd') continue;
        visit(v);
      }
    }
  };
  visit(node);
  return out;
}

/**
 * Produce a redacted SD-JWT that discloses ONLY the selected claim names.
 * Fail-closed:
 *   - a present disclosure whose digest the issuer never signed → the whole
 *     credential is rejected (`altered-disclosure`), never silently dropped;
 *   - a selection that matches no disclosure → `unsatisfiable`.
 * The issuer JWT and its signature are preserved byte-for-byte; only
 * non-selected disclosures are omitted. Any issuer-side key-binding JWT is
 * dropped — the presenter re-binds with its own holder signature.
 */
export function selectSdJwtDisclosures(
  combined: string,
  selectedClaimNames: ReadonlySet<string>,
): Result<string, DisclosureError> {
  const parsed = parseSdJwt(combined);
  if (!parsed.ok) return parsed;
  const payload = decodeJwtPayload(parsed.value.issuerJwt);
  if (!payload) {
    return err(disclosureError('malformed', 'SD-JWT issuer payload is not decodable'));
  }
  const signedDigests = collectSdDigests(payload);

  const kept: string[] = [];
  for (const disclosure of parsed.value.disclosures) {
    const digest = sdDisclosureDigest(disclosure);
    if (!signedDigests.has(digest)) {
      return err(
        disclosureError(
          'altered-disclosure',
          'SD-JWT carries a disclosure the issuer did not sign',
        ),
      );
    }
    const decoded = decodeSdDisclosure(disclosure);
    // Array-element disclosures (no name) can't be addressed by claim name;
    // keep only NAMED disclosures the caller selected.
    if (decoded?.name !== undefined && selectedClaimNames.has(decoded.name)) {
      kept.push(disclosure);
    }
  }

  if (selectedClaimNames.size > 0 && kept.length === 0) {
    return err(
      disclosureError(
        'unsatisfiable',
        'SD-JWT has no disclosures for the selected claims',
      ),
    );
  }

  const tail = kept.length > 0 ? `${kept.join('~')}~` : '';
  return ok(`${parsed.value.issuerJwt}~${tail}`);
}

export interface SdJwtVerification {
  readonly issuerJwt: string;
  /** Issuer payload with disclosed claims merged in and `_sd` removed. */
  readonly claims: Record<string, unknown>;
}

/**
 * Validate + reconstruct an SD-JWT's disclosed claims for the VERIFIER, given
 * the ALREADY-decoded issuer payload (the caller verifies the issuer signature
 * separately, so this never re-parses the compact JWS). Fail-closed: any
 * present disclosure whose digest is not in the signed set is an injected /
 * altered disclosure and rejects the whole credential.
 */
export function reconstructSdJwtClaims(
  issuerPayload: Record<string, unknown>,
  disclosures: readonly string[],
): Result<Record<string, unknown>, DisclosureError> {
  const byDigest = new Map<string, DecodedDisclosure>();
  for (const disclosure of disclosures) {
    const decoded = decodeSdDisclosure(disclosure);
    if (!decoded) {
      return err(disclosureError('malformed', 'SD-JWT disclosure is not decodable'));
    }
    byDigest.set(sdDisclosureDigest(disclosure), decoded);
  }
  const used = new Set<string>();

  const process = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const item of node) {
        if (
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>)['...'] === 'string'
        ) {
          const digest = (item as Record<string, unknown>)['...'] as string;
          const decoded = byDigest.get(digest);
          if (decoded) {
            used.add(digest);
            out.push(process(decoded.value));
          }
          // A digest with no matching disclosure = deliberately withheld; drop.
        } else {
          out.push(process(item));
        }
      }
      return out;
    }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === '_sd' || k === '_sd_alg') continue;
        result[k] = process(v);
      }
      const sd = obj['_sd'];
      if (Array.isArray(sd)) {
        for (const digest of sd) {
          if (typeof digest !== 'string') continue;
          const decoded = byDigest.get(digest);
          if (decoded?.name !== undefined) {
            used.add(digest);
            result[decoded.name] = process(decoded.value);
          }
        }
      }
      return result;
    }
    return node;
  };

  const claims = process(issuerPayload) as Record<string, unknown>;

  // Any disclosure whose digest the issuer never signed is an injected claim.
  for (const digest of byDigest.keys()) {
    if (!used.has(digest)) {
      return err(
        disclosureError(
          'altered-disclosure',
          'SD-JWT presents a disclosure not signed by the issuer',
        ),
      );
    }
  }
  return ok(claims);
}
