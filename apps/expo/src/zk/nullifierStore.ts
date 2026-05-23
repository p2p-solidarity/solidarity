/**
 * NullifierStore — port of solidarity/Services/ZK/NullifierStore.swift.
 *
 * The actual storage lives inside the Nitro module (iOS Keychain /
 * Android EncryptedSharedPreferences) so the (scope, nullifier) set
 * survives reinstalls + can't be tampered with via unprivileged file
 * access. This file is a thin TS façade so callers don't need to import
 * the native bridge directly.
 *
 * Both methods are sync at the JS level — the native impl uses a
 * blocking secure-storage read (the data is small + on-device, so this
 * is the same trade-off the Swift class makes).
 *
 * Returns `false` (no replay detected) when the native module isn't
 * available — relying parties MUST treat that as "verification cannot
 * complete", which is what the calling code already does.
 */
import { loadSemaphoreNative } from './nativeBridge';

export async function hasNullifier(
  scope: string,
  nullifier: string
): Promise<boolean> {
  const native = await loadSemaphoreNative();
  if (!native) return false;
  try {
    return native.hasNullifier(scope, nullifier);
  } catch {
    return false;
  }
}

export async function recordNullifier(
  scope: string,
  nullifier: string
): Promise<void> {
  const native = await loadSemaphoreNative();
  if (!native) return;
  try {
    native.recordNullifier(scope, nullifier);
  } catch {
    // Persistence is best-effort; rejecting the calling promise would
    // make the verifier think the proof itself failed, which would be
    // worse than the (unlikely) replay risk.
  }
}
