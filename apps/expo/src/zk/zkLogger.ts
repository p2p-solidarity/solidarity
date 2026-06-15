/**
 * ZK logger — TS port of solidarity/Services/ZK/ZKLogger.swift.
 *
 * Mirrors the Swift `ZKLog` static API (`info`, `error`, `status`). On
 * device the Swift version is backed by `os.Logger` with `.private`
 * redaction. We don't have that primitive on RN, so the equivalent is:
 *   - DEV  : `console.log` mirror with the same `[Semaphore]` prefix.
 *   - PROD : drop `info` (caller content may contain commitment prefixes
 *            / scopes) and route warn+error to `eventRepository.record`
 *            so they show up in the audit log without leaking via stdout.
 *
 * `status` is operational text with no identifier content, so it's safe
 * to keep visible in release builds.
 */
import { record as recordEvent } from '@/feedback/eventRepository';

export type ZkLogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[Semaphore]';

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
}

export const zkLogger = {
  /** Verbose tracing. DEV only. */
  debug(message: string, data?: unknown): void {
    if (isDev()) {
      console.warn(`${PREFIX}[Debug] ${message}`, data ?? '');
    }
  },

  /**
   * Caller-supplied messages may contain commitment prefixes / scopes /
   * identifiers — kept out of release stdout. Routed to eventRepository
   * at debug level only (i.e. dropped) to match Swift `.private` redaction.
   */
  info(message: string, data?: unknown): void {
    if (isDev()) {
      console.warn(`${PREFIX} ${message}`, data ?? '');
    }
  },

  /** Warnings — release builds append to the audit log. */
  warn(message: string, data?: unknown): void {
    if (isDev()) {
      console.warn(`${PREFIX}[Warn] ${message}`, data ?? '');
    } else {
      recordEvent('zk', { level: 'warn', message, data });
    }
  },

  /** Errors — release builds append to the audit log. */
  error(message: string, data?: unknown): void {
    if (isDev()) {
      console.error(`${PREFIX}[Error] ${message}`, data ?? '');
    } else {
      recordEvent('zk', { level: 'error', message, data });
    }
  },

  /**
   * Operational status messages with no identifier content. Safe to leave
   * visible across build flavours (mirrors Swift `status(_:)`).
   */
  status(message: string): void {
    console.warn(`${PREFIX} ${message}`);
  },

  /** Unified entry point used by the spec contract: `log(level, message, data?)`. */
  log(level: ZkLogLevel, message: string, data?: unknown): void {
    switch (level) {
      case 'debug':
        zkLogger.debug(message, data);
        return;
      case 'info':
        zkLogger.info(message, data);
        return;
      case 'warn':
        zkLogger.warn(message, data);
        return;
      case 'error':
        zkLogger.error(message, data);
        return;
    }
  },
};

export function log(level: ZkLogLevel, message: string, data?: unknown): void {
  zkLogger.log(level, message, data);
}
