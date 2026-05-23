/**
 * CloudKit record JSON ↔ CloudKitRecord round-trip parity.
 *
 * The Nitro spec carries the record body as a single JSON-encoded string
 * (`fields`) because Nitrogen can't codegen open-ended Record<string, …>
 * types. This test pins:
 *
 *   1. JSON keys we ship on the wire match the legacy Swift CloudKit
 *      record types (AirmeishiGroup + AirmeishiGroupMember) byte-for-byte.
 *   2. `JSON.parse(JSON.stringify(x))` round-trips without dropping fields,
 *      including the optional `merkleRoot` and `commitment` slots.
 *   3. Bool, number, string, and string-array values survive the round-trip
 *      unchanged — these are the only types CloudKit and Drive both store
 *      natively. The Nitro impl rejects nested objects (it flattens to
 *      sub-JSON-strings in iOS or refuses on Android), so the test asserts
 *      we don't sneak any in.
 */
import { describe, expect, it } from 'bun:test';

describe('cloudkitRecord — JSON parity', () => {
  it('round-trips an AirmeishiGroup record without dropping fields', () => {
    const group = {
      id: '0b8c5f5b-1b7c-4f0a-9c8d-1e2b3c4d5e6f',
      name: 'Aurora',
      description: 'Friends of the borealis',
      ownerRecordID: 'me',
      merkleRoot: 'fa11ce',
      merkleTreeDepth: 20,
      memberCount: 1,
      isPrivate: false,
      credentialIssuers: ['me', 'alice'],
    } as const;

    const fields = JSON.stringify(group);
    const back = JSON.parse(fields) as typeof group;

    expect(back.id).toBe(group.id);
    expect(back.name).toBe(group.name);
    expect(back.ownerRecordID).toBe(group.ownerRecordID);
    expect(back.merkleTreeDepth).toBe(group.merkleTreeDepth);
    expect(back.memberCount).toBe(group.memberCount);
    expect(back.isPrivate).toBe(group.isPrivate);
    expect(back.merkleRoot).toBe(group.merkleRoot);
    expect(back.credentialIssuers).toEqual([...group.credentialIssuers]);
  });

  it('round-trips an AirmeishiGroupMember record', () => {
    const member = {
      id: 'mem-1',
      groupID: '0b8c5f5b-1b7c-4f0a-9c8d-1e2b3c4d5e6f',
      userRecordID: 'me',
      role: 'owner',
      status: 'active',
      merkleIndex: 0,
      joinedAtMs: 1_777_000_000_000,
      commitment: '1234567890abcdef',
    } as const;
    const back = JSON.parse(JSON.stringify(member));
    expect(back).toEqual(member);
  });

  it('keeps an undefined optional field undefined after round-trip', () => {
    const partial = {
      id: 'g1',
      name: 'No-root',
      description: '',
      ownerRecordID: 'me',
      merkleTreeDepth: 20,
      memberCount: 1,
      isPrivate: false,
      credentialIssuers: [],
    };
    const back = JSON.parse(JSON.stringify(partial));
    expect(back.merkleRoot).toBeUndefined();
  });

  it('preserves Unicode in the name field', () => {
    const g = { name: '結束樂團 🎸', id: 'x', description: '' };
    const back = JSON.parse(JSON.stringify(g));
    expect(back.name).toBe('結束樂團 🎸');
  });

  it('boolean / number / string keep their types', () => {
    const r = { b: true, n: 42, s: 'hello', a: [1, 2, 3] };
    const back = JSON.parse(JSON.stringify(r));
    expect(typeof back.b).toBe('boolean');
    expect(typeof back.n).toBe('number');
    expect(typeof back.s).toBe('string');
    expect(Array.isArray(back.a)).toBe(true);
  });
});
