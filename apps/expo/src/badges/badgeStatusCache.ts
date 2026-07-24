/**
 * badgeStatusCache — the last COMPLETED badge verification result per
 * platform, persisted in MMKV so the Me tab paints the previous known
 * state on frame one (no loading flash, survives restart, works offline)
 * while the live re-verify runs.
 *
 * HONESTY (spec §7): the cache SEEDS the chip, and a result younger than
 * `BADGE_REVERIFY_TTL_MS` is also TRUSTED — the live re-verify is skipped
 * (user decision 2026-07-17: stop re-opening three relay sockets on every
 * Me-tab focus). What keeps that honest: `checkedAt` is surfaced in the
 * evidence sheet ("Last checked …"); the claim-match guard at the call
 * site drops a cached entry whose npub/handle no longer matches the
 * record; `shouldReverifyBadge` forces a live check when the record was
 * re-signed after the cached check; and a successful publish INVALIDATES
 * the nostr entry (`invalidateCachedNostrResult`) so a fresh binding is
 * never masked by a pre-publish result for the TTL window. A downgrade
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
  readonly removeKey: (key: string) => void;
}

/**
 * How long a completed check keeps standing in for a live one. Binding
 * state changes rarely (a kind-0 edit, a PDS record change) and the
 * evidence sheet always shows WHEN it was checked, so 15 minutes trades
 * no honesty for dropping the three-relay WebSocket fan-out on every
 * tab focus.
 */
export const BADGE_REVERIFY_TTL_MS = 15 * 60_000;

/**
 * Whether the live verification must run despite a cached result.
 * True when there is no completed check (`checkedAt === null`), the check
 * is older than the TTL, or the record was re-signed AFTER the check (an
 * unparseable `updatedAt` also re-verifies — fail toward checking, never
 * toward trusting). Claim matching stays at the call site — the two
 * platforms key their claims differently.
 */
export function shouldReverifyBadge(
  checkedAt: number | null,
  recordUpdatedAt: string,
  nowMs: number
): boolean {
  if (checkedAt === null) return true;
  if (nowMs - checkedAt >= BADGE_REVERIFY_TTL_MS) return true;
  const updatedMs = Date.parse(recordUpdatedAt);
  if (Number.isNaN(updatedMs)) return true;
  return updatedMs > checkedAt;
}

let cachedGetMmkv: typeof GetMmkvFn | undefined;
let cacheRevision = 0;
const cacheListeners = new Set<() => void>();

function notifyCacheListeners(): void {
  cacheRevision += 1;
  for (const listener of cacheListeners) {
    try {
      listener();
    } catch {
      // One mounted consumer must never block cache persistence or peers.
    }
  }
}

/** React's external-store seam: mounted share surfaces update immediately
 * when a background badge check writes or invalidates cached evidence. */
export function subscribeBadgeStatusCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

export function getBadgeStatusCacheRevision(): number {
  return cacheRevision;
}

/** Call exactly once from `app/_layout.tsx` after `initMmkv()`. A no-op
 * (never throws) when MMKV is unavailable — reads stay `null`. */
export async function warmBadgeStatusCache(): Promise<void> {
  try {
    const mod = await import('@/storage/mmkv');
    cachedGetMmkv = mod.getMmkv;
    notifyCacheListeners();
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
  removeKey: (key) => {
    if (!cachedGetMmkv) return;
    try {
      cachedGetMmkv().remove(key);
    } catch {
      // Best effort — a lost invalidation only costs one extra TTL wait.
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
  notifyCacheListeners();
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

/** A publish just changed the kind-0 side — a pre-publish result must not
 * stand in for a live check for the rest of its TTL. */
export function invalidateCachedNostrResult(): void {
  activeStorage.removeKey(NOSTR_KEY);
  notifyCacheListeners();
}

export function invalidateCachedAtprotoResult(): void {
  activeStorage.removeKey(ATPROTO_KEY);
  notifyCacheListeners();
}
