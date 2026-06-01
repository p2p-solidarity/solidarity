import { describe, expect, it } from 'bun:test';

import {
  base64UrlEncode,
  utf8ToBytes,
} from '@solidarity/shared';

import type { StoredCredential } from '../../src/credentials/store';
import {
  buildVcExportText,
  importCredentialJwts,
  parseVcExportText,
  storedCredentialFromJwt,
} from '../../src/credentials/vcImportExport';

const CREDENTIAL_ID = '33333333-4444-4555-8666-777777777777';
const IAT = 1_779_718_400;
const EXP = 1_782_310_400;

function jwt(payload: Readonly<Record<string, unknown>>): string {
  return [
    base64UrlEncode(utf8ToBytes(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))),
    base64UrlEncode(utf8ToBytes(JSON.stringify(payload))),
    'sig',
  ].join('.');
}

function businessCardJwt(id = CREDENTIAL_ID): string {
  return jwt({
    jti: `urn:uuid:${id}`,
    iss: 'did:key:zIssuer',
    sub: 'did:key:zHolder',
    iat: IAT,
    exp: EXP,
    vc: {
      type: ['VerifiableCredential', 'BusinessCardCredential'],
      credentialSubject: {
        id: 'did:key:zHolder',
        subject_core: {
          name: 'Ada Lovelace',
          businessCardId: 'card-1',
        },
      },
    },
  });
}

describe('VC import/export helpers', () => {
  it('round-trips the Swift-compatible JSON wrapper', () => {
    const text = buildVcExportText([businessCardJwt()]);

    expect(parseVcExportText(text)).toEqual([businessCardJwt()]);
  });

  it('derives a stored credential from a BusinessCardCredential JWT', () => {
    const stored = storedCredentialFromJwt(businessCardJwt());

    expect(stored).toMatchObject({
      id: CREDENTIAL_ID,
      type: 'business_card',
      title: 'Ada Lovelace',
      issuerDid: 'did:key:zIssuer',
      holderDid: 'did:key:zHolder',
      trustLevel: 'L1',
      issuedAt: new Date(IAT * 1000),
      expiresAt: new Date(EXP * 1000),
      metadataTags: ['jwt_vc_json', 'imported', 'did:key'],
      rawJwt: businessCardJwt(),
    });
  });

  it('imports only new credentials by id', async () => {
    const added: StoredCredential[] = [];
    const fresh = businessCardJwt('fresh');

    const result = await importCredentialJwts(
      [businessCardJwt(), businessCardJwt(), fresh],
      {
        existingIds: [CREDENTIAL_ID],
        addCredential: (credential) => {
          added.push(credential);
          return Promise.resolve();
        },
      }
    );

    expect(result).toEqual({ imported: 1, skipped: 2 });
    expect(added.map((credential) => credential.id)).toEqual(['fresh']);
  });
});
