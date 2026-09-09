/**
 * Automatic backup scheduler.
 *
 * Before this, "automatic" backup existed only as a People-tab pull gesture
 * (`gestureAutoBackup`) — so in practice a user who never pulled that list
 * had no backups but the ones they pressed the button for. This module makes
 * the schedule real and, together with the interval preference, visible.
 *
 * When it wakes up:
 *   - once when the app becomes active,
 *   - a debounce after portable data actually changes on disk,
 *   - and a slow poll, so an app left open across the interval still backs up.
 *
 * Every wake-up only ASKS: `requestBackup('auto')` owns the decision, so the
 * enabled switch, the user's chosen interval and the "nothing changed" check
 * cannot drift between triggers. Skips are the normal case and stay silent —
 * a toast on every quiet tick would be noise, not information.
 *
 * Foreground only: no timers, no network and no cloud auth while the app is
 * in the background, matching `startCloudSync`'s contract.
 */
import { applyingPortableData, isPortableStorageKey } from './portableStorage';
import { getMmkv } from '../storage/mmkv';
import { requestBackup } from './backupManager';

/** Long enough that a burst of edits (typing a name, adding tags) settles
 *  into one attempt rather than one per keystroke. */
const CHANGE_DEBOUNCE_MS = 5_000;
/** Slow safety net for a session that stays open across the interval. The
 *  interval gate makes each tick almost free — it returns before any I/O. */
const POLL_MS = 30 * 60_000;

/**
 * Start the scheduler. Returns a stop function; call it when the app leaves
 * the foreground. Failures are swallowed: an automatic backup that cannot run
 * (offline, iCloud signed out) must not surface an error over whatever the
 * user is actually doing — the Backup screen reports the real state.
 */
export function startAutoBackup(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => { void requestBackup('auto').catch(() => undefined); };
  const subscription = getMmkv().addOnValueChangedListener((key) => {
    // A restore/sync writing records is not a user edit; backing up because
    // we just applied a backup would spend a retained slot on a round trip.
    if (applyingPortableData || !isPortableStorageKey(key)) return;
    clearTimeout(timer);
    timer = setTimeout(run, CHANGE_DEBOUNCE_MS);
  });
  const interval = setInterval(run, POLL_MS);
  run();
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    subscription.remove();
  };
}
