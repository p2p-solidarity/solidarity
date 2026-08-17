import type { PassportShowScanResult } from '@/scan/showPresentationHandler';

export type PassportShowResultTranslator = (
  key: string,
  options?: Record<string, unknown>
) => string;

export interface PassportShowVerifierResultView {
  readonly valid: boolean;
  readonly title: string;
  readonly reason: string;
  readonly details: readonly string[];
}

/**
 * Disclosed details must come from proof public outputs only. Envelope fields
 * such as holderDid are holder-controlled display data and are not shown as
 * verified claims.
 */
export function passportShowVerifierResult(
  result: PassportShowScanResult,
  t: PassportShowResultTranslator
): PassportShowVerifierResultView {
  if (!result.ok) {
    return {
      valid: false,
      title: t('passportShow.resultInvalid'),
      reason: t('passportShow.resultInvalidReason'),
      details: [t('passportShow.resultInvalidBody')],
    };
  }

  const details: string[] = [];
  if (result.disclosed.age) {
    details.push(
      result.disclosed.age.satisfied
        ? t('passportShow.ageYes', { threshold: result.disclosed.age.threshold })
        : t('passportShow.ageNo', { threshold: result.disclosed.age.threshold })
    );
  }
  if (result.disclosed.nationality) {
    details.push(
      t('passportShow.nationality', { code: result.disclosed.nationality })
    );
  }

  return {
    valid: true,
    title:
      result.freshnessMode === 'challenge'
        ? t('passportShow.resultValid')
        : t('passportShow.resultValidTimeBucket'),
    reason:
      result.freshnessMode === 'challenge'
        ? t('passportShow.resultCheckedForScan')
        : t('passportShow.resultCheckedForWindow'),
    details,
  };
}
