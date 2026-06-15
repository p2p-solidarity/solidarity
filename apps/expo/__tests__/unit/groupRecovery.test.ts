/**
 * Group recovery (Shamir + AES-GCM) — end-to-end.
 *
 * Scenario: Device A holds a group's master AES key. It splits the key into
 * 5 shares (Shamir threshold 3) and ships one share to each of 5 trustees
 * (e.g. via Sakura sealed routes). Device A is then lost. On a fresh device
 * B, the user reaches out to 3 trustees, collects their shares, runs Shamir
 * `combine` to reconstruct the key, and uses it to decrypt the encrypted
 * member list (which they retrieved from the group's backup or shared cloud
 * file).
 *
 * Swift reference:
 *   solidarity/Services/Vault/ShamirSecretSharing.swift
 *   solidarity/Services/Vault/ShardDistributionService.swift
 *   solidarity/Services/Vault/ShardDistributionService+Recovery.swift
 *
 * TS port:
 *   packages/shared/src/vault/shamir.ts   (GF(256) SSS, mirrors Swift)
 *   packages/shared/src/crypto/aesGcm.ts  (AES-256-GCM, Swift CryptoKit wire)
 *
 * Failure modes covered:
 *   - 2 shares only → cannot reconstruct the key.
 *   - Wrong shares (3 from a DIFFERENT secret) → reconstructs the wrong key
 *     → AES-GCM auth tag fails.
 *   - Tampered share (one byte flipped) → reconstructed key is wrong → decrypt fails.
 *   - 3 valid shares from the correct group → reconstructs the key → decrypt
 *     yields the original member list byte-equal.
 */
import { describe, expect, it } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  bytesToHex,
  bytesToUtf8,
  combine,
  generateAesKey,
  split,
  utf8ToBytes,
  uuid,
  type ShamirShare,
} from '@solidarity/shared';

// ─── Shared fixtures ────────────────────────────────────────────────────────

interface MemberRecord {
  readonly id: string;
  readonly userRecordID: string;
  readonly role: 'owner' | 'member';
  readonly merkleIndex: number;
}

interface RecoverySetup {
  readonly groupKey: Uint8Array;
  readonly shares: readonly ShamirShare[];
  readonly sealedMemberList: Uint8Array;
  readonly originalMembers: readonly MemberRecord[];
}

function makeMembers(count: number): readonly MemberRecord[] {
  const out: MemberRecord[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: uuid(),
      userRecordID: `u-${String(i)}`,
      role: i === 0 ? 'owner' : 'member',
      merkleIndex: i,
    });
  }
  return out;
}

/**
 * Device A's side: generate a fresh group key, encrypt the member list,
 * split the key into 5-of-3 Shamir shares (one per trustee).
 */
function deviceASetup(members: readonly MemberRecord[]): RecoverySetup {
  const groupKey = generateAesKey();
  const memberListBytes = utf8ToBytes(JSON.stringify(members));
  const sealedMemberList = aesGcmSeal(groupKey, memberListBytes);
  const shares = split(groupKey, 3, 5);
  return { groupKey, shares, sealedMemberList, originalMembers: members };
}

/**
 * Device B's side: takes 3 trustee shares, reconstructs the key,
 * decrypts the encrypted member list.
 */
function deviceBRecover(
  threeShares: readonly ShamirShare[],
  sealedMemberList: Uint8Array,
): readonly MemberRecord[] {
  const recoveredKey = combine(threeShares);
  const opened = aesGcmOpen(recoveredKey, sealedMemberList);
  return JSON.parse(bytesToUtf8(opened)) as readonly MemberRecord[];
}

// ─── Happy paths ────────────────────────────────────────────────────────────

describe('groupRecovery: happy path — 3 of 5 trustees recover the group', () => {
  it('Device B with shares from trustees 1, 2, 3 reconstructs the member list', () => {
    const members = makeMembers(4);
    const setup = deviceASetup(members);
    const collected = [setup.shares[0]!, setup.shares[1]!, setup.shares[2]!];
    const recovered = deviceBRecover(collected, setup.sealedMemberList);

    expect(recovered.length).toBe(members.length);
    expect(recovered.map((m) => m.userRecordID)).toEqual(members.map((m) => m.userRecordID));
    expect(recovered[0]?.role).toBe('owner');
    expect(recovered.every((m, i) => m.merkleIndex === i)).toBe(true);
  });

  it('any 3-of-5 combination recovers the same member list', () => {
    const members = makeMembers(3);
    const setup = deviceASetup(members);
    const subsetsToTry: readonly (readonly [number, number, number])[] = [
      [0, 1, 2],
      [0, 1, 4],
      [1, 2, 3],
      [2, 3, 4],
      [0, 2, 4],
    ];
    for (const [i, j, k] of subsetsToTry) {
      const subset = [setup.shares[i]!, setup.shares[j]!, setup.shares[k]!];
      const recovered = deviceBRecover(subset, setup.sealedMemberList);
      expect(recovered.map((m) => m.userRecordID)).toEqual(members.map((m) => m.userRecordID));
    }
  });

  it('order of shares does not matter (Shamir is symmetric)', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    const forward = [setup.shares[0]!, setup.shares[2]!, setup.shares[4]!];
    const reverse = [setup.shares[4]!, setup.shares[2]!, setup.shares[0]!];
    const a = deviceBRecover(forward, setup.sealedMemberList);
    const b = deviceBRecover(reverse, setup.sealedMemberList);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('extra shares beyond threshold are tolerated (over-collected)', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    // All 5 shares present — still recovers the key.
    const all = [
      setup.shares[0]!,
      setup.shares[1]!,
      setup.shares[2]!,
      setup.shares[3]!,
      setup.shares[4]!,
    ];
    const recovered = deviceBRecover(all, setup.sealedMemberList);
    expect(recovered.map((m) => m.userRecordID)).toEqual(members.map((m) => m.userRecordID));
  });
});

// ─── Below-threshold attacks ────────────────────────────────────────────────

describe('groupRecovery: 2 shares only — must NOT decrypt', () => {
  it('combine() of 2 shares yields a key that fails AES-GCM auth', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    const twoShares = [setup.shares[0]!, setup.shares[1]!];
    // Naively call combine() — Shamir doesn't know the threshold, it just
    // interpolates at the wrong degree. The output is a 32-byte buffer that
    // is (with overwhelming probability) NOT the original key.
    const wrongKey = combine(twoShares);
    expect(bytesToHex(wrongKey)).not.toBe(bytesToHex(setup.groupKey));
    // AES-GCM tag verification rejects.
    expect(() => aesGcmOpen(wrongKey, setup.sealedMemberList)).toThrow();
  });

  it('1 share alone — same failure (AES-GCM auth tag mismatch)', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    const oneShare = [setup.shares[2]!];
    const wrongKey = combine(oneShare);
    expect(bytesToHex(wrongKey)).not.toBe(bytesToHex(setup.groupKey));
    expect(() => aesGcmOpen(wrongKey, setup.sealedMemberList)).toThrow();
  });
});

// ─── Wrong-secret attacks ───────────────────────────────────────────────────

describe('groupRecovery: wrong 3 shares — must NOT decrypt this group', () => {
  it('3 shares from a DIFFERENT group cannot decrypt this group\'s sealed list', () => {
    const ourMembers = makeMembers(3);
    const ourSetup = deviceASetup(ourMembers);

    // A different group with a different secret key.
    const otherMembers = makeMembers(3);
    const otherSetup = deviceASetup(otherMembers);

    // Take 3 shares from the OTHER group.
    const wrongShares = [otherSetup.shares[0]!, otherSetup.shares[1]!, otherSetup.shares[2]!];

    // These shares reconstruct the OTHER key, not ours.
    const recoveredKey = combine(wrongShares);
    expect(bytesToHex(recoveredKey)).toBe(bytesToHex(otherSetup.groupKey));
    expect(bytesToHex(recoveredKey)).not.toBe(bytesToHex(ourSetup.groupKey));

    // Therefore AES-GCM on OUR sealed list rejects (tag mismatch).
    expect(() => aesGcmOpen(recoveredKey, ourSetup.sealedMemberList)).toThrow();
  });

  it('mixed shares (2 ours + 1 theirs) reconstructs garbage, decrypt fails', () => {
    const ourMembers = makeMembers(2);
    const ourSetup = deviceASetup(ourMembers);
    const otherMembers = makeMembers(2);
    const otherSetup = deviceASetup(otherMembers);

    // Mix shares — interpolation runs through inconsistent polynomials.
    const mixed = [ourSetup.shares[0]!, ourSetup.shares[1]!, otherSetup.shares[2]!];
    const garbageKey = combine(mixed);
    expect(bytesToHex(garbageKey)).not.toBe(bytesToHex(ourSetup.groupKey));
    expect(() => aesGcmOpen(garbageKey, ourSetup.sealedMemberList)).toThrow();
  });
});

// ─── Tamper / corruption attacks ────────────────────────────────────────────

describe('groupRecovery: tampered share — must NOT decrypt', () => {
  it('flipping a single byte in one share breaks recovery', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    // Clone share[0] with one flipped byte.
    const original = setup.shares[0]!;
    const tampered: ShamirShare = {
      index: original.index,
      y: (() => {
        const next = new Uint8Array(original.y);
        next[5] = (next[5] ?? 0) ^ 0x01;
        return next;
      })(),
    };
    const recovered = combine([tampered, setup.shares[1]!, setup.shares[2]!]);
    expect(bytesToHex(recovered)).not.toBe(bytesToHex(setup.groupKey));
    expect(() => aesGcmOpen(recovered, setup.sealedMemberList)).toThrow();
  });

  it('tampered sealed member list (one ciphertext byte flipped) breaks decrypt', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    const validKey = combine([setup.shares[0]!, setup.shares[1]!, setup.shares[2]!]);
    expect(bytesToHex(validKey)).toBe(bytesToHex(setup.groupKey));

    // Flip a byte in the AES-GCM ciphertext (not the nonce, not the tag —
    // we want to ensure the tag catches it).
    const tampered = new Uint8Array(setup.sealedMemberList);
    // Position 20 is well inside the ciphertext region (after the 12-byte nonce).
    tampered[20] = (tampered[20] ?? 0) ^ 0x01;
    expect(() => aesGcmOpen(validKey, tampered)).toThrow();
  });

  it('tampered nonce also breaks decrypt', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    const validKey = combine([setup.shares[0]!, setup.shares[1]!, setup.shares[2]!]);
    const tampered = new Uint8Array(setup.sealedMemberList);
    // The first 12 bytes are the nonce; flip one.
    tampered[3] = (tampered[3] ?? 0) ^ 0x01;
    expect(() => aesGcmOpen(validKey, tampered)).toThrow();
  });
});

// ─── Realistic recovery flow (sealed routes hidden behind trustees) ────────

describe('groupRecovery: realistic device-A → trustees → device-B flow', () => {
  it('simulates the full lost-device flow with real crypto end-to-end', () => {
    // Device A: create group, encrypt member list, split key to 5 trustees.
    const aliceMembers = makeMembers(4);
    const aliceSetup = deviceASetup(aliceMembers);

    // Each trustee receives ONE share. They store it (in our model, in
    // Sakura sealed envelopes — but the test only needs the share bytes).
    const trustees: readonly ShamirShare[] = aliceSetup.shares;
    expect(trustees.length).toBe(5);

    // Device A is wiped. Sealed member list is recovered from the cloud
    // backup (would normally be downloaded from iCloud / Drive).
    const sealedListFromCloud = aliceSetup.sealedMemberList;

    // Device B reaches out to trustees 0, 2, 4 (skipping 1 and 3 because
    // those trustees are unreachable / out of the country).
    const collectedShares = [trustees[0]!, trustees[2]!, trustees[4]!];

    // Recover.
    const recoveredKey = combine(collectedShares);
    expect(bytesToHex(recoveredKey)).toBe(bytesToHex(aliceSetup.groupKey));

    // Decrypt the member list with the recovered key.
    const recoveredJson = bytesToUtf8(aesGcmOpen(recoveredKey, sealedListFromCloud));
    const recoveredMembers = JSON.parse(recoveredJson) as readonly MemberRecord[];

    // The recovered member list is byte-equal to the original.
    expect(recoveredMembers.length).toBe(aliceMembers.length);
    expect(recoveredMembers.map((m) => m.userRecordID))
      .toEqual(aliceMembers.map((m) => m.userRecordID));
    expect(recoveredMembers.map((m) => m.role))
      .toEqual(aliceMembers.map((m) => m.role));
    expect(recoveredMembers.map((m) => m.merkleIndex))
      .toEqual(aliceMembers.map((m) => m.merkleIndex));
  });

  it('Device B can re-encrypt the member list with the recovered key (rotation prep)', () => {
    const members = makeMembers(2);
    const setup = deviceASetup(members);
    const recoveredKey = combine([setup.shares[0]!, setup.shares[1]!, setup.shares[2]!]);

    // Recover the list, mutate it (e.g. add a new member), seal again.
    const list = JSON.parse(bytesToUtf8(aesGcmOpen(recoveredKey, setup.sealedMemberList))) as readonly MemberRecord[];
    const augmented: readonly MemberRecord[] = [
      ...list,
      { id: uuid(), userRecordID: 'u-new', role: 'member', merkleIndex: list.length },
    ];
    const newSealed = aesGcmSeal(recoveredKey, utf8ToBytes(JSON.stringify(augmented)));
    expect(newSealed).not.toEqual(setup.sealedMemberList);

    // Same key still opens it.
    const reopened = JSON.parse(bytesToUtf8(aesGcmOpen(recoveredKey, newSealed))) as readonly MemberRecord[];
    expect(reopened.length).toBe(list.length + 1);
    expect(reopened[reopened.length - 1]?.userRecordID).toBe('u-new');
  });
});
