# iCloud-A1: Backup Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make expo backups predictable — one coordinated entrypoint that honours the user's prefs + a cooldown, a provider toggle that actually switches target, chronological "newest backup" selection, and legible restore/auth failures.

**Architecture:** Extract the testable decisions (timestamp parsing, newest-selection, run/skip policy) into a pure `src/backup/backupPolicy.ts`. Funnel every backup trigger through one `requestBackup(reason)` coordinator in `backupManager.ts` that reads `usePreferences`, calls `setProvider`, and applies a shared cooldown. Wire `cloudProvider` to the new selection helpers. Surface restore key-mismatch and Android Drive-auth as typed, actionable states.

**Tech Stack:** TypeScript, zustand (`usePreferences`), `@solidarity/nitro-cloudkit`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-02-figma-parity-and-icloud-stability-design.md` (Track A1).

---

## File structure

- **Create** `src/backup/backupPolicy.ts` — pure helpers: `parseBackupTimestampMs`, `sortBackupsByTimestamp`, `selectNewestBackup`, `newBackupName`, `shouldRunBackup`. No I/O, fully unit-testable.
- **Create** `__tests__/unit/backupPolicy.test.ts` — covers timestamp/selection/policy.
- **Modify** `src/backup/cloudProvider.ts` — use the new selection + fixed-width name; replace lexicographic `.sort()`.
- **Modify** `src/backup/backupManager.ts` — add `requestBackup(reason)` coordinator + `BackupRestoreError`.
- **Modify** `src/backup/index.ts` — export `requestBackup`, `BackupReason`, `BackupRestoreError`.
- **Modify** `src/people/usePeopleScreen.ts` — `refresh` → `requestBackup('pull')`.
- **Modify** `src/backup/gestureAutoBackup.ts` — gesture → `requestBackup('gesture')` (drop its own cooldown).
- **Modify** `app/settings/backup.tsx` — `onBackupNow` → `requestBackup('manual')`; map `BackupRestoreError` to a key-mismatch message.
- **Modify** `src/storage/encryptionManager.ts` — `decryptJson` throws a typed `DecryptError`.
- **Modify** `src/i18n/locales/en.json` + `zh-Hant.json` — `backup.restore.keyMismatch`, `backup.drive.needsConnection`.
- **Modify** `src/backup/cloudProvider.ts` (Task 6) — `ensureDriveAuth` returns a typed status.

---

### Task 1: Pure backup-policy helpers (timestamp + selection)

**Files:**
- Create: `src/backup/backupPolicy.ts`
- Test: `__tests__/unit/backupPolicy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/unit/backupPolicy.test.ts
import { describe, expect, it } from 'bun:test';
import {
  parseBackupTimestampMs,
  sortBackupsByTimestamp,
  selectNewestBackup,
  newBackupName,
} from '../../src/backup/backupPolicy';

describe('parseBackupTimestampMs', () => {
  it('parses expo integer-seconds names to ms', () => {
    expect(parseBackupTimestampMs('backup_1700000000.solbk')).toBe(1_700_000_000_000);
  });
  it('parses expo fixed-width ms names', () => {
    expect(parseBackupTimestampMs('backup_1700000000123.solbk')).toBe(1_700_000_000_123);
  });
  it('parses Swift decimal-seconds names', () => {
    expect(parseBackupTimestampMs('backup_1700000000.5.solbk')).toBe(1_700_000_000_500);
  });
  it('rejects non-backup names', () => {
    expect(parseBackupTimestampMs('notes.txt')).toBeNull();
    expect(parseBackupTimestampMs('backup_.solbk')).toBeNull();
  });
});

describe('selectNewestBackup', () => {
  it('is chronological across digit-count + format boundaries (the old bug)', () => {
    // Lexicographic .sort() would put the 9-digit AFTER the 10-digit and the
    // decimal BEFORE the integer — all wrong. selectNewest must pick the real max.
    const names = [
      'backup_999999999.solbk',        // 9 digits  → 999,999,999s
      'backup_1700000000.solbk',       // 10 digits → 1,700,000,000s
      'backup_1700000000.123456.solbk',// Swift decimal, same second-ish
      'backup_1700000005000.solbk',    // ms form, newest
    ];
    expect(selectNewestBackup(names)).toBe('backup_1700000005000.solbk');
  });
  it('returns null for empty input', () => {
    expect(selectNewestBackup([])).toBeNull();
  });
});

describe('sortBackupsByTimestamp', () => {
  it('orders oldest→newest', () => {
    expect(
      sortBackupsByTimestamp(['backup_1700000005000.solbk', 'backup_999999999.solbk']),
    ).toEqual(['backup_999999999.solbk', 'backup_1700000005000.solbk']);
  });
});

describe('newBackupName', () => {
  it('emits a fixed-width ms name that round-trips through the parser', () => {
    const name = newBackupName(1_700_000_000_123);
    expect(name).toBe('backup_1700000000123.solbk');
    expect(parseBackupTimestampMs(name)).toBe(1_700_000_000_123);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/expo && bun test __tests__/unit/backupPolicy.test.ts`
Expected: FAIL — `Cannot find module '../../src/backup/backupPolicy'`.

- [ ] **Step 3: Implement `backupPolicy.ts` (selection half)**

```ts
// src/backup/backupPolicy.ts
/**
 * Pure backup-policy helpers — no I/O, unit-testable. Owns the two decisions
 * that were previously wrong/scattered: (1) which file is the NEWEST backup
 * (was a lexicographic filename sort — broken across digit-count + the
 * Swift-decimal vs expo-integer timestamp boundary), and (2) whether a given
 * trigger should actually run a backup (see shouldRunBackup, Task 3).
 */
const BACKUP_PREFIX = 'backup_';
const BACKUP_EXT = '.solbk';

/**
 * Parse the timestamp embedded in a backup filename into epoch milliseconds.
 * Handles expo integer-seconds (`backup_1700000000.solbk`), expo fixed-width
 * ms (`backup_1700000000123.solbk`), and Swift decimal-seconds
 * (`backup_1700000000.123456.solbk`). Returns null when the name is not a
 * parseable backup file.
 */
export function parseBackupTimestampMs(name: string): number | null {
  if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(BACKUP_EXT)) return null;
  const stamp = name.slice(BACKUP_PREFIX.length, name.length - BACKUP_EXT.length);
  if (!/^\d+(\.\d+)?$/.test(stamp)) return null;
  const value = Number(stamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  // >= 1e12 → already milliseconds; otherwise seconds (incl. Swift decimal).
  return value >= 1e12 ? Math.round(value) : Math.round(value * 1000);
}

/** Backup filenames oldest→newest by parsed timestamp; unparseable names sort
 *  first (oldest) with a stable string tiebreak. */
export function sortBackupsByTimestamp(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const ta = parseBackupTimestampMs(a);
    const tb = parseBackupTimestampMs(b);
    if (ta === null && tb === null) return a < b ? -1 : a > b ? 1 : 0;
    if (ta === null) return -1;
    if (tb === null) return 1;
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** The newest backup filename, or null when none present. */
export function selectNewestBackup(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const sorted = sortBackupsByTimestamp(names);
  return sorted[sorted.length - 1] ?? null;
}

/** New backup filename using fixed-width epoch milliseconds — avoids the
 *  same-second collision the integer-seconds name had, stays parseable. */
export function newBackupName(nowMs: number): string {
  return `${BACKUP_PREFIX}${Math.floor(nowMs)}${BACKUP_EXT}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/expo && bun test __tests__/unit/backupPolicy.test.ts`
Expected: PASS (policy test added in Task 3).

- [ ] **Step 5: Commit**

```bash
git add apps/expo/src/backup/backupPolicy.ts apps/expo/__tests__/unit/backupPolicy.test.ts
git commit -m "feat(backup): pure timestamp parsing + chronological newest-backup selection"
```

---

### Task 2: Wire `cloudProvider` to the chronological selection

**Files:**
- Modify: `src/backup/cloudProvider.ts:120-188`

- [ ] **Step 1: Replace `newBackupName`, `sortedBackups`, and the "latest" picks**

Remove the local `newBackupName` + `isBackupName` (now in policy) and import the helpers:

```ts
// near the top imports
import {
  newBackupName,
  parseBackupTimestampMs,
  selectNewestBackup,
  sortBackupsByTimestamp,
} from './backupPolicy';
```

Replace the `isBackupName`/`newBackupName`/`sortedBackups` block (lines ~120-134) with:

```ts
/** Backup filenames, oldest first → newest last (chronological, not lexical). */
async function sortedBackups(ck: CloudKit): Promise<readonly string[]> {
  const names = (await ck.listFileBackups()).filter(
    (n) => parseBackupTimestampMs(n) !== null,
  );
  return sortBackupsByTimestamp(names);
}
```

In `uploadBackup` (line ~156) change `newBackupName()` → `newBackupName(Date.now())`.

In `downloadBackup` (line ~167-168) replace `const latest = names[names.length - 1];` with:

```ts
  const latest = selectNewestBackup(names as string[]);
```

In `backupMtime` (line ~179-180) make the same `selectNewestBackup(names as string[])` substitution.

- [ ] **Step 2: Fix the now-false comment** at the old `newBackupName` site (it's deleted) and verify `rotateBackups` still slices `names.slice(0, length - MAX_BACKUPS)` against the chronologically-sorted list (correct — drops oldest).

- [ ] **Step 3: Typecheck**

Run: `cd apps/expo && bun run typecheck`
Expected: 0 errors.

- [ ] **Step 4: Run the existing round-trip + new policy tests**

Run: `cd apps/expo && bun test __tests__/unit/icloudBackupRoundtrip.test.ts __tests__/unit/backupPolicy.test.ts`
Expected: PASS (round-trip still green; selection now chronological).

- [ ] **Step 5: Commit**

```bash
git add apps/expo/src/backup/cloudProvider.ts
git commit -m "fix(backup): select newest backup chronologically; fixed-width ms filenames"
```

---

### Task 3: `shouldRunBackup` policy (pure)

**Files:**
- Modify: `src/backup/backupPolicy.ts`
- Test: `__tests__/unit/backupPolicy.test.ts`

- [ ] **Step 1: Add the failing policy test**

```ts
// append to __tests__/unit/backupPolicy.test.ts
import { shouldRunBackup } from '../../src/backup/backupPolicy';

const base = {
  backupEnabled: true,
  autoBackupOnPull: true,
  lastRunAtMs: null as number | null,
  nowMs: 1_000_000,
  cooldownMs: 30_000,
};

describe('shouldRunBackup', () => {
  it('manual always runs, even when disabled', () => {
    expect(shouldRunBackup({ ...base, reason: 'manual', backupEnabled: false }).run).toBe(true);
  });
  it('auto trigger skips when backup disabled', () => {
    expect(shouldRunBackup({ ...base, reason: 'pull', backupEnabled: false }))
      .toEqual({ run: false, skipReason: 'disabled' });
  });
  it('pull skips when autoBackupOnPull is off', () => {
    expect(shouldRunBackup({ ...base, reason: 'pull', autoBackupOnPull: false }))
      .toEqual({ run: false, skipReason: 'pull-disabled' });
  });
  it('skips inside the cooldown window', () => {
    expect(shouldRunBackup({ ...base, reason: 'gesture', lastRunAtMs: 990_000, nowMs: 1_000_000 }))
      .toEqual({ run: false, skipReason: 'cooldown' });
  });
  it('runs once the cooldown has elapsed', () => {
    expect(shouldRunBackup({ ...base, reason: 'gesture', lastRunAtMs: 900_000, nowMs: 1_000_000 }).run).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/expo && bun test __tests__/unit/backupPolicy.test.ts`
Expected: FAIL — `shouldRunBackup is not a function`.

- [ ] **Step 3: Implement `shouldRunBackup` + types in `backupPolicy.ts`**

```ts
export type BackupReason = 'manual' | 'pull' | 'gesture' | 'onboarding';

export interface BackupPolicyInput {
  readonly reason: BackupReason;
  readonly backupEnabled: boolean;
  readonly autoBackupOnPull: boolean;
  readonly lastRunAtMs: number | null;
  readonly nowMs: number;
  readonly cooldownMs: number;
}

export interface BackupDecision {
  readonly run: boolean;
  readonly skipReason?: 'disabled' | 'pull-disabled' | 'cooldown';
}

/** Single source of truth for "should this trigger back up now?". Manual
 *  always runs; automatic triggers respect backupEnabled, the pull pref, and
 *  a shared cooldown so the (previously uncoordinated) triggers can't churn. */
export function shouldRunBackup(input: BackupPolicyInput): BackupDecision {
  if (input.reason === 'manual') return { run: true };
  if (!input.backupEnabled) return { run: false, skipReason: 'disabled' };
  if (input.reason === 'pull' && !input.autoBackupOnPull) {
    return { run: false, skipReason: 'pull-disabled' };
  }
  if (input.lastRunAtMs !== null && input.nowMs - input.lastRunAtMs < input.cooldownMs) {
    return { run: false, skipReason: 'cooldown' };
  }
  return { run: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/expo && bun test __tests__/unit/backupPolicy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/expo/src/backup/backupPolicy.ts apps/expo/__tests__/unit/backupPolicy.test.ts
git commit -m "feat(backup): shouldRunBackup policy (prefs + cooldown gate)"
```

---

### Task 4: `requestBackup` coordinator + wire all triggers

**Files:**
- Modify: `src/backup/backupManager.ts` (add coordinator + module cooldown state)
- Modify: `src/backup/index.ts` (export)
- Modify: `src/people/usePeopleScreen.ts:48-58`
- Modify: `src/backup/gestureAutoBackup.ts`
- Modify: `app/settings/backup.tsx:59-78`

- [ ] **Step 1: Add `requestBackup` to `backupManager.ts`**

Add imports + coordinator (after the existing imports / before `performBackupNow`):

```ts
import { usePreferences } from '@/settings/preferences';
import { setProvider } from './cloudProvider';
import { shouldRunBackup, type BackupReason } from './backupPolicy';

/** Shared cooldown for automatic backups (manual bypasses it). Matches the
 *  30s window gestureAutoBackup previously enforced on its own. */
const BACKUP_COOLDOWN_MS = 30_000;
let lastBackupAtMs: number | null = null;

export interface BackupRequestOutcome {
  readonly ran: boolean;
  readonly skipReason?: string;
  readonly payload?: BackupPayload;
}

/**
 * THE single coordinated backup entrypoint. Every trigger — manual button,
 * People pull-to-refresh, pan gesture — routes through here so the prefs
 * (enabled / pull / provider), provider selection, and the cooldown are all
 * applied in ONE place. Returns without backing up (ran:false) when the
 * policy says skip; never throws for a "skip", only for a genuine upload error.
 */
export async function requestBackup(reason: BackupReason): Promise<BackupRequestOutcome> {
  const prefs = usePreferences.getState();
  const decision = shouldRunBackup({
    reason,
    backupEnabled: prefs.backupEnabled,
    autoBackupOnPull: prefs.autoBackupOnPull,
    lastRunAtMs: lastBackupAtMs,
    nowMs: Date.now(),
    cooldownMs: BACKUP_COOLDOWN_MS,
  });
  if (!decision.run) return { ran: false, skipReason: decision.skipReason };
  setProvider(prefs.backupProvider); // make the provider pref actually take effect
  const payload = await performBackupNow(prefs.backupProvider);
  lastBackupAtMs = Date.now();
  return { ran: true, payload };
}
```

- [ ] **Step 2: Export it** — add to `src/backup/index.ts` the `performBackupNow` export block:

```ts
export {
  performBackupNow,
  requestBackup,
  restoreFromBackup,
  probeLatestBackup,
  type BackupReason,
  type BackupPayload,
  type BackupRequestOutcome,
  type RestoreResult,
} from './backupManager';
```

(`BackupReason` is re-exported from `backupManager`, which imports it from `backupPolicy` — add `export type { BackupReason } from './backupPolicy';` to `backupManager.ts` so the barrel line resolves.)

- [ ] **Step 3: People pull-to-refresh → coordinator**

In `src/people/usePeopleScreen.ts` change the import:

```ts
import { requestBackup } from '@/backup';
```

and the `refresh` body (lines 48-58):

```ts
  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        await hydrate();
        await requestBackup('pull'); // self-gates on backupEnabled + autoBackupOnPull + cooldown
      } finally {
        setRefreshing(false);
      }
    })();
  }, [hydrate]);
```

(Remove the now-unused `performBackupNow, DEFAULT_PROVIDER` import.)

- [ ] **Step 4: Gesture trigger → coordinator**

In `src/backup/gestureAutoBackup.ts` replace its `performBackupNow(...)` call with `requestBackup('gesture')` and delete its private 30s cooldown (the coordinator owns it now). Keep the gesture-recogniser plumbing unchanged.

- [ ] **Step 5: Manual button → coordinator**

In `app/settings/backup.tsx` change the import to add `requestBackup` and update `onBackupNow` (lines 59-78):

```ts
  const onBackupNow = async () => {
    setIsBackingUp(true);
    pushToast(t('backup.encrypting'), 'info', 2000);
    try {
      const result = await requestBackup('manual');
      if (result.payload) setLastBackup(new Date(result.payload.exportedAt));
      pushToast(t('backup.success'), 'success');
    } catch (err) {
      showError({ context: 'Backup › Back Up Now', summary: t('backup.failedSummary'), error: err });
    } finally {
      setIsBackingUp(false);
    }
  };
```

- [ ] **Step 6: Typecheck + tests**

Run: `cd apps/expo && bun run typecheck && bun test __tests__/unit/backupPolicy.test.ts __tests__/unit/icloudBackupRoundtrip.test.ts`
Expected: 0 type errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/expo/src/backup/backupManager.ts apps/expo/src/backup/index.ts apps/expo/src/people/usePeopleScreen.ts apps/expo/src/backup/gestureAutoBackup.ts apps/expo/app/settings/backup.tsx
git commit -m "feat(backup): single coordinated requestBackup entrypoint; wire pull/gesture/manual; provider pref now takes effect"
```

---

### Task 5: Restore key-mismatch → legible message

**Files:**
- Modify: `src/storage/encryptionManager.ts` (typed `DecryptError` on AES-GCM failure)
- Modify: `src/backup/backupManager.ts` (`BackupRestoreError`)
- Modify: `app/settings/backup.tsx` (map to message)
- Modify: `src/i18n/locales/en.json` + `zh-Hant.json`

- [ ] **Step 1:** Read `src/storage/encryptionManager.ts`, find the `decryptJson` throw site (AES-GCM open / auth-tag failure). Wrap it so it throws a named error:

```ts
export class DecryptError extends Error {
  constructor(message = 'decrypt-failed', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecryptError';
  }
}
```

Throw `new DecryptError('decrypt-failed', { cause })` where decryption currently fails. (Keep `Result`-style returns where the file already uses them; only the throwing path needs the type.)

- [ ] **Step 2:** In `backupManager.ts` add and use a restore error:

```ts
import { DecryptError } from '../storage/encryptionManager';

export class BackupRestoreError extends Error {
  constructor(readonly kind: 'key-mismatch' | 'unreadable', options?: { cause?: unknown }) {
    super(kind, options);
    this.name = 'BackupRestoreError';
  }
}
```

In `restoreFromBackup`, wrap the download/decrypt:

```ts
  let payload: BackupPayload | null;
  try {
    payload = await downloadBackup<BackupPayload>();
  } catch (err) {
    throw new BackupRestoreError(
      err instanceof DecryptError ? 'key-mismatch' : 'unreadable',
      { cause: err },
    );
  }
  if (!payload) return null;
```

- [ ] **Step 3:** In `app/settings/backup.tsx` `performRestoreNow` catch, branch on the error:

```ts
    } catch (err) {
      const summary =
        err instanceof BackupRestoreError && err.kind === 'key-mismatch'
          ? t('backup.restore.keyMismatch')
          : t('backup.restore.failedSummary');
      showError({ context: 'Backup › Restore', summary, error: err });
    }
```

(Import `BackupRestoreError` from `@/backup` — add it to the barrel export.)

- [ ] **Step 4:** Add i18n keys to both catalogs under `backup.restore`:
  - `en.json`: `"keyMismatch": "This backup was made with a different key — likely an older app version or a different device. It can't be decrypted on this install."`
  - `zh-Hant.json`: `"keyMismatch": "此備份是以不同的金鑰建立的（可能來自舊版 App 或其他裝置），無法在此安裝上解密。"`

- [ ] **Step 5: Typecheck + i18n catalog test**

Run: `cd apps/expo && bun run typecheck && bun test __tests__/unit/i18nCatalog.test.ts`
Expected: 0 type errors; catalog test PASS (both locales have the new key).

- [ ] **Step 6: Commit**

```bash
git add apps/expo/src/storage/encryptionManager.ts apps/expo/src/backup/backupManager.ts apps/expo/src/backup/index.ts apps/expo/app/settings/backup.tsx apps/expo/src/i18n/locales/en.json apps/expo/src/i18n/locales/zh-Hant.json
git commit -m "feat(backup): typed restore key-mismatch with a clear message (not flaky-iCloud)"
```

---

### Task 6: Android Drive auth → typed "needs connection" state

**Files:**
- Modify: `src/backup/cloudProvider.ts:61-99` (`ensureDriveAuth` returns a status; `ensureInitialized` propagates)
- Modify: `app/settings/backup.tsx` (surface "connect Google Drive")
- Modify: `src/i18n/locales/en.json` + `zh-Hant.json` (`backup.drive.needsConnection`)

- [ ] **Step 1:** Change `ensureDriveAuth` to return a typed result instead of swallowing:

```ts
export type DriveAuthStatus = 'authorized' | 'needs-connection' | 'unavailable';

async function ensureDriveAuth(): Promise<DriveAuthStatus> {
  if (driveAuthorized) return 'authorized';
  try {
    const { signInForDrive, refreshDriveAccessToken } = await import('./googleAuth');
    try {
      setGoogleAccessToken(await refreshDriveAccessToken());
      return 'authorized';
    } catch {
      const session = await signInForDrive();
      setGoogleAccessToken(session.accessToken);
      return 'authorized';
    }
  } catch {
    // Module absent (tests) OR user declined — distinguishable by the caller
    // as "needs connection" rather than an opaque downstream 401.
    return 'needs-connection';
  }
}
```

- [ ] **Step 2:** In `ensureInitialized`, when provider is `googleDrive` and `ensureDriveAuth()` returns `'needs-connection'`, attach that to a module flag the coordinator can read (do NOT throw — keep the pipeline non-crashing). Add:

```ts
let lastDriveAuthStatus: DriveAuthStatus = 'authorized';
export function getDriveAuthStatus(): DriveAuthStatus { return lastDriveAuthStatus; }
```

set `lastDriveAuthStatus = await ensureDriveAuth();` in the `activeProvider === 'googleDrive'` branch.

- [ ] **Step 3:** In `requestBackup` (Task 4), after `setProvider`, if on Android Drive and `getDriveAuthStatus() === 'needs-connection'`, return `{ ran: false, skipReason: 'needs-connection' }`; `app/settings/backup.tsx` `onBackupNow` checks `result.skipReason === 'needs-connection'` and shows `appAlert({ title: t('backup.drive.needsConnection') ... })`.

- [ ] **Step 4:** Add `backup.drive.needsConnection` to both catalogs (en: "Connect Google Drive to back up on Android."; zh-Hant: "請先連接 Google 雲端硬碟以在 Android 上備份。").

- [ ] **Step 5: Typecheck + tests**

Run: `cd apps/expo && bun run typecheck && bun test __tests__/unit/i18nCatalog.test.ts`
Expected: 0 type errors; PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/expo/src/backup/cloudProvider.ts apps/expo/app/settings/backup.tsx apps/expo/src/i18n/locales/en.json apps/expo/src/i18n/locales/zh-Hant.json
git commit -m "feat(backup): typed Android Drive auth state → actionable connect prompt"
```

---

## Final verification

- [ ] `cd apps/expo && bun run typecheck` → 0 errors
- [ ] `cd apps/expo && bun test` → all suites pass (esp. `backupPolicy`, `icloudBackupRoundtrip`, `i18nCatalog`)
- [ ] `cd apps/expo && bun run lint` → 0 errors
- [ ] Manual sanity (simulator): pull-to-refresh on People with backup **off** does NOT back up; toggling provider in Backup settings and "Back Up Now" targets the chosen provider.

## Self-review notes (done)

- **Spec coverage:** A1.1 (Task 4), A1.2 (Task 4 `setProvider`), A1.3 (Tasks 1-2), A1.4 (Task 5), A1.5 (Task 6). ✓
- **Placeholder scan:** Task 5 step 1 / Task 6 reference reading `encryptionManager.ts` + `gestureAutoBackup.ts` to locate exact edit sites — the *change* is specified with code; only the surrounding line numbers are confirmed at edit time (existing-codebase норма).
- **Type consistency:** `BackupReason` defined in `backupPolicy` (Task 3), imported by `backupManager` (Task 4); `requestBackup` returns `BackupRequestOutcome` used identically in people/gesture/backup.tsx; `DecryptError`→`BackupRestoreError('key-mismatch')`→`t('backup.restore.keyMismatch')` chain consistent.
