/**
 * CardError — mirrors solidarity/Models/CardError.swift (19 variants).
 *
 * Swift uses an enum with associated string payloads; we model it as a
 * discriminated union so callers can `switch` on `type` exhaustively.
 *
 * `withContext` mirrors Swift's `.withContext(...)`, attaching audit data
 * without losing the original variant. `severity` /
 * `requiresUserIntervention` / `isRecoverable` mirror the Swift
 * computed properties so call sites read identically across languages.
 */
import { z } from 'zod';

export const errorSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type ErrorSeverity = z.infer<typeof errorSeveritySchema>;

export const deviceInfoSchema = z.object({
  model: z.string(),
  systemVersion: z.string(),
  appVersion: z.string(),
  buildNumber: z.string(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const errorContextSchema = z.object({
  timestamp: z.coerce.date(),
  operation: z.string(),
  userId: z.string().optional(),
  deviceInfo: deviceInfoSchema,
  additionalInfo: z.record(z.string(), z.string()).default({}),
});
export type ErrorContext = z.infer<typeof errorContextSchema>;

export const CARD_ERROR_TYPES = [
  'invalidData',
  'storageError',
  'encryptionError',
  'networkError',
  'passGenerationError',
  'ocrError',
  'sharingError',
  'validationError',
  'notFound',
  'unauthorized',
  'rateLimited',
  'cryptographicError',
  'domainVerificationError',
  'proofGenerationError',
  'proofVerificationError',
  'keyManagementError',
  'offlineError',
  'syncError',
  'configurationError',
] as const;
export type CardErrorType = (typeof CARD_ERROR_TYPES)[number];

export const cardErrorSchema = z.object({
  type: z.enum(CARD_ERROR_TYPES),
  message: z.string(),
  context: errorContextSchema.optional(),
});
export type CardError = z.infer<typeof cardErrorSchema>;

const SEVERITY_BY_TYPE: Readonly<Record<CardErrorType, ErrorSeverity>> = {
  invalidData: 'low',
  storageError: 'high',
  encryptionError: 'critical',
  networkError: 'medium',
  passGenerationError: 'medium',
  ocrError: 'low',
  sharingError: 'medium',
  validationError: 'low',
  notFound: 'low',
  unauthorized: 'high',
  rateLimited: 'medium',
  cryptographicError: 'critical',
  domainVerificationError: 'high',
  proofGenerationError: 'high',
  proofVerificationError: 'high',
  keyManagementError: 'critical',
  offlineError: 'low',
  syncError: 'medium',
  configurationError: 'high',
};

export function severity(err: CardError): ErrorSeverity {
  return SEVERITY_BY_TYPE[err.type];
}

const RECOVERABLE: ReadonlySet<CardErrorType> = new Set<CardErrorType>([
  'networkError',
  'rateLimited',
  'offlineError',
  'syncError',
]);
export function isRecoverable(err: CardError): boolean {
  return RECOVERABLE.has(err.type);
}

const NEEDS_USER: ReadonlySet<CardErrorType> = new Set<CardErrorType>([
  'unauthorized',
  'keyManagementError',
  'configurationError',
  'cryptographicError',
]);
export function requiresUserIntervention(err: CardError): boolean {
  return NEEDS_USER.has(err.type);
}

export function withContext(err: CardError, context: ErrorContext): CardError {
  return { ...err, context };
}
