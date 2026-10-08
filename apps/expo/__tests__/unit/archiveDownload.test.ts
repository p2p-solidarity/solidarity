/**
 * Archive download poller — the pure seam between "iCloud says the file is
 * still on the way" and the Backup screen's progress row.
 *
 * Pins:
 *   1. An archive that is already local resolves without starting anything.
 *   2. Otherwise the download is started ONCE, progress is reported per poll,
 *      and the wait ends when the platform reports `current`.
 *   3. Terminal outcomes are typed: missing / failed / aborted / timeout.
 *   4. A transfer error only counts once it PERSISTS across two polls after
 *      the download was (re)started — Spotlight keeps the last error of an
 *      earlier offline attempt on the item, and failing instantly on that
 *      stale value would make every tap fail on a device that is now online.
 *   5. `isDownloadPendingError` recognises the native fail-fast rejection by
 *      code or message, and the TS wrapper class, and nothing else.
 *
 * Run: cd apps/expo && bun test __tests__/unit/archiveDownload.test.ts
 */
import { describe, expect, it } from 'bun:test';

import {
  ArchiveDownloadError,
  ArchiveDownloadPendingError,
  awaitArchiveDownload,
  isDownloadPendingError,
  type ArchiveDownloadProgress,
  type ArchiveDownloadState,
} from '../../src/backup/archiveDownload';

const NAME = 'backup_1700000000000.solbk';

function harness(states: readonly ArchiveDownloadState[], options: { readonly stepMs?: number } = {}) {
  let index = 0;
  let clock = 0;
  const started: string[] = [];
  const sleeps: number[] = [];
  const progress: ArchiveDownloadProgress[] = [];
  const controller = new AbortController();
  const ports = {
    name: NAME,
    getState: (name: string): Promise<ArchiveDownloadState> => {
      expect(name).toBe(NAME);
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      if (!state) throw new Error('harness: no states');
      return Promise.resolve(state);
    },
    start: (name: string): Promise<void> => { started.push(name); return Promise.resolve(); },
    sleep: (ms: number): Promise<void> => { sleeps.push(ms); clock += options.stepMs ?? ms; return Promise.resolve(); },
    onProgress: (p: ArchiveDownloadProgress): void => { progress.push(p); },
    signal: controller.signal,
    pollMs: 250,
    timeoutMs: 60_000,
    now: () => clock,
  };
  return { ports, started, sleeps, progress, controller };
}

describe('awaitArchiveDownload', () => {
  it('resolves at once when the archive is already local (current or local-only storage)', async () => {
    for (const status of ['current', 'local'] as const) {
      const h = harness([{ status }]);
      await awaitArchiveDownload(h.ports);
      expect(h.started).toEqual([]);
      expect(h.progress).toEqual([]);
      expect(h.sleeps).toEqual([]);
    }
  });

  it('starts the download once, reports each poll, and resolves on current', async () => {
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'downloading', percentDownloaded: 20 },
      { status: 'downloading', percentDownloaded: 80 },
      { status: 'current', percentDownloaded: 100 },
    ]);
    await awaitArchiveDownload(h.ports);
    expect(h.started).toEqual([NAME]);
    expect(h.progress).toEqual([
      { status: 'downloading', percent: null },
      { status: 'downloading', percent: 20 },
      { status: 'downloading', percent: 80 },
    ]);
    expect(h.sleeps).toEqual([250, 250, 250]);
  });

  it('reports a queued transfer honestly — notDownloaded after start is still "on the way", not a failure', async () => {
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'notDownloaded' },
      { status: 'current' },
    ]);
    await awaitArchiveDownload(h.ports);
    expect(h.progress.map((p) => p.status)).toEqual(['downloading', 'notDownloaded']);
  });

  it('clamps and rounds the platform percentage, and reports null when it is unusable', async () => {
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'downloading', percentDownloaded: 101.6 },
      { status: 'downloading', percentDownloaded: -3 },
      { status: 'downloading', percentDownloaded: 33.4 },
      { status: 'downloading', percentDownloaded: Number.NaN },
      { status: 'current' },
    ]);
    await awaitArchiveDownload(h.ports);
    expect(h.progress.slice(1).map((p) => p.percent)).toEqual([100, 0, 33, null]);
  });

  it('a missing archive fails with kind "missing" before anything is started', async () => {
    const h = harness([{ status: 'missing' }]);
    const failure = await awaitArchiveDownload(h.ports).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ArchiveDownloadError);
    expect((failure as ArchiveDownloadError).kind).toBe('missing');
    expect((failure as ArchiveDownloadError).archiveName).toBe(NAME);
    expect(h.started).toEqual([]);
  });

  it('a transfer error that persists across two polls fails with the platform message', async () => {
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'notDownloaded', errorMessage: 'The Internet connection appears to be offline.' },
      { status: 'notDownloaded', errorMessage: 'The Internet connection appears to be offline.' },
      { status: 'current' },
    ]);
    const failure = await awaitArchiveDownload(h.ports).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ArchiveDownloadError);
    expect((failure as ArchiveDownloadError).kind).toBe('failed');
    expect((failure as ArchiveDownloadError).message).toContain('offline');
  });

  it('a stale error that clears after the restart is not a failure', async () => {
    // The item still carries last week's offline error when the user taps;
    // startDownloadingUbiquitousItem clears it on the next poll.
    const h = harness([
      { status: 'notDownloaded', errorMessage: 'stale offline error' },
      { status: 'notDownloaded', errorMessage: 'stale offline error' },
      { status: 'downloading', percentDownloaded: 50 },
      { status: 'current' },
    ]);
    await awaitArchiveDownload(h.ports);
    expect(h.started).toEqual([NAME]);
  });

  it('a stale error reported alongside a MOVING transfer is ignored', async () => {
    // Spotlight attaches the item's last error to every row, including while
    // a new transfer is progressing. That must never abort a healthy download.
    const stale = 'The Internet connection appears to be offline.';
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'downloading', percentDownloaded: 20, errorMessage: stale },
      { status: 'downloading', percentDownloaded: 40, errorMessage: stale },
      { status: 'downloading', percentDownloaded: 60, errorMessage: stale },
      { status: 'downloading', percentDownloaded: 60, errorMessage: stale },
      { status: 'current' },
    ]);
    await awaitArchiveDownload(h.ports);
    expect(h.progress.map((p) => p.percent)).toEqual([null, 20, 40, 60, 60]);
  });

  it('an error only counts once the transfer is demonstrably stalled', async () => {
    // Not downloading, and the percentage stopped moving: two such polls in a
    // row with the platform error present is a real failure.
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'notDownloaded', percentDownloaded: 30, errorMessage: 'offline' },
      { status: 'notDownloaded', percentDownloaded: 30, errorMessage: 'offline' },
      { status: 'current' },
    ]);
    const failure = await awaitArchiveDownload(h.ports).catch((e: unknown) => e);
    expect((failure as ArchiveDownloadError).kind).toBe('failed');
  });

  it('an abort that lands while the final poll is in flight wins over "ready"', async () => {
    // The screen unmounts while getState is awaiting; the reply says current.
    // Resolving here would let the caller open a destructive restore prompt on
    // a screen the user already left.
    const h = harness([{ status: 'notDownloaded' }, { status: 'current' }]);
    const getState = h.ports.getState;
    h.ports.getState = async (name: string) => {
      const state = await getState(name);
      if (state.status === 'current') h.controller.abort();
      return state;
    };
    const failure = await awaitArchiveDownload(h.ports).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ArchiveDownloadError);
    expect((failure as ArchiveDownloadError).kind).toBe('aborted');
  });

  it('abort stops polling with kind "aborted"', async () => {
    const h = harness([
      { status: 'notDownloaded' },
      { status: 'downloading', percentDownloaded: 10 },
      { status: 'downloading', percentDownloaded: 20 },
    ]);
    h.ports.onProgress = (p) => { if (p.percent === 10) h.controller.abort(); };
    const failure = await awaitArchiveDownload(h.ports).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ArchiveDownloadError);
    expect((failure as ArchiveDownloadError).kind).toBe('aborted');
    // No poll after the abort was observed.
    expect(h.sleeps.length).toBeLessThanOrEqual(2);
  });

  it('gives up with kind "timeout" once the deadline passes', async () => {
    const h = harness([{ status: 'notDownloaded' }, { status: 'downloading', percentDownloaded: 1 }], {
      stepMs: 30_000,
    });
    const failure = await awaitArchiveDownload(h.ports).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ArchiveDownloadError);
    expect((failure as ArchiveDownloadError).kind).toBe('timeout');
  });
});

describe('isDownloadPendingError', () => {
  it('recognises the native fail-fast rejection by code and by message', () => {
    expect(isDownloadPendingError(new Error('iCloud file is still downloading'))).toBe(true);
    expect(isDownloadPendingError(new Error('icloud_download_pending'))).toBe(true);
    expect(isDownloadPendingError({ message: 'Error: iCloud file is still downloading' })).toBe(true);
  });

  it('recognises the TS wrapper', () => {
    expect(isDownloadPendingError(new ArchiveDownloadPendingError(NAME))).toBe(true);
    expect(new ArchiveDownloadPendingError(NAME).archiveName).toBe(NAME);
  });

  it('rejects everything else', () => {
    expect(isDownloadPendingError(new Error('No backup file named x'))).toBe(false);
    expect(isDownloadPendingError(new ArchiveDownloadError('failed', NAME, 'offline'))).toBe(false);
    expect(isDownloadPendingError('icloud_download_pending')).toBe(false);
    expect(isDownloadPendingError(null)).toBe(false);
  });
});
