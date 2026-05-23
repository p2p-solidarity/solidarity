/**
 * Gesture-triggered auto backup — per user direction (2026-05-24):
 * "資料雲端自動儲存 react-native-gesture-handler"
 *
 * Wires a Pan gesture (configurable threshold) to `performBackupNow`. The
 * gesture is created via react-native-gesture-handler's `Gesture.Pan()` so
 * it can be composed with any scrollable container's native pull-to-refresh
 * without fighting the JS scroll thread.
 *
 * Default UX:
 *   - Pull down ≥ 80 px on the People / Me tab header
 *   - Backup runs in background; toast renders on completion
 *   - Cooldown 30 s prevents thrashing if user keeps pulling
 *
 * Why we don't reuse RefreshControl: pull-to-refresh is per-list state,
 * and we want the same gesture across the whole app shell (not bound to
 * a specific FlashList instance).
 */
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-worklets';

import { performBackupNow, type BackupPayload } from './backupManager';
import { DEFAULT_PROVIDER, type ProviderKind } from './cloudProvider';

const PULL_THRESHOLD_PX = 80;
const COOLDOWN_MS = 30_000;

interface BackupHandlers {
  readonly onStart?: () => void;
  readonly onComplete?: (payload: BackupPayload) => void;
  readonly onError?: (err: unknown) => void;
}

let lastBackupAt = 0;

async function fireBackup(
  provider: ProviderKind,
  handlers: BackupHandlers
): Promise<void> {
  const now = Date.now();
  if (now - lastBackupAt < COOLDOWN_MS) return;
  lastBackupAt = now;
  try {
    handlers.onStart?.();
    const result = await performBackupNow(provider);
    handlers.onComplete?.(result);
  } catch (err) {
    handlers.onError?.(err);
  }
}

/**
 * Create a gesture that fires `performBackupNow` on a downward pull
 * exceeding PULL_THRESHOLD_PX. Compose with a scroll view via
 * `Gesture.Simultaneous(panGesture, nativeScroll)`.
 */
export function makeGestureAutoBackup(
  provider: ProviderKind = DEFAULT_PROVIDER,
  handlers: BackupHandlers = {}
) {
  return Gesture.Pan().onEnd((event) => {
    'worklet';
    if (event.translationY > PULL_THRESHOLD_PX) {
      runOnJS(fireBackup)(provider, handlers);
    }
  });
}
