/**
 * NIP-01 event primitives (src/nostr/event.ts): the id commits to the exact
 * `[0, pubkey, created_at, kind, tags, content]` serialisation, signatures are
 * BIP-340 over the id, and every tamper is caught by `verifyNostrEvent`.
 */
import { describe, expect, it } from 'bun:test';

import { sha256Bytes } from '../src/crypto/hash';
import { bytesToHex, hexToBytes } from '../src/crypto/hex';
import {
  computeNip01EventId,
  isNostrEvent,
  nostrPublicKeyHex,
  serializeNip01Event,
  signNostrEventWithScalar,
  verifyNostrEvent,
  type NostrEvent,
} from '../src/nostr/event';

const SCALAR = hexToBytes('11'.repeat(32));
const OTHER_SCALAR = hexToBytes('22'.repeat(32));

const unsigned = {
  kind: 30078,
  tags: [['d', 'solidarity.profile']],
  content: 'header.payload.signature',
  created_at: 1_700_000_000,
};

describe('signNostrEventWithScalar / verifyNostrEvent', () => {
  it('produces a verifiable event whose id is the sha256 of the NIP-01 serialisation', () => {
    const signed = signNostrEventWithScalar(unsigned, SCALAR);
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const event = signed.value;
    expect(event.pubkey).toBe(nostrPublicKeyHex(SCALAR));
    expect(event.pubkey).toHaveLength(64);
    expect(event.created_at).toBe(1_700_000_000);
    const serialized = JSON.stringify([0, event.pubkey, 1_700_000_000, 30078, [['d', 'solidarity.profile']], 'header.payload.signature']);
    expect(serializeNip01Event(event)).toBe(serialized);
    expect(event.id).toBe(bytesToHex(sha256Bytes(new TextEncoder().encode(serialized))));
    expect(computeNip01EventId(event)).toBe(event.id);
    expect(verifyNostrEvent(event)).toBe(true);
  });

  it('stamps created_at from the injected clock when the caller omits it', () => {
    const signed = signNostrEventWithScalar({ kind: 0, tags: [], content: '{}' }, SCALAR, 1_800_000_000);
    expect(signed.ok && signed.value.created_at).toBe(1_800_000_000);
  });

  it('rejects any tampering: content, tags, pubkey, id, or a foreign signature', () => {
    const signed = signNostrEventWithScalar(unsigned, SCALAR);
    if (!signed.ok) throw new Error('sign failed');
    const event = signed.value;
    expect(verifyNostrEvent({ ...event, content: 'other' })).toBe(false);
    expect(verifyNostrEvent({ ...event, tags: [] })).toBe(false);
    expect(verifyNostrEvent({ ...event, pubkey: nostrPublicKeyHex(OTHER_SCALAR) })).toBe(false);
    expect(verifyNostrEvent({ ...event, id: 'ab'.repeat(32) })).toBe(false);
    const foreign = signNostrEventWithScalar(unsigned, OTHER_SCALAR);
    if (!foreign.ok) throw new Error('foreign sign failed');
    expect(verifyNostrEvent({ ...event, sig: foreign.value.sig })).toBe(false);
    expect(verifyNostrEvent({ ...event, sig: 'zz' })).toBe(false);
  });

  it('reports an invalid scalar as err, never a throw', () => {
    expect(signNostrEventWithScalar(unsigned, new Uint8Array(32)).ok).toBe(false);
    expect(signNostrEventWithScalar(unsigned, new Uint8Array(31)).ok).toBe(false);
  });
});

describe('isNostrEvent', () => {
  it('accepts the wire shape and rejects anything else', () => {
    const signed = signNostrEventWithScalar(unsigned, SCALAR);
    if (!signed.ok) throw new Error('sign failed');
    const event: NostrEvent = signed.value;
    expect(isNostrEvent(event)).toBe(true);
    expect(isNostrEvent({ ...event, tags: [['d', 1]] })).toBe(false);
    expect(isNostrEvent({ ...event, sig: undefined })).toBe(false);
    expect(isNostrEvent(null)).toBe(false);
    expect(isNostrEvent('event')).toBe(false);
  });
});
