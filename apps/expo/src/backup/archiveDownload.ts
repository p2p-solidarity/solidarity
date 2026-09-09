/**
 * Archive download poller — the pure seam between "iCloud says this file is
 * still on the way" and the Backup screen's progress row.
 *
 * Native `readFileBackup` deliberately fails fast on a file that is not fully
 * local (`icloud_download_pending`): a sync pass must never block a native
 * executor on an offline download. Everything that turns that refusal into a
 * user-visible download lives here, with the platform behind injectable ports
 * so the wait, the progress reporting and every terminal outcome are unit-
 * testable without a device (`__tests__/unit/archiveDownload.test.ts`).
 *
 * Deliberately LOCK-FREE: `withCloudDataLock` bounds every entry at two
 * minutes, and a multi-megabyte archive on a slow link can take longer than
 * that. Callers download first, then take the lock for the restore itself.
 */
import type {
  FileBackupDownloadState,
  FileBackupDownloadStatus,
} from '@solidarity/nitro-keystone';

export type ArchiveDownloadState = FileBackupDownloadState;
export type ArchiveDownloadStatus = FileBackupDownloadStatus;

export type ArchiveDownloadFailure = 'missing' | 'failed' | 'timeout' | 'aborted';

/** A download that ended without the archive becoming readable. */
export class ArchiveDownloadError extends Error {
  constructor(
    readonly kind: ArchiveDownloadFailure,
    readonly archiveName: string,
    message?: string,
  ) {
    super(message ?? `archive-download-${kind}`);
    this.name = 'ArchiveDownloadError';
  }
}

/**
 * The native fail-fast refusal, re-thrown with the archive it concerns so a
 * caller can start the download instead of reporting the archive unreadable.
 */
export class ArchiveDownloadPendingError extends Error {
  constructor(
    readonly archiveName: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`icloud_download_pending: ${archiveName}`, options);
    this.name = 'ArchiveDownloadPendingError';
  }
}

/** Matches the native `icloud_download_pending` code and its message. */
const PENDING_PATTERN = /icloud_download_pending|still downloading/iu;

/** Whether an error is the platform saying "not on this device yet". */
export function isDownloadPendingError(error: unknown): boolean {
  if (error instanceof ArchiveDownloadPendingError) return true;
  if (error === null || typeof error !== 'object') return false;
  const message = (error as { readonly message?: unknown }).message;
  return typeof message === 'string' && PENDING_PATTERN.test(message);
}

export interface ArchiveDownloadProgress {
  readonly status: 'downloading' | 'notDownloaded';
  /** Whole percent 0–100, or null when the platform has not reported one. */
  readonly percent: number | null;
}

export interface AwaitArchiveDownloadPorts {
  readonly name: string;
  readonly getState: (name: string) => Promise<ArchiveDownloadState>;
  readonly start: (name: string) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly onProgress?: (progress: ArchiveDownloadProgress) => void;
  readonly signal?: AbortSignal;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/** Every poll on iOS is a Spotlight round trip on the main run loop, so this
 *  is deliberately not faster; progress still moves every couple of seconds. */
const DEFAULT_POLL_MS = 2_000;
/** Generous: an 8 MB avatar-bearing archive on a poor link. The UI keeps
 *  showing progress the whole time, and leaving the screen aborts. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
/**
 * Consecutive STALLED polls a platform error must survive before it counts.
 * Spotlight reports the item's LAST transfer error (last week's "offline")
 * on every row, including while a new transfer is moving, and failing on that
 * stale value would abort a healthy download — so an error is only counted
 * while nothing is happening: not `downloading`, and the percentage has not
 * advanced since the previous poll.
 */
const PERSISTENT_ERROR_POLLS = 2;

function isReady(state: ArchiveDownloadState): boolean {
  return state.status === 'current' || state.status === 'local';
}

/** Whole percent 0–100 from whatever the platform reported, or null. */
export function normalizePercent(raw: number | undefined): number | null {
  if (raw === undefined || !Number.isFinite(raw)) return null;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

type ResolvedPorts = AwaitArchiveDownloadPorts & {
  readonly now: () => number;
  readonly pollMs: number;
  readonly timeoutMs: number;
};

function progressOf(state: ArchiveDownloadState): ArchiveDownloadProgress {
  return {
    status: state.status === 'downloading' ? 'downloading' : 'notDownloaded',
    percent: normalizePercent(state.percentDownloaded),
  };
}

/**
 * Resolve once `ports.name` is readable on this device. Starts the transfer
 * exactly once when it is not, reports every poll through `onProgress`, and
 * rejects with a typed `ArchiveDownloadError` for missing / failed / aborted /
 * timeout — never hangs, never resolves early.
 */
export async function awaitArchiveDownload(rawPorts: AwaitArchiveDownloadPorts): Promise<void> {
  const ports: ResolvedPorts = {
    ...rawPorts,
    now: rawPorts.now ?? Date.now,
    pollMs: rawPorts.pollMs ?? DEFAULT_POLL_MS,
    timeoutMs: rawPorts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const initial = await ports.getState(ports.name);
  if (isReady(initial)) return;
  if (initial.status === 'missing') throw new ArchiveDownloadError('missing', ports.name);
  await ports.start(ports.name);
  // Say "downloading" right away: the platform may not report a transfer for
  // a beat after the request, and a row that still reads "in iCloud" after a
  // tap looks like an unresponsive button.
  ports.onProgress?.({ status: 'downloading', percent: null });
  await pollUntilReady(ports);
}

/**
 * Decides when a platform error is real: only while the transfer is
 * demonstrably stalled (not `downloading`, percentage not advancing), and only
 * once that has held for `PERSISTENT_ERROR_POLLS` polls in a row.
 */
function stallDetector(): (state: ArchiveDownloadState, progress: ArchiveDownloadProgress) => boolean {
  let stalledErrors = 0;
  let lastPercent: number | null = null;
  return (state, progress) => {
    const advancing =
      progress.percent !== null && lastPercent !== null && progress.percent > lastPercent;
    if (progress.percent !== null) lastPercent = progress.percent;
    const stalled = state.status !== 'downloading' && !advancing;
    stalledErrors = state.errorMessage && stalled ? stalledErrors + 1 : 0;
    return stalledErrors >= PERSISTENT_ERROR_POLLS;
  };
}

async function pollUntilReady(ports: ResolvedPorts): Promise<void> {
  const failure = (kind: ArchiveDownloadFailure, message?: string): ArchiveDownloadError =>
    new ArchiveDownloadError(kind, ports.name, message);
  const startedAt = ports.now();
  const stalledFailure = stallDetector();
  for (;;) {
    if (ports.signal?.aborted) throw failure('aborted');
    if (ports.now() - startedAt > ports.timeoutMs) throw failure('timeout');
    await ports.sleep(ports.pollMs);
    if (ports.signal?.aborted) throw failure('aborted');
    const state = await ports.getState(ports.name);
    // Re-checked AFTER the await: an abort that lands while the final poll is
    // in flight must win over "ready", or the caller carries on into a
    // destructive restore prompt on a screen the user has already left.
    if (ports.signal?.aborted) throw failure('aborted');
    if (isReady(state)) return;
    if (state.status === 'missing') throw failure('missing');
    const progress = progressOf(state);
    if (stalledFailure(state, progress)) throw failure('failed', state.errorMessage);
    ports.onProgress?.(progress);
  }
}
