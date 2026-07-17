/**
 * badgeStatusCache — the last COMPLETED badge verification result per
 * platform, persisted in MMKV so the Me tab paints the previous known
 * state on frame one (no loading flash, survives restart, works offline)
 * while the live re-verify runs.
 *
 * HONESTY (spec §7): the cache only ever SEEDS the chip — every focus
 * still runs the real `verifyNostrBinding` / `verifyAtprotoBinding`, whose
 * completed result overwrites both the UI and this cache. A cached entry
 * whose claim no longer matches the current record is ignored by the
 * caller's existing claim-match guard (`ProfileBadgeChips`), and
 * `checkedAt` is surfaced in the evidence sheet ("Last checked …") so a
 * seeded state is never presented as a fresh check. A downgrade
 * (verified → stale/declared) is cached just the same — last KNOWN state,
 * not last GOOD state.
 *
 * Storage follows `nostr/userKey.ts`'s mirror pattern: `@/storage/mmkv`
 * is loaded lazily via `warmBadgeStatusCache()` (called once from
 * `app/_layout.tsx` right after `initMmkv()`), so importing this module
 * never pulls `react-native-mmkv` in at module-load time and bun's test
 * runner can load it; cold reads degrade to `null`, never a fabricated
 * result.
 */
import type {
  VerifyAtprotoBindingResult,
  VerifyNostrBindingResult,
} from '@solidarity/shared';

// Type-only — runtime handle arrives via warmBadgeStatusCache (see doc).
import type { getMmkv as GetMmkvFn } from '@/storage/mmkv';

const NOSTR_KEY = 'badges:nostr:lastResult:v1';
const ATPROTO_KEY = 'badges:atproto:lastResult:v1';

export interface CachedBadgeResult<T> {
  /** Epoch ms of the completed live check that produced `result`. */
  readonly checkedAt: number;
  readonly result: T;
}

export interface BadgeStatusCacheStorage {
  readonly getString: (key: string) => string | null;
  readonly setString: (key: string, value: string) => void;
}

let cachedGetMmkv: typeof GetMmkvFn | undefined;

/** Call exactly once from `app/_layout.tsx` after `initMmkv()`. A no-op
 * (never throws) when MMKV is unavailable — reads stay `null`. */
export async function warmBadgeStatusCache(): Promise<void> {
  try {
    const mod = await import('@/storage/mmkv');
    cachedGetMmkv = mod.getMmkv;
  } catch {
    // Native module unavailable (web preview, tests) — cache stays cold.
  }
}

const defaultStorage: BadgeStatusCacheStorage = {
  getString: (key) => {
    if (!cachedGetMmkv) return null;
    try {
      return cachedGetMmkv().getString(key) ?? null;
    } catch {
      return null;
    }
  },
  setString: (key, value) => {
    if (!cachedGetMmkv) return;
    try {
      cachedGetMmkv().set(key, value);
    } catch {
      // Best effort — a lost cache write only costs one loading flash.
    }
  },
};

let activeStorage: BadgeStatusCacheStorage = defaultStorage;

/** Test-only override. Pass `null` to restore the MMKV-backed default. */
export function __setBadgeStatusCacheStorageForTesting(
  storage: BadgeStatusCacheStorage | null
): void {
  activeStorage = storage ?? defaultStorage;
}

function readEntry<T>(key: string, resultGuard: (value: unknown) => boolean): CachedBadgeResult<T> | null {
  const raw = activeStorage.getString(key);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { checkedAt?: unknown }).checkedAt !== 'number' ||
      !resultGuard((parsed as { result?: unknown }).result)
    ) {
      return null;
    }
    return parsed as CachedBadgeResult<T>;
  } catch {
    return null;
  }
}

function writeEntry<T>(key: string, result: T, checkedAt: number): void {
  const entry: CachedBadgeResult<T> = { checkedAt, result };
  activeStorage.setString(key, JSON.stringify(entry));
}

/** Shallow shape guards — the semantic claim-match guard lives at the
 * call site (`nostrResult.npub === npubClaim` etc.), so a stale-shaped or
 * foreign entry degrades to `null`/ignored, never a crash. */
function isNostrResultShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    'npub' in value &&
    'evidence' in value
  );
}

function isAtprotoResultShape(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'state' in value &&
    'evidence' in value
  );
}

export function readCachedNostrResult(): CachedBadgeResult<VerifyNostrBindingResult> | null {
  return readEntry<VerifyNostrBindingResult>(NOSTR_KEY, isNostrResultShape);
}

export function writeCachedNostrResult(
  result: VerifyNostrBindingResult,
  checkedAt: number
): void {
  writeEntry(NOSTR_KEY, result, checkedAt);
}

export function readCachedAtprotoResult(): CachedBadgeResult<VerifyAtprotoBindingResult> | null {
  return readEntry<VerifyAtprotoBindingResult>(ATPROTO_KEY, isAtprotoResultShape);
}

export function writeCachedAtprotoResult(
  result: VerifyAtprotoBindingResult,
  checkedAt: number
): void {
  writeEntry(ATPROTO_KEY, result, checkedAt);
}
