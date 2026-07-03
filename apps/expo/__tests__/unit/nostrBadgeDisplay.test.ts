/**
 * Nostr badge view-model mapping — 04-plan Phase A4 task A4.4.
 *
 * TS module under test: apps/expo/src/badges/nostrBadgeDisplay.ts
 *
 * What this suite pins — the honesty contract (01-spec §7 / 03-spec §3):
 *   1. `npub === null` (no claim at all) is ALWAYS `'hidden'`, regardless
 *      of the `BadgeState` the result carries or whether a check is in
 *      flight — never a grey "unverified" placeholder badge.
 *   2. `'loading'` renders ONLY when there is no prior result at all
 *      (`result === null && isChecking`). Once a result exists,
 *      `isChecking` is IGNORED — a background re-verify never flips a
 *      rendered badge back to a loading skeleton (CLAUDE.md rule 10:
 *      "no skeleton on warm").
 *   3. `verified` / `declared` / `stale` map 1:1 and are mutually
 *      exclusive visuals — critically, `declared` and `stale` NEVER map to
 *      `'verified'`, including the defensive `revoked` BadgeState case
 *      (which the real verifier cannot produce today, but this pins the
 *      fail-closed behavior if it ever does).
 *   4. Evidence fields (npub/pubkeyHex/kind0CreatedAt/direction1/
 *      direction2) pass through verbatim for the "one click to evidence"
 *      requirement.
 */
import { describe, expect, it } from 'bun:test';

import { nostrBadgeViewModel, type NostrBadgeVisual } from '@/badges/nostrBadgeDisplay';
import type { BadgeState, VerifyNostrBindingResult } from '@solidarity/shared';

const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
const PUBKEY_HEX = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';

function resultFor(state: BadgeState, overrides: Partial<VerifyNostrBindingResult['evidence']> = {}): VerifyNostrBindingResult {
  return {
    state,
    npub: NPUB,
    evidence: {
      npubClaim: NPUB,
      pubkeyHex: PUBKEY_HEX,
      direction1: true,
      direction2: state === 'verified' ? true : state === 'stale' ? null : false,
      kind0CreatedAt: state === 'stale' ? null : 1_751_500_000,
      reason: 'test reason (not asserted on — UI never renders this raw string, see module doc)',
      ...overrides,
    },
  };
}

const NO_CLAIM_RESULT: VerifyNostrBindingResult = {
  state: 'declared',
  npub: null,
  evidence: {
    npubClaim: null,
    pubkeyHex: null,
    direction1: false,
    direction2: null,
    kind0CreatedAt: null,
    reason: 'no claim',
  },
};

describe('no result yet (result === null)', () => {
  it('is `loading` while a check is in flight', () => {
    const vm = nostrBadgeViewModel(null, true);
    expect(vm.visual).toBe('loading');
    expect(vm.npub).toBeNull();
  });

  it('is `hidden` when nothing is in flight either (nothing known, nothing rendered)', () => {
    const vm = nostrBadgeViewModel(null, false);
    expect(vm.visual).toBe('hidden');
  });
});

describe('npub === null — no claim at all', () => {
  it('is always `hidden`, even though `state` is populated ("declared" per the module doc)', () => {
    expect(nostrBadgeViewModel(NO_CLAIM_RESULT, false).visual).toBe('hidden');
    expect(nostrBadgeViewModel(NO_CLAIM_RESULT, true).visual).toBe('hidden');
  });
});

describe('state -> visual mapping — the honesty contract', () => {
  const cases: readonly (readonly [BadgeState, NostrBadgeVisual])[] = [
    ['verified', 'verified'],
    ['declared', 'declared'],
    ['stale', 'stale'],
    // Defensive: the real verifier can't emit this today, but if it ever
    // does, it must fail closed to the hollow visual — never a green check.
    ['revoked', 'declared'],
  ];

  for (const [state, expected] of cases) {
    it(`BadgeState '${state}' -> visual '${expected}'`, () => {
      const vm = nostrBadgeViewModel(resultFor(state), false);
      expect(vm.visual).toBe(expected);
    });
  }

  it('declared/stale/revoked never produce the `verified` visual', () => {
    for (const state of ['declared', 'stale', 'revoked'] as const) {
      expect(nostrBadgeViewModel(resultFor(state), false).visual).not.toBe('verified');
    }
  });
});

describe('stale-while-revalidate — `isChecking` is ignored once a result exists', () => {
  it('a verified result stays `verified` while a silent background re-check is in flight', () => {
    const vm = nostrBadgeViewModel(resultFor('verified'), true);
    expect(vm.visual).toBe('verified');
  });

  it('a stale result stays `stale` (not `loading`) while a background re-check is in flight', () => {
    const vm = nostrBadgeViewModel(resultFor('stale'), true);
    expect(vm.visual).toBe('stale');
  });
});

describe('evidence pass-through', () => {
  it('carries npub/pubkeyHex/kind0CreatedAt/direction1/direction2 verbatim for the evidence panel', () => {
    const result = resultFor('verified');
    const vm = nostrBadgeViewModel(result, false);
    expect(vm.npub).toBe(NPUB);
    expect(vm.pubkeyHex).toBe(PUBKEY_HEX);
    expect(vm.kind0CreatedAt).toBe(1_751_500_000);
    expect(vm.direction1).toBe(true);
    expect(vm.direction2).toBe(true);
  });

  it('a stale result carries direction2: null and kind0CreatedAt: null (distinct from a false reciprocation)', () => {
    const vm = nostrBadgeViewModel(resultFor('stale'), false);
    expect(vm.direction2).toBeNull();
    expect(vm.kind0CreatedAt).toBeNull();
    expect(vm.direction1).toBe(true);
  });
});
