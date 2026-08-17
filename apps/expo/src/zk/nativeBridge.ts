/**
 * nativeBridge — lazy loader for `@solidarity/nitro-semaphore`.
 *
 * Keeps the TS layer importable on platforms where the native module isn't
 * registered yet (Expo Go, web preview, bun test without the JSI bridge).
 *
 * Consumers should treat a `null` return value as "native unavailable" and
 * keep the UI interactive (the ID screens have empty-state visuals for
 * exactly this case). Errors thrown by the native methods themselves
 * propagate normally — we only swallow the *load* failure.
 */
import type { Semaphore } from '@solidarity/nitro-semaphore';

let cached: Semaphore | null = null;
let loadFailed = false;
let forceUnavailableForTesting = false;

export async function loadSemaphoreNative(): Promise<Semaphore | null> {
  if (forceUnavailableForTesting) return null;
  if (cached) return cached;
  if (loadFailed) return null;
  try {
    const mod = (await import('@solidarity/nitro-semaphore')) as {
      readonly getSemaphore?: () => Semaphore;
    };
    if (typeof mod.getSemaphore !== 'function') {
      loadFailed = true;
      return null;
    }
    cached = mod.getSemaphore();
    return cached;
  } catch {
    loadFailed = true;
    return null;
  }
}

/**
 * Test-only override. Lets parity tests inject a JS mock that mirrors the
 * spec without touching JSI. Pass `null` to reset.
 */
export function __setSemaphoreNativeForTesting(impl: Semaphore | null): void {
  cached = impl;
  loadFailed = false;
  forceUnavailableForTesting = false;
}

/** Test-only loader failure seam. */
export function __setSemaphoreNativeUnavailableForTesting(value: boolean): void {
  forceUnavailableForTesting = value;
  if (value) cached = null;
  loadFailed = false;
}
