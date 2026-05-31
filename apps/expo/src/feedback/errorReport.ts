/**
 * Error report — turns a caught error into a privacy-safe, emailable report.
 *
 * The app "absorbs" errors instead of letting a raw `CKError` / `Error.message`
 * leak through a native `Alert`. When something fails, we show a themed sheet
 * (see `appAlert.tsx`) whose primary action composes an email to
 * `err@solidarity.gg` carrying the technical trace — so a user can report a
 * production failure in one tap and we get the context to fix it.
 *
 * Privacy (Solidarity Rule — no PII logs): a report contains ONLY the error
 * message + code + stack + app/device metadata + the screen context label.
 * It never includes card / contact / credential payloads — callers pass a
 * short `context` string ("Backup › Back Up Now"), never user data.
 */
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/** Destination inbox for absorbed error reports. */
export const ERROR_REPORT_EMAIL = 'err@solidarity.gg';

/** mailto bodies must stay well under platform URL limits; trim the trace. */
const MAX_MAILTO_DETAIL = 1500;

export interface ErrorReportInput {
  /** Where in the app the failure happened, e.g. "Backup › Back Up Now". */
  readonly context: string;
  /** Human-readable one-line summary shown to the user. */
  readonly summary: string;
  /** The underlying error (Error | string | unknown). Optional. */
  readonly error?: unknown;
  /** Optional short code surfaced in the subject, e.g. "CKError 12/2006". */
  readonly code?: string;
}

export interface ResolvedErrorReport {
  readonly context: string;
  readonly summary: string;
  readonly code?: string;
  /** Raw error name + message + stack (may be long). */
  readonly detail: string;
  readonly appVersion: string;
  readonly buildVersion: string;
  readonly platform: string;
  readonly osVersion: string;
  /** ISO-8601 capture time. */
  readonly when: string;
}

/** Extract a stable, PII-free detail string from an unknown thrown value. */
export function describeError(error: unknown): string {
  if (error == null) return '';
  if (error instanceof Error) {
    const stack = error.stack ? `\n${error.stack}` : '';
    return `${error.name}: ${error.message}${stack}`;
  }
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean') return String(error);
  try {
    return JSON.stringify(error);
  } catch {
    // Circular / non-serialisable (e.g. BigInt) — keep it honest.
    return '[unserialisable error value]';
  }
}

function appVersion(): string {
  return (
    Constants.expoConfig?.version ??
    Application.nativeApplicationVersion ??
    'unknown'
  );
}

/** Snapshot the current environment into a self-contained report object. */
export function buildErrorReport(input: ErrorReportInput): ResolvedErrorReport {
  return {
    context: input.context,
    summary: input.summary,
    code: input.code,
    detail: describeError(input.error),
    appVersion: appVersion(),
    buildVersion: Application.nativeBuildVersion ?? 'unknown',
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    when: new Date().toISOString(),
  };
}

/** Full, untruncated plaintext report — used for the clipboard copy. */
export function formatReportText(r: ResolvedErrorReport): string {
  const lines = [
    '--- Solidarity error report ---',
    `When:     ${r.when}`,
    `App:      Solid(ar)ity ${r.appVersion} (build ${r.buildVersion})`,
    `Platform: ${r.platform} ${r.osVersion}`,
    `Where:    ${r.context}`,
    r.code ? `Code:     ${r.code}` : null,
    `Summary:  ${r.summary}`,
    '',
    'Technical detail:',
    r.detail || '(none)',
    '',
    '(Please describe what you were doing when this happened.)',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function reportSubject(r: ResolvedErrorReport): string {
  const tag = r.code ? `${r.context} — ${r.code}` : r.context;
  return `[Solidarity ${r.appVersion}] ${tag}`;
}

/** mailto body, with the trace truncated so the URL stays openable. */
function reportMailBody(r: ResolvedErrorReport): string {
  const full = formatReportText(r);
  if (full.length <= MAX_MAILTO_DETAIL) return full;
  return `${full.slice(0, MAX_MAILTO_DETAIL)}\n…(truncated — tap "Copy details" for the full trace)`;
}

/**
 * Open the system mail composer pre-filled to {@link ERROR_REPORT_EMAIL}.
 * Returns false when no mail handler is available (caller should offer copy).
 */
export async function sendErrorReport(r: ResolvedErrorReport): Promise<boolean> {
  const url =
    `mailto:${ERROR_REPORT_EMAIL}` +
    `?subject=${encodeURIComponent(reportSubject(r))}` +
    `&body=${encodeURIComponent(reportMailBody(r))}`;
  try {
    const can = await Linking.canOpenURL(url);
    if (!can) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** Copy the full report to the clipboard as a fallback / supplement. */
export async function copyErrorReport(r: ResolvedErrorReport): Promise<void> {
  await Clipboard.setStringAsync(formatReportText(r));
}
