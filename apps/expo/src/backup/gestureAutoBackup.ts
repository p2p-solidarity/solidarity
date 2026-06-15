/**
 * Gesture-triggered auto backup — per user direction (2026-05-24):
 * "資料雲端自動儲存 react-native-gesture-handler"
 *
 * Wires a Pan gesture to the coordinated `requestBackup('gesture')` entrypoint.
 * The gesture is created via react-native-gesture-handler's `Gesture.Pan()` so
 * it composes with any scrollable container's native pull-to-refresh without
 * fighting the JS scroll thread.
 *
 * Default UX:
 *   - Pull down ≥ 80 px on the People / Me tab header
 *   - Backup runs in background; toast renders on completion
 *
 * Enablement, provider selection, and the 30s cooldown are ALL owned by
 * `requestBackup` now (single source of truth), so this module no longer keeps
 * its own cooldown or provider — the gesture path can't disagree with the
 * pull-to-refresh path anymore.
 *
 * Why we don't reuse RefreshControl: pull-to-refresh is per-list state, and we
 * want the same gesture across the whole app shell (not bound to a specific
 * FlashList instance).
 */
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';

import { requestBackup, type BackupPayload } from './backupManager';

const PULL_THRESHOLD_PX = 80;

interface BackupHandlers {
  readonly onStart?: () => void;
  readonly onComplete?: (payload: BackupPayload) => void;
  readonly onError?: (err: unknown) => void;
}

async function fireBackup(handlers: BackupHandlers): Promise<void> {
  try {
    const outcome = await requestBackup('gesture');
    if (outcome.ran && outcome.payload) handlers.onComplete?.(outcome.payload);
    // Skipped (disabled / pull-off / cooldown) → silent, no toast.
  } catch (err) {
    handlers.onError?.(err);
  }
}

/**
 * Create a gesture that fires a coordinated backup on a downward pull exceeding
 * PULL_THRESHOLD_PX. Compose with a scroll view via
 * `Gesture.Simultaneous(panGesture, nativeScroll)`.
 */
export function makeGestureAutoBackup(handlers: BackupHandlers = {}) {
  return Gesture.Pan().onEnd((event) => {
    'worklet';
    if (event.translationY > PULL_THRESHOLD_PX) {
      runOnJS(fireBackup)(handlers);
    }
  });
}
