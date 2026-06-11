import { describe, expect, it } from 'bun:test';

import { base64Encode, bytesToHex, sha256Bytes, utf8ToBytes } from '@solidarity/shared';

import { compressForQR } from '../../src/cards/qrCompression';
import {
  buildPassportShowEnvelopeJson,
  type PassportShowPublicInputs,
} from '../../src/passport/showPresentation';
import {
  PASSPORT_SHOW_PUBLIC_INPUT_FIELD_COUNT,
  passportScopeToFieldDecimal,
} from '../../src/passport/showVerifier';
import {
  PASSPORT_SHOW_LINK_SCOPE,
  extractPassportShowEnvelopeJson,
  handlePassportShowScan,
  type PassportShowScanDeps,
} from '../../src/scan/showPresentationHandler';

const NOW = new Date('2026-06-12T08:00:00Z');
const NONCE = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 1) % 256);

function fieldBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function fixtureEnvelopeJson(): { envelopeJson: string; vkSha256: string } {
  const scopeDecimal = passportScopeToFieldDecimal(PASSPORT_SHOW_LINK_SCOPE);
  const fields: bigint[] = [
    1n,
    ...Array.from(NONCE, (b) => BigInt(b)),
    0n,
    BigInt(scopeDecimal),
    42n,
    2026n,
    6n,
    12n,
    18n,
    1n,
    1n,
    777n,
    888n,
    999n,
    1n,
    84n,
    87n,
    78n,
  ];
  if (fields.length !== PASSPORT_SHOW_PUBLIC_INPUT_FIELD_COUNT) {
    throw new Error('fixture field count drifted');
  }
  const proofBytes = new Uint8Array(fields.length * 32 + 32);
  fields.forEach((value, i) => proofBytes.set(fieldBytes(value), i * 32));

  const vkBytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 3) % 256);
  const publicInputs: PassportShowPublicInputs = {
    nonceHashB64: base64Encode(NONCE),
    linkScope: scopeDecimal,
    linkMode: false,
    epoch: '42',
    today: { year: 2026, month: 6, day: 12 },
    ageThreshold: 18,
    discloseAge: true,
    discloseNationality: true,
    commitmentX: '777',
    commitmentY: '888',
    linkTag: '999',
    outIsOlder: true,
    outNationality: 'TWN',
  };
  return {
    envelopeJson: buildPassportShowEnvelopeJson({
      proofB64: base64Encode(proofBytes),
      vkB64: base64Encode(vkBytes),
      publicInputs,
      freshness: 'challenge',
      holderDid: 'did:key:zHolder',
      selectedClaims: ['age_over_18'],
    }),
    vkSha256: bytesToHex(sha256Bytes(vkBytes)),
  };
}

function depsFor(
  vkSha256: string,
  overrides: Partial<PassportShowScanDeps> = {}
): PassportShowScanDeps {
  return {
    verifyNoirProof: async () => true,
    vkPins: { buildPin: vkSha256, selfPin: null },
    consumeChallenge: () => NONCE,
    now: NOW,
    ...overrides,
  };
}

describe('passport show scan routing', () => {
  it('detects raw and sce1-compressed envelopes, passes everything else through', () => {
    const { envelopeJson } = fixtureEnvelopeJson();
    expect(extractPassportShowEnvelopeJson(envelopeJson)).toBe(envelopeJson);

    const compressed = compressForQR(utf8ToBytes(envelopeJson));
    expect(compressed).not.toBe(null);
    if (compressed) {
      expect(extractPassportShowEnvelopeJson(compressed)).toBe(envelopeJson);
    }

    expect(extractPassportShowEnvelopeJson('{"hello":"world"}')).toBe(null);
    expect(extractPassportShowEnvelopeJson('BEGIN:VCARD')).toBe(null);
    expect(
      extractPassportShowEnvelopeJson(
        '{"note":"gg.solidarity.passport.show-presentation.v1"}'
      )
    ).toBe(null);
  });

  it('verifies a challenge-mode presentation against the outstanding nonce', async () => {
    const { envelopeJson, vkSha256 } = fixtureEnvelopeJson();
    const result = await handlePassportShowScan(envelopeJson, depsFor(vkSha256));
    expect(result).not.toBe(null);
    expect(result?.ok).toBe(true);
  });

  it('uses parsed freshness for pretty-printed challenge envelopes', async () => {
    const { envelopeJson, vkSha256 } = fixtureEnvelopeJson();
    const prettyEnvelopeJson = JSON.stringify(JSON.parse(envelopeJson), null, 2);
    let consumed = false;
    const result = await handlePassportShowScan(
      prettyEnvelopeJson,
      depsFor(vkSha256, {
        consumeChallenge: () => {
          consumed = true;
          return NONCE;
        },
      })
    );

    expect(consumed).toBe(true);
    expect(result?.ok).toBe(true);
  });

  it('rejects challenge-mode presentations when no challenge is outstanding', async () => {
    const { envelopeJson, vkSha256 } = fixtureEnvelopeJson();
    const result = await handlePassportShowScan(
      envelopeJson,
      depsFor(vkSha256, { consumeChallenge: () => null })
    );
    expect(result).toEqual({ ok: false, reason: 'nonce-mismatch' });
  });

  it('fails closed for malformed payloads that declare the show schema', async () => {
    const result = await handlePassportShowScan(
      '{"schema":"gg.solidarity.passport.show-presentation.v1"}',
      {
        verifyNoirProof: null,
        vkPins: { buildPin: null, selfPin: null },
        consumeChallenge: () => null,
        now: NOW,
      }
    );
    expect(result).toEqual({ ok: false, reason: 'malformed-envelope' });
  });

  it('fails closed when the ZK verifier is not linked', async () => {
    const { envelopeJson, vkSha256 } = fixtureEnvelopeJson();
    const result = await handlePassportShowScan(
      envelopeJson,
      depsFor(vkSha256, { verifyNoirProof: null })
    );
    expect(result).toEqual({ ok: false, reason: 'zk-unavailable' });
  });

  it('returns null for non-show payloads without touching deps', async () => {
    const result = await handlePassportShowScan('sce1:not-actually-valid', {
      verifyNoirProof: null,
      vkPins: { buildPin: null, selfPin: null },
      consumeChallenge: () => null,
      now: NOW,
    });
    expect(result).toBe(null);
  });
});
