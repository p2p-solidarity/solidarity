import { describe, expect, it } from 'bun:test';

import type { PassportMRZDraft } from '../../src/passport/pipeline';
import {
  PASSPORT_FINGERPRINT_TAG_PREFIX,
  derivePassportFingerprint,
  findPassportDuplicate,
  passportFingerprintTag,
} from '../../src/passport/persistence';

const MRZ: PassportMRZDraft = {
  passportNumber: 'L898902C36',
  nationalityCode: 'UTO',
  dateOfBirth: '740812',
  expiryDate: '120415',
};

describe('passport persistence duplicate guard', () => {
  it('derives a stable MRZ-key fingerprint from normalized passport fields', () => {
    const fingerprint = derivePassportFingerprint(MRZ);
    const samePassportDifferentInputCase = derivePassportFingerprint({
      passportNumber: ' l898902c36 ',
      nationalityCode: ' uto ',
      dateOfBirth: '740812',
      expiryDate: '120415',
    });

    expect(fingerprint).toBe('6a3e6dc2aaaf985d75757c39ac3344bb61b033633868d5e21b8137cb7a06ae88');
    expect(samePassportDifferentInputCase).toBe(fingerprint);
    expect(passportFingerprintTag(fingerprint)).toBe(
      `${PASSPORT_FINGERPRINT_TAG_PREFIX}${fingerprint}`
    );
  });

  it('finds an existing passport record by fingerprint tag before a new UUID is minted', () => {
    const fingerprint = derivePassportFingerprint(MRZ);
    const duplicate = findPassportDuplicate(fingerprint, [
      {
        id: 'student-card',
        type: 'student',
        metadataTags: [passportFingerprintTag(fingerprint)],
      },
      {
        id: 'passport-card',
        type: 'passport',
        metadataTags: [passportFingerprintTag(fingerprint)],
      },
      {
        id: 'other-passport',
        type: 'passport',
        metadataTags: [
          passportFingerprintTag(
            derivePassportFingerprint({
              ...MRZ,
              passportNumber: 'X12345678',
            })
          ),
        ],
      },
    ]);

    expect(duplicate).toEqual({
      id: 'passport-card',
      fingerprint,
    });
  });
});
