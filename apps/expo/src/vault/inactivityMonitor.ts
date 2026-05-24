/**
 * Inactivity monitor — mirrors solidarity/Services/Vault/
 * InactivityMonitorService.swift, adapted for React Native's AppState.
 *
 * Two responsibilities, mirroring Swift:
 *   1. Record user activity (foreground transition or explicit interaction).
 *      The last-activity timestamp persists in MMKV — Swift uses
 *      UserDefaults with the same `lastActivity` key.
 *   2. Auto-lock the in-memory root secret after a configurable idle
 *      window. Swift relies on Keychain re-prompting; on RN we evict the
 *      cached root secret so the next sensitive op re-prompts biometrics.
 *
 * The auto-lock interval has no exact Swift counterpart (the Swift monitor
 * is about day-scale inactivity for inheritance, not minute-scale
 * auto-lock). We pick 5 minutes as the default — same as the Apple
 * "Require Password" default for Notes / 1Password. Configurable via
 * `configureMonitor({ idleMs })`.
 *
 * Periodic check runs every `minimumCheckInterval` (Swift: 3600s) and
 * computes `daysSinceLastActivity` so callers can plug it into the
 * TimeLockConfig evaluator.
 */
import { AppState, type NativeEventSubscription } from 'react-native';

import { getMmkv } from '@/storage/mmkv';

import { evictCachedRootSecret } from './secretsKeychain';

const LAST_ACTIVITY_KEY = 'vault.inactivity.lastActivity';
/** Swift InactivityMonitorService.minimumCheckInterval = 3600s = 1h. */
export const PERIODIC_CHECK_INTERVAL_MS = 3600 * 1000;
/** Auto-lock after 5min idle — matches the "Require Password" iOS default. */
export const DEFAULT_IDLE_LOCK_MS = 5 * 60 * 1000;

interface MonitorState {
  appStateSubscription: NativeEventSubscription | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  periodicTimer: ReturnType<typeof setInterval> | null;
  idleMs: number;
  /** Pluggable for tests — defaults to real Date.now. */
  now: () => number;
  /** Pluggable for tests — defaults to evictCachedRootSecret. */
  onLock: () => void;
}

const state: MonitorState = {
  appStateSubscription: null,
  idleTimer: null,
  periodicTimer: null,
  idleMs: DEFAULT_IDLE_LOCK_MS,
  now: () => Date.now(),
  onLock: () => {
    evictCachedRootSecret();
  },
};

export interface MonitorConfig {
  readonly idleMs?: number;
  readonly now?: () => number;
  readonly onLock?: () => void;
}

/** Read the last-recorded activity timestamp (ms) — `null` on first run. */
export function readLastActivity(): number | null {
  const raw = getMmkv().getString(LAST_ACTIVITY_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Write the current timestamp + reset the idle countdown. */
export function recordActivity(): void {
  const now = state.now();
  getMmkv().set(LAST_ACTIVITY_KEY, String(now));
  resetIdleTimer();
}

/** Number of *whole* days between the last activity and now. */
export function daysSinceLastActivity(now: number = state.now()): number {
  const last = readLastActivity();
  if (last === null) return 0;
  const deltaMs = Math.max(0, now - last);
  return Math.floor(deltaMs / (24 * 60 * 60 * 1000));
}

/** Lock immediately: evict cached secret, fire the configured callback. */
export function lockVault(): void {
  state.onLock();
}

function resetIdleTimer(): void {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  state.idleTimer = setTimeout(() => {
    lockVault();
  }, state.idleMs);
}

function handleAppStateChange(next: string): void {
  if (next === 'active') {
    recordActivity();
  } else {
    // Background / inactive → lock immediately (no idle wait).
    lockVault();
  }
}

/** Begin observing AppState + start the periodic check + idle countdown. */
export function startMonitor(config?: MonitorConfig): void {
  stopMonitor();
  if (config?.idleMs !== undefined) state.idleMs = config.idleMs;
  if (config?.now) state.now = config.now;
  if (config?.onLock) state.onLock = config.onLock;

  state.appStateSubscription = AppState.addEventListener(
    'change',
    handleAppStateChange
  );
  state.periodicTimer = setInterval(() => {
    // Just refresh the cached daysSinceLastActivity-style reading. The
    // actual unlock evaluation lives in `timeLock.evaluateTimeLock` and is
    // pulled by the UI / sync layer when needed.
  }, PERIODIC_CHECK_INTERVAL_MS);
  resetIdleTimer();
  // Treat the start as an explicit "active" moment so callers don't see a
  // null lastActivity on a clean install.
  if (readLastActivity() === null) {
    recordActivity();
  }
}

/** Tear down all observers + timers. Idempotent. */
export function stopMonitor(): void {
  state.appStateSubscription?.remove();
  state.appStateSubscription = null;
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.periodicTimer) {
    clearInterval(state.periodicTimer);
    state.periodicTimer = null;
  }
}

/** Test-only — exposes the internal `onLock` for assertions. */
export function _testFireIdle(): void {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  lockVault();
}

/** Test-only — direct dispatch of an AppState change without RN. */
export function _testHandleAppStateChange(next: string): void {
  handleAppStateChange(next);
}
