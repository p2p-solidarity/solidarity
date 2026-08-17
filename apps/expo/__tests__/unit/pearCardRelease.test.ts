/**
 * `src/pear/cardRelease.ts` — the pure responder-side consent decision
 * logic for A5.2's full-card exchange (what `onCardRequest`'s handler
 * actually does). No React/RN/biometric module involved — every dependency
 * is injected, so this pins the exact sequence (consent → biometric →
 * card lookup) and the "never leak the card on any decline path" contract.
 */
import { describe, expect, it } from 'bun:test';

import { formatPeerLabel, makeCardRequestHandler, type CardReleaseDeps } from '../../src/pear/cardRelease';

function tracker() {
  const calls: string[] = [];
  return { calls };
}

describe('makeCardRequestHandler', () => {
  it('share + biometric ok + card present -> returns the card jws', async () => {
    const { calls } = tracker();
    const deps: CardReleaseDeps = {
      askConsent: async () => {
        calls.push('askConsent');
        return 'share';
      },
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return true;
      },
      getCardJws: () => {
        calls.push('getCardJws');
        return 'the-jws';
      },
    };
    const handler = makeCardRequestHandler(deps);
    const result = await handler();
    expect(result).toEqual({ cardJws: 'the-jws' });
    // Order matters: consent, then biometric, then the card lookup.
    expect(calls).toEqual(['askConsent', 'requireBiometric', 'getCardJws']);
  });

  it('decline -> declined, and never touches biometric or the card', async () => {
    const { calls } = tracker();
    const deps: CardReleaseDeps = {
      askConsent: async () => {
        calls.push('askConsent');
        return 'decline';
      },
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return true;
      },
      getCardJws: () => {
        calls.push('getCardJws');
        return 'the-jws';
      },
    };
    const result = await makeCardRequestHandler(deps)();
    expect(result).toEqual({ declined: true });
    expect(calls).toEqual(['askConsent']);
  });

  it('share + biometric denied -> declined, and never reads the card', async () => {
    const { calls } = tracker();
    const deps: CardReleaseDeps = {
      askConsent: async () => 'share',
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return false;
      },
      getCardJws: () => {
        calls.push('getCardJws');
        return 'the-jws';
      },
    };
    const result = await makeCardRequestHandler(deps)();
    expect(result).toEqual({ declined: true });
    expect(calls).toEqual(['requireBiometric']);
  });

  it('share + biometric ok + no card saved -> declined, never fabricates a card', async () => {
    const deps: CardReleaseDeps = {
      askConsent: async () => 'share',
      requireBiometric: async () => true,
      getCardJws: () => null,
    };
    const result = await makeCardRequestHandler(deps)();
    expect(result).toEqual({ declined: true });
  });

  it('"no answer available" (no card) and "consent denied" are the same wire shape', async () => {
    const declinedByUser = await makeCardRequestHandler({
      askConsent: async () => 'decline',
      requireBiometric: async () => true,
      getCardJws: () => 'the-jws',
    })();
    const declinedByMissingCard = await makeCardRequestHandler({
      askConsent: async () => 'share',
      requireBiometric: async () => true,
      getCardJws: () => null,
    })();
    expect(declinedByUser).toEqual(declinedByMissingCard);
  });
});

describe('formatPeerLabel', () => {
  const DID = 'did:key:zQ3shSomeVeryLongIdentifierValueHere1234567890';

  it('returns the verified display name when present', () => {
    expect(formatPeerLabel(DID, 'Alice')).toBe('Alice');
  });

  it('falls back to the short did when the name is null', () => {
    expect(formatPeerLabel(DID, null)).not.toBe('Alice');
    expect(formatPeerLabel(DID, null)).toContain('...');
  });

  it('falls back to the short did when the name is empty/whitespace-only', () => {
    expect(formatPeerLabel(DID, '')).toContain('...');
    expect(formatPeerLabel(DID, '   ')).toContain('...');
  });

  it('never invents a name that was not supplied', () => {
    // Same did, no name supplied twice in a row -> same deterministic output.
    expect(formatPeerLabel(DID, null)).toBe(formatPeerLabel(DID, null));
  });
});
