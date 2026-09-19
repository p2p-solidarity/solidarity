/**
 * Parity between the app's own NIP-01 routines (`dag/node.ts`'s
 * `computeNip01EventId`, `dag/nostrAdapter.ts`'s `verifyNostrEvent`) and the
 * shared implementation the web builder signs with (`@solidarity/shared`
 * `nostr/event.ts`). The two must agree byte-for-byte on the id and accept
 * each other's signatures, or a page published from the web would not
 * resolve in the app (and vice versa).
 */
import { describe, expect, it } from 'bun:test';

import { computeNip01EventId as appEventId } from '../../src/dag/node';
import { verifyNostrEvent as appVerify } from '../../src/dag/nostrAdapter';
import {
  computeNip01EventId as sharedEventId,
  hexToBytes,
  signNostrEventWithScalar,
  verifyNostrEvent as sharedVerify,
} from '@solidarity/shared';

const SCALAR = hexToBytes('11'.repeat(32));

describe('NIP-01 parity: app ↔ shared', () => {
  it('computes the same event id for the same unsigned event', () => {
    const unsigned = {
      pubkey: 'ab'.repeat(32),
      created_at: 1_700_000_000,
      kind: 30078,
      tags: [['d', 'solidarity.profile']],
      content: 'header.payload.signature',
    };
    expect(appEventId(unsigned)).toBe(sharedEventId(unsigned));
  });

  it('an event signed by the shared signer verifies with the app verifier, and tampering fails both', () => {
    const signed = signNostrEventWithScalar(
      { kind: 0, tags: [], content: JSON.stringify({ name: 'Alice' }), created_at: 1_700_000_001 },
      SCALAR
    );
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(appVerify(signed.value)).toBe(true);
    expect(sharedVerify(signed.value)).toBe(true);
    const tampered = { ...signed.value, content: '{"name":"Mallory"}' };
    expect(appVerify(tampered)).toBe(false);
    expect(sharedVerify(tampered)).toBe(false);
  });
});
