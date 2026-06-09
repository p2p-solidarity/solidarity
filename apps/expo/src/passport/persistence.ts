import { bytesToHex, sha256Bytes } from '@solidarity/shared';

import type { PassportMRZDraft } from './pipeline';

const PASSPORT_FINGERPRINT_DOMAIN = 'solidarity.passport.mrz-key.v1';

export const PASSPORT_FINGERPRINT_TAG_PREFIX = 'passport-fingerprint:';

export interface PassportFingerprintRecord {
  readonly id: string;
  readonly type: string;
  readonly metadataTags?: readonly string[];
}

export interface PassportDuplicate {
  readonly id: string;
  readonly fingerprint: string;
}

export function derivePassportFingerprint(
  draft: Pick<PassportMRZDraft, 'passportNumber' | 'nationalityCode' | 'dateOfBirth' | 'expiryDate'>
): string {
  const canonical = [
    PASSPORT_FINGERPRINT_DOMAIN,
    normalizeMrzField(draft.nationalityCode),
    normalizeMrzField(draft.passportNumber),
    normalizeMrzField(draft.dateOfBirth),
    normalizeMrzField(draft.expiryDate),
  ].join('|');
  return bytesToHex(sha256Bytes(canonical));
}

export function passportFingerprintTag(fingerprint: string): string {
  return `${PASSPORT_FINGERPRINT_TAG_PREFIX}${fingerprint.trim().toLowerCase()}`;
}

export function findPassportDuplicate(
  fingerprint: string,
  records: readonly PassportFingerprintRecord[]
): PassportDuplicate | null {
  const tag = passportFingerprintTag(fingerprint);
  const match = records.find(
    (record) => record.type === 'passport' && record.metadataTags?.includes(tag)
  );
  return match ? { id: match.id, fingerprint } : null;
}

function normalizeMrzField(value: string): string {
  return value.replace(/\s+/gu, '').toUpperCase();
}
