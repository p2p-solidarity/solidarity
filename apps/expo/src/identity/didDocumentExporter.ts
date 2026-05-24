/**
 * DIDDocumentExporter — TS port of
 * solidarity/Services/Identity/DIDDocumentExporter.swift +
 * the document construction in DIDService.swift.
 *
 * Emits a W3C-compliant DID document for the active DID, matching the
 * exact field order and codingKeys Swift's JSONEncoder produces with
 * `.sortedKeys` so iOS-exported documents byte-match TS-exported ones.
 */
import type { PublicKeyJWK } from '@solidarity/shared';

export interface DIDServiceEndpoint {
  readonly id: string;
  readonly type: string;
  readonly serviceEndpoint: string;
}

export interface DIDVerificationMethod {
  readonly id: string;
  readonly type: 'JsonWebKey2020';
  readonly controller: string;
  readonly publicKeyJwk: PublicKeyJWK;
}

export interface DidDocument {
  readonly '@context': readonly string[];
  readonly id: string;
  readonly verificationMethod: readonly DIDVerificationMethod[];
  readonly authentication: readonly string[];
  readonly assertionMethod: readonly string[];
  readonly service?: readonly DIDServiceEndpoint[];
}

const DEFAULT_VERIFICATION_FRAGMENT = 'keys-1';

export function buildDidDocument(
  activeDid: string,
  publicKeyJwk: PublicKeyJWK,
  services: readonly DIDServiceEndpoint[] = []
): DidDocument {
  const verificationMethodId = `${activeDid}#${DEFAULT_VERIFICATION_FRAGMENT}`;
  const verificationMethod: DIDVerificationMethod = {
    id: verificationMethodId,
    type: 'JsonWebKey2020',
    controller: activeDid,
    publicKeyJwk,
  };
  const document: DidDocument = {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: activeDid,
    verificationMethod: [verificationMethod],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    ...(services.length > 0 ? { service: services } : {}),
  };
  return document;
}

function sortedStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${sortedStringify((value as Record<string, unknown>)[k])}`
    );
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function encodeDidDocument(document: DidDocument, opts: { prettyPrinted?: boolean } = {}): string {
  if (opts.prettyPrinted) {
    return JSON.stringify(JSON.parse(sortedStringify(document)), null, 2);
  }
  return sortedStringify(document);
}
