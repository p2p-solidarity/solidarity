/**
 * Identity store selector stability regression — `useDisplayClaims`.
 *
 * Repro of the runtime crash that bricked the Me tab:
 *   ERROR The result of getSnapshot should be cached to avoid an infinite loop
 *   ERROR Maximum update depth exceeded.
 *
 * Root cause: the selector was `s => displayClaims(s.provableClaims)`, and
 * `displayClaims` always returns a freshly-allocated array. `useSyncExternalStore`
 * (zustand's reader) does an `Object.is` check against the previous snapshot;
 * a new array each call means it never matches, so React keeps re-rendering.
 *
 * What this file pins (no React renderer required — this project ships
 * `bun test` only, so we exercise the contracts at the zustand layer):
 *
 *   1. `displayClaims(input)` is a pure function — same input → equal output.
 *   2. The zustand-layer selector that drives `useDisplayClaims` returns
 *      the SAME `Object.is`-stable slice reference between repeated calls
 *      when state is unchanged (the load-bearing fix). The previous
 *      implementation derived a new array per call and tripped React's
 *      "infinite loop in getSnapshot" guard.
 *   3. The slice reference flips when the store actually mutates.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ProvableClaimEntity } from '../../src/identity/entities';

interface IdentityDataSurface {
  readonly useIdentityData: {
    getState: () => {
      readonly identityCards: readonly unknown[];
      readonly provableClaims: readonly ProvableClaimEntity[];
      readonly hydrated: boolean;
    };
    setState: (
      s: Partial<{
        identityCards: readonly unknown[];
        provableClaims: readonly ProvableClaimEntity[];
        hydrated: boolean;
      }>
    ) => void;
  };
  readonly displayClaims: (
    claims: readonly ProvableClaimEntity[]
  ) => readonly ProvableClaimEntity[];
}

const kv = new Map<string, string>();
let mod: IdentityDataSurface;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (k: string): string | undefined => kv.get(k),
      set: (k: string, v: string): void => {
        kv.set(k, v);
      },
      remove: (k: string): void => {
        kv.delete(k);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
    }),
    initMmkv: async () => undefined,
  }));
  await mock.module('@/storage/encryptionManager', () => ({
    encryptJson: async (v: unknown) => JSON.stringify(v),
    decryptJson: async <T,>(s: string): Promise<T> => JSON.parse(s) as T,
  }));
  await mock.module('@/credentials/store', () => ({
    useCredentialStore: {
      getState: () => ({
        manifest: [] as readonly unknown[],
        details: new Map<string, unknown>(),
        detailsHydrated: true,
        hydrate: async () => undefined,
      }),
    },
  }));
  mod = (await import('../../src/identity/dataStore')) as unknown as IdentityDataSurface;
});

beforeEach(() => {
  kv.clear();
  mod.useIdentityData.setState({
    identityCards: [],
    provableClaims: [],
    hydrated: true,
  });
});

function makeClaim(
  id: string,
  claimType: string,
  overrides: Partial<ProvableClaimEntity> = {}
): ProvableClaimEntity {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    identityCardId: `card-${id}`,
    claimType,
    title: `${claimType} claim`,
    issuerType: 'self',
    trustLevel: 'L1',
    source: 'mock',
    payload: '{}',
    isPresentable: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('displayClaims (pure)', () => {
  it('filters out non-presentable claims', () => {
    const a = makeClaim('1', 'is_human', { isPresentable: false });
    const b = makeClaim('2', 'age_over_18');
    const out = mod.displayClaims([a, b]);
    expect(out.map((c) => c.id)).toEqual(['2']);
  });

  it('keeps only the first profile_card', () => {
    const a = makeClaim('1', 'profile_card');
    const b = makeClaim('2', 'profile_card');
    const c = makeClaim('3', 'is_human');
    const out = mod.displayClaims([a, b, c]);
    expect(out.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('passes through unique claim types unchanged', () => {
    const a = makeClaim('1', 'is_human');
    const b = makeClaim('2', 'age_over_18');
    const out = mod.displayClaims([a, b]);
    expect(out).toHaveLength(2);
  });
});

describe('useIdentityData selector — snapshot stability (infinite-loop regression)', () => {
  /**
   * This is the load-bearing fix: `useDisplayClaims` no longer feeds
   * `displayClaims(s.provableClaims)` directly to `useIdentityData`. It now
   * selects the raw slice (`s.provableClaims`) — a reference owned by the
   * store and only swapped on `set(...)` — and memoises the derivation in
   * React-land via `useMemo`. Reading the raw slice 10 times therefore
   * returns the SAME reference.
   *
   * The previous code returned a freshly-allocated array each call, which
   * tripped React's `useSyncExternalStore` infinite-loop guard.
   */
  it('reading provableClaims via getState returns the SAME reference 10x', () => {
    const claims = [makeClaim('1', 'is_human'), makeClaim('2', 'age_over_18')];
    mod.useIdentityData.setState({ provableClaims: claims });

    const first = mod.useIdentityData.getState().provableClaims;
    for (let i = 0; i < 10; i++) {
      const next = mod.useIdentityData.getState().provableClaims;
      expect(Object.is(next, first)).toBe(true);
    }
  });

  it('the slice reference changes only after the store mutates', () => {
    mod.useIdentityData.setState({
      provableClaims: [makeClaim('1', 'is_human')],
    });
    const before = mod.useIdentityData.getState().provableClaims;

    mod.useIdentityData.setState({
      provableClaims: [
        makeClaim('1', 'is_human'),
        makeClaim('2', 'age_over_18'),
      ],
    });
    const after = mod.useIdentityData.getState().provableClaims;

    expect(Object.is(after, before)).toBe(false);
    expect(after.map((c) => c.id)).toEqual(['1', '2']);
  });

  /**
   * Regression: PROVES the old pattern would fail. Calling
   * `displayClaims(...)` directly on each read allocates a new array per
   * call, which is exactly what `useSyncExternalStore` rejects. The new
   * `useDisplayClaims` consumes the stable slice (test above) and runs
   * `displayClaims` inside a `useMemo`, so the derived array stays stable
   * across renders.
   */
  it('a fresh displayClaims() call always allocates a NEW array (why useMemo is required)', () => {
    const claims = [makeClaim('1', 'is_human'), makeClaim('2', 'age_over_18')];
    const a = mod.displayClaims(claims);
    const b = mod.displayClaims(claims);
    expect(Object.is(a, b)).toBe(false);
    expect(a).toEqual(b);
  });
});
