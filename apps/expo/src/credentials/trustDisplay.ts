import type { TrustLevel } from './store';

export type TrustDisplayTone = 'green' | 'blue' | 'white';

export interface CredentialTrustSubject {
  readonly type?: string;
  readonly source?: string;
  readonly trustLevel: TrustLevel;
  readonly metadataTags?: readonly string[];
  readonly status?: string;
  readonly proofType?: string;
  readonly payload?: string;
}

export interface CredentialTrustDisplay {
  readonly level: TrustLevel;
  readonly tone: TrustDisplayTone;
  readonly label: string;
  readonly i18nKey:
    | 'credentialDetail.levelL1'
    | 'credentialDetail.levelL2'
    | 'credentialDetail.levelL3'
    | 'credentialDetail.levelL3Plus';
}

export function passportTrustLevelFromProof(passportLevel: string): TrustLevel {
  switch (passportLevel) {
    case 'green':
      return 'L3+';
    case 'blue':
      return 'L3';
    default:
      return 'L1';
  }
}

export function credentialTrustDisplayFor(
  subject: CredentialTrustSubject
): CredentialTrustDisplay {
  const level = credentialTrustDisplayLevelFor(subject);
  return {
    level,
    tone: credentialTrustToneForLevel(level),
    label: credentialTrustLabelForLevel(level),
    i18nKey: credentialTrustI18nKeyForLevel(level),
  };
}

export function credentialTrustDisplayLevelFor(
  subject: CredentialTrustSubject
): TrustLevel {
  if (!isPassportSubject(subject)) {
    return subject.trustLevel;
  }
  if (hasPassportFallbackEvidence(subject)) {
    return 'L1';
  }
  if (subject.trustLevel === 'L2') {
    return 'L3';
  }
  return subject.trustLevel;
}

export function credentialTrustToneForLevel(level: TrustLevel): TrustDisplayTone {
  switch (level) {
    case 'L3+':
      return 'green';
    case 'L3':
    case 'L2':
      return 'blue';
    default:
      return 'white';
  }
}

export function credentialTrustLabelForLevel(level: TrustLevel): string {
  switch (level) {
    case 'L3+':
      return 'Level 3+ - Passport ZK + AA';
    case 'L3':
      return 'Level 3 - Passport ZK (No AA)';
    case 'L2':
      return 'Level 2 - Verified';
    default:
      return 'Level 1 - Fallback / Non-ZK';
  }
}

export function credentialTrustI18nKeyForLevel(
  level: TrustLevel
): CredentialTrustDisplay['i18nKey'] {
  switch (level) {
    case 'L3+':
      return 'credentialDetail.levelL3Plus';
    case 'L3':
      return 'credentialDetail.levelL3';
    case 'L2':
      return 'credentialDetail.levelL2';
    default:
      return 'credentialDetail.levelL1';
  }
}

function isPassportSubject(subject: CredentialTrustSubject): boolean {
  const type = subject.type?.toLowerCase();
  const source = subject.source?.toLowerCase();
  return type === 'passport' || source === 'passport';
}

function hasPassportFallbackEvidence(subject: CredentialTrustSubject): boolean {
  const tags = subject.metadataTags?.map((tag) => tag.toLowerCase()) ?? [];
  if (tags.includes('fallback') || tags.includes('sd-jwt-fallback')) {
    return true;
  }
  const status = subject.status?.toLowerCase();
  if (status === 'fallback') return true;
  const proofType = subject.proofType?.toLowerCase();
  if (proofType === 'sd-jwt-fallback') return true;
  const payload = subject.payload?.toLowerCase();
  return payload?.includes('sd-jwt-fallback') ?? false;
}
