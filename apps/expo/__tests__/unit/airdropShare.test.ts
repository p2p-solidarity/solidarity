/**
 * airdropShare — verifies the JS wrapper around `@solidarity/nitro-airdrop`.
 *
 * The native Swift / Kotlin sides can only be exercised on a real device
 * (the simulator's AirDrop sheet is non-interactive and Android has no
 * AirDrop). What we *can* test in `bun` is that:
 *
 *   1. `isAirdropAvailable()` reports false on non-iOS (so callers branch
 *      to `expo-sharing` instead of trying to invoke the Kotlin stub).
 *   2. `shareBusinessCardViaAirdrop(card)` passes through to the native
 *      `share({ fileName, utiType, data })` with:
 *        - `fileName === "<safe-name>.vcf"` (no slashes / control chars)
 *        - `utiType === "public.vcard"`
 *        - `data` containing the vCard bytes encoded as UTF-8
 *   3. `shareWalletPassViaAirdrop(card, bytes)` passes through with the
 *      `com.apple.pkpass` UTI and the unmodified pass bytes.
 *   4. A native rejection (e.g. Android stub's "iOS-only" error) propagates
 *      as a JS error the caller can handle.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { Airdrop, AirdropPayload, AirdropResult } from '@solidarity/nitro-airdrop';
import type { BusinessCard } from '@solidarity/shared';

// ── Capture every share() call so each `it` can assert on the most recent ─────

interface CapturedShare {
  readonly payload: AirdropPayload;
}

const shares: CapturedShare[] = [];

let nextShareBehaviour: () => Promise<AirdropResult> = () =>
  Promise.resolve({
    completed: true,
    cancelled: false,
    errorMessage: undefined,
  });
let availabilityBehaviour: () => boolean = () => true;
let currentPlatformOS: 'ios' | 'android' | 'web' = 'ios';

const FakeAirdrop: Airdrop = {
  isAvailable: (): boolean => availabilityBehaviour(),
  share: async (payload: AirdropPayload): Promise<AirdropResult> => {
    shares.push({ payload });
    return nextShareBehaviour();
  },
} as unknown as Airdrop;

beforeAll(async () => {
  await mock.module('@solidarity/nitro-airdrop', () => ({
    getAirdrop: () => FakeAirdrop,
  }));
  await mock.module('react-native', () => ({
    Platform: {
      get OS() {
        return currentPlatformOS;
      },
      select: <T,>(o: { ios?: T; android?: T; default?: T }) => o.ios ?? o.default,
    },
  }));
});

beforeEach(() => {
  shares.length = 0;
  nextShareBehaviour = () =>
    Promise.resolve({
      completed: true,
      cancelled: false,
      errorMessage: undefined,
    });
  availabilityBehaviour = () => true;
  currentPlatformOS = 'ios';
});

afterEach(() => {
  // Sanity: every share captured had a non-empty fileName and a UTI. An
  // empty fileName would render an unhelpful AirDrop tile on the receiver.
  for (const s of shares) {
    expect(s.payload.fileName.length).toBeGreaterThan(0);
    expect(s.payload.utiType.length).toBeGreaterThan(0);
  }
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

const TEST_CARD: BusinessCard = {
  id: '11111111-2222-3333-4444-555555555555',
  name: 'Alice Lovelace',
  title: 'Engineer',
  company: 'Solidarity',
  email: 'alice@solidarity.gg',
  phone: undefined,
  profileImage: undefined,
  animal: undefined,
  socialNetworks: [],
  skills: [],
  categories: [],
  sharingPreferences: {
    publicLevel: { fields: [], includeProfileImage: false },
    professionalLevel: { fields: [], includeProfileImage: false },
    personalLevel: { fields: [], includeProfileImage: false },
  } as unknown as BusinessCard['sharingPreferences'],
  groupContext: undefined,
  verifiedFields: undefined,
  nameType: 'display_name',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

// ── isAirdropAvailable ─────────────────────────────────────────────────────────

describe('isAirdropAvailable — platform gate', () => {
  it('returns true on iOS when the native side reports available', async () => {
    const { isAirdropAvailable } = await import('../../src/sharing/airdrop');
    currentPlatformOS = 'ios';
    availabilityBehaviour = () => true;
    expect(isAirdropAvailable()).toBe(true);
  });

  it('returns false on Android (no native AirDrop)', async () => {
    const { isAirdropAvailable } = await import('../../src/sharing/airdrop');
    currentPlatformOS = 'android';
    expect(isAirdropAvailable()).toBe(false);
  });

  it('returns false on web', async () => {
    const { isAirdropAvailable } = await import('../../src/sharing/airdrop');
    currentPlatformOS = 'web';
    expect(isAirdropAvailable()).toBe(false);
  });

  it('returns false when the native side throws (defensive)', async () => {
    const { isAirdropAvailable } = await import('../../src/sharing/airdrop');
    currentPlatformOS = 'ios';
    availabilityBehaviour = () => {
      throw new Error('boom');
    };
    expect(isAirdropAvailable()).toBe(false);
  });
});

// ── shareBusinessCardViaAirdrop ────────────────────────────────────────────────

describe('shareBusinessCardViaAirdrop — vCard pass-through', () => {
  it('wraps the card as a vCard, uses public.vcard UTI, and resolves with the native result', async () => {
    const { shareBusinessCardViaAirdrop } = await import('../../src/sharing/airdrop');
    const result = await shareBusinessCardViaAirdrop(TEST_CARD);
    expect(result.completed).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(shares.length).toBe(1);
    const first = shares[0];
    if (!first) throw new Error('expected one share');
    const got = first.payload;
    expect(got.utiType).toBe('public.vcard');
    expect(got.fileName).toMatch(/\.vcf$/);
    // fileName is sanitised: the space in "Alice Lovelace" becomes "_".
    expect(got.fileName).toBe('Alice_Lovelace.vcf');
  });

  it('UTF-8 encodes the vCard bytes so the receiver sees identical text', async () => {
    const { shareBusinessCardViaAirdrop } = await import('../../src/sharing/airdrop');
    await shareBusinessCardViaAirdrop(TEST_CARD);
    const first = shares[0];
    if (!first) throw new Error('expected one share');
    const payload = first.payload;
    const text = new TextDecoder().decode(new Uint8Array(payload.data));
    expect(text).toContain('BEGIN:VCARD');
    expect(text).toContain('VERSION:3.0');
    expect(text).toContain('FN:Alice Lovelace');
    expect(text).toContain('EMAIL;TYPE=INTERNET:alice@solidarity.gg');
    expect(text).toContain('END:VCARD');
  });

  it('falls back to "Card.vcf" when the card name is empty/whitespace', async () => {
    const { shareBusinessCardViaAirdrop } = await import('../../src/sharing/airdrop');
    const blank: BusinessCard = { ...TEST_CARD, name: '   ' };
    await shareBusinessCardViaAirdrop(blank);
    const first = shares[0];
    if (!first) throw new Error('expected one share');
    expect(first.payload.fileName).toBe('Card.vcf');
  });

  it('rejects when the native side rejects (Android stub or iOS presentation failure)', async () => {
    const { shareBusinessCardViaAirdrop } = await import('../../src/sharing/airdrop');
    nextShareBehaviour = () =>
      Promise.reject(new Error('AirDrop is an iOS-only feature.'));
    let captured: Error | null = null;
    try {
      await shareBusinessCardViaAirdrop(TEST_CARD);
    } catch (e) {
      captured = e as Error;
    }
    expect(captured).not.toBeNull();
    expect(captured?.message).toMatch(/iOS-only/i);
  });

  it('surfaces a cancelled result without throwing', async () => {
    const { shareBusinessCardViaAirdrop } = await import('../../src/sharing/airdrop');
    nextShareBehaviour = () =>
      Promise.resolve({
        completed: false,
        cancelled: true,
        errorMessage: undefined,
      });
    const r = await shareBusinessCardViaAirdrop(TEST_CARD);
    expect(r.completed).toBe(false);
    expect(r.cancelled).toBe(true);
    expect(r.errorMessage).toBeUndefined();
  });
});

// ── shareWalletPassViaAirdrop ──────────────────────────────────────────────────

describe('shareWalletPassViaAirdrop — pkpass pass-through', () => {
  it('uses com.apple.pkpass UTI and forwards the pass bytes verbatim', async () => {
    const { shareWalletPassViaAirdrop } = await import('../../src/sharing/airdrop');
    const passBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer; // ZIP magic
    const r = await shareWalletPassViaAirdrop(TEST_CARD, passBytes);
    expect(r.completed).toBe(true);
    expect(shares.length).toBe(1);
    const first = shares[0];
    if (!first) throw new Error('expected one share');
    const got = first.payload;
    expect(got.utiType).toBe('com.apple.pkpass');
    expect(got.fileName).toBe('Alice_Lovelace.pkpass');
    // Bytes survive the bridge unmodified.
    const view = new Uint8Array(got.data);
    expect(view.length).toBe(6);
    expect(view[0]).toBe(0x50);
    expect(view[1]).toBe(0x4b);
  });
});
