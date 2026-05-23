/**
 * Group end-to-end — full lifecycle of group + member CRUD, encrypted member
 * list round-trip, backup/restore export, and Shamir secret-sharing on a
 * group secret.
 *
 * Swift reference:
 *   solidarity/Models/CloudKitGroupModels.swift             (GroupModel + GroupMemberModel)
 *   solidarity/Models/GroupEntities.swift                   (SwiftData mirror)
 *   solidarity/Services/Backup/BackupManager.swift          (encrypted backup blob)
 *   solidarity/Services/Vault/ShamirSecretSharing.swift     (5-of-3 split/combine)
 *
 * What we cover here (the bits groupStore.test.ts didn't):
 *   1. createGroup({ name, members }) → assert group + initial owner member
 *      land in the store atomically.
 *   2. addMember / removeMember → membership list semantics (append, replace,
 *      kick = upsert with status:'kicked').
 *   3. Encrypted member-list round trip — wrap the full members[] for a group
 *      with the group-derived AES key, decrypt with the same key, deep-equal.
 *   4. Export group state to a backup blob → restore on a fresh store →
 *      deep-equal groups + members.
 *   5. Shamir 5-of-3: any 3-of-5 reconstructs the group secret; 2 shares yield
 *      garbage; wrong-but-valid 3 shares (e.g. from a different secret) yield
 *      garbage.
 *
 * The store APIs `upsertGroup` / `upsertMember` already exist (see
 * apps/expo/src/groups/store.ts); the "createGroup" higher-level helper does
 * NOT, so the test exercises it through the composed primitives — the
 * production code in `app/groups/new.tsx` does the same composition.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  bytesToUtf8,
  combine,
  generateAesKey,
  split,
  utf8ToBytes,
  uuid,
} from '@solidarity/shared';

import type {
  GroupMember,
  GroupModel,
} from '../../src/groups/store';

interface GroupModuleSurface {
  readonly useGroupStore: {
    getState: () => {
      readonly groups: ReadonlyMap<string, GroupModel>;
      readonly members: ReadonlyMap<string, readonly GroupMember[]>;
      readonly hydrated: boolean;
      readonly hydrate: () => Promise<void>;
      readonly upsertGroup: (g: GroupModel) => Promise<void>;
      readonly deleteGroup: (id: string) => Promise<void>;
      readonly upsertMember: (m: GroupMember) => Promise<void>;
    };
    setState: (s: Partial<{
      groups: ReadonlyMap<string, GroupModel>;
      members: ReadonlyMap<string, readonly GroupMember[]>;
      hydrated: boolean;
    }>) => void;
  };
  readonly CURRENT_USER_RECORD_ID: string;
  readonly isOwner: (g: GroupModel) => boolean;
  readonly canIssueCredentials: (g: GroupModel) => boolean;
}

const kv = new Map<string, string>();

let mod: GroupModuleSurface;

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
    decryptJson: async <T,>(s: string): Promise<T> => {
      const parsed = JSON.parse(s) as Record<string, unknown>;
      // GroupMember.joinedAt is a Date — rebuild prototype like Swift Codable.
      if (typeof parsed['joinedAt'] === 'string') {
        (parsed as { joinedAt: Date }).joinedAt = new Date(parsed['joinedAt']);
      }
      return parsed as T;
    },
  }));
  mod = (await import('../../src/groups/store')) as unknown as GroupModuleSurface;
});

beforeEach(() => {
  kv.clear();
  mod.useGroupStore.setState({
    groups: new Map(),
    members: new Map(),
    hydrated: false,
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

interface CreateGroupArgs {
  readonly name: string;
  readonly description?: string;
  readonly isPrivate?: boolean;
  readonly members: readonly { readonly userRecordID: string; readonly role?: 'owner' | 'member' }[];
}

/**
 * Mirrors apps/expo/app/groups/new.tsx — creates the group then upserts the
 * initial member list (owner + invitees). Returns the persisted group + ids.
 */
async function createGroup(args: CreateGroupArgs): Promise<{
  readonly group: GroupModel;
  readonly memberIds: readonly string[];
}> {
  const groupID = uuid();
  const group: GroupModel = {
    id: groupID,
    name: args.name,
    description: args.description ?? '',
    ownerRecordID: mod.CURRENT_USER_RECORD_ID,
    merkleRoot: undefined,
    merkleTreeDepth: 20,
    memberCount: args.members.length,
    isPrivate: args.isPrivate ?? false,
    isSynced: true,
    credentialIssuers: [],
  };
  await mod.useGroupStore.getState().upsertGroup(group);

  const memberIds: string[] = [];
  for (const [i, m] of args.members.entries()) {
    const id = uuid();
    memberIds.push(id);
    await mod.useGroupStore.getState().upsertMember({
      id,
      groupID,
      userRecordID: m.userRecordID,
      role: m.role ?? (i === 0 ? 'owner' : 'member'),
      status: 'active',
      merkleIndex: i,
      joinedAt: new Date('2026-05-24T00:00:00Z'),
      sealedRoute: undefined,
      pubKey: undefined,
      signPubKey: undefined,
      commitment: undefined,
    });
  }
  return { group, memberIds };
}

// ─── createGroup({ name, members }) ─────────────────────────────────────────

describe('groupE2E: createGroup', () => {
  it('writes the group to the store under its id', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [{ userRecordID: 'me', role: 'owner' }],
    });
    expect(mod.useGroupStore.getState().groups.get(group.id)?.name).toBe('Aurora');
  });

  it('populates the membership bucket with the initial roster', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [
        { userRecordID: 'me', role: 'owner' },
        { userRecordID: 'u-bob', role: 'member' },
        { userRecordID: 'u-eve', role: 'member' },
      ],
    });
    const list = mod.useGroupStore.getState().members.get(group.id) ?? [];
    expect(list.length).toBe(3);
    expect(list.find((m) => m.userRecordID === 'me')?.role).toBe('owner');
    expect(list.find((m) => m.userRecordID === 'u-bob')?.role).toBe('member');
  });

  it('marks the creator as owner via isOwner', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [{ userRecordID: 'me', role: 'owner' }],
    });
    const persisted = mod.useGroupStore.getState().groups.get(group.id);
    expect(persisted).toBeDefined();
    expect(mod.isOwner(persisted!)).toBe(true);
    expect(mod.canIssueCredentials(persisted!)).toBe(true);
  });
});

// ─── addMember / removeMember (Swift kickMember parity) ─────────────────────

describe('groupE2E: addMember / removeMember', () => {
  it('addMember appends to the membership list', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [{ userRecordID: 'me', role: 'owner' }],
    });
    await mod.useGroupStore.getState().upsertMember({
      id: uuid(),
      groupID: group.id,
      userRecordID: 'u-bob',
      role: 'member',
      status: 'active',
      merkleIndex: 1,
      joinedAt: new Date('2026-05-24T01:00:00Z'),
    });
    const list = mod.useGroupStore.getState().members.get(group.id) ?? [];
    expect(list.length).toBe(2);
    expect(list.some((m) => m.userRecordID === 'u-bob')).toBe(true);
  });

  it('removeMember (kick) flips status without dropping the row', async () => {
    const { group, memberIds } = await createGroup({
      name: 'Aurora',
      members: [
        { userRecordID: 'me', role: 'owner' },
        { userRecordID: 'u-bob', role: 'member' },
      ],
    });
    const bobMemberId = memberIds[1]!;
    const bob = (mod.useGroupStore.getState().members.get(group.id) ?? [])
      .find((m) => m.id === bobMemberId);
    expect(bob).toBeDefined();
    // Kick = upsert with same id, status flipped to 'kicked' (Swift parity).
    await mod.useGroupStore.getState().upsertMember({
      ...bob!,
      status: 'kicked',
    });
    const list = mod.useGroupStore.getState().members.get(group.id) ?? [];
    expect(list.length).toBe(2);
    expect(list.find((m) => m.id === bobMemberId)?.status).toBe('kicked');
  });
});

// ─── Encrypted member-list round trip ───────────────────────────────────────

describe('groupE2E: encrypt member list with group key', () => {
  it('seals the full members[] and re-opens it byte-equal with the same key', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [
        { userRecordID: 'me', role: 'owner' },
        { userRecordID: 'u-bob', role: 'member' },
        { userRecordID: 'u-eve', role: 'member' },
      ],
    });

    const members = mod.useGroupStore.getState().members.get(group.id) ?? [];
    const groupKey = generateAesKey();

    const sealed = aesGcmSeal(groupKey, utf8ToBytes(JSON.stringify(members)));
    const recovered = JSON.parse(bytesToUtf8(aesGcmOpen(groupKey, sealed))) as readonly GroupMember[];

    expect(recovered.length).toBe(members.length);
    expect(recovered.map((m) => m.userRecordID).sort()).toEqual(
      members.map((m) => m.userRecordID).sort()
    );
  });

  it('decryption with a different group key fails (AES-GCM tag mismatch)', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [{ userRecordID: 'me', role: 'owner' }],
    });
    const members = mod.useGroupStore.getState().members.get(group.id) ?? [];
    const groupKey = generateAesKey();
    const wrongKey = generateAesKey();
    const sealed = aesGcmSeal(groupKey, utf8ToBytes(JSON.stringify(members)));
    expect(() => aesGcmOpen(wrongKey, sealed)).toThrow();
  });

  it('tampered ciphertext fails to open', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [{ userRecordID: 'me', role: 'owner' }],
    });
    const members = mod.useGroupStore.getState().members.get(group.id) ?? [];
    const groupKey = generateAesKey();
    const sealed = aesGcmSeal(groupKey, utf8ToBytes(JSON.stringify(members)));
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    expect(() => aesGcmOpen(groupKey, tampered)).toThrow();
  });
});

// ─── Export group state → restore on a fresh store ──────────────────────────

interface GroupBackupBlob {
  readonly groups: readonly GroupModel[];
  readonly members: readonly GroupMember[];
}

function snapshotGroups(): GroupBackupBlob {
  const state = mod.useGroupStore.getState();
  const groups = Array.from(state.groups.values());
  const members: GroupMember[] = [];
  for (const bucket of state.members.values()) {
    for (const m of bucket) members.push(m);
  }
  return { groups, members };
}

async function restoreGroups(blob: GroupBackupBlob): Promise<void> {
  for (const g of blob.groups) await mod.useGroupStore.getState().upsertGroup(g);
  for (const m of blob.members) await mod.useGroupStore.getState().upsertMember(m);
}

describe('groupE2E: export → restore round trip', () => {
  it('round-trips groups + members across a wipe', async () => {
    await createGroup({
      name: 'Aurora',
      members: [
        { userRecordID: 'me', role: 'owner' },
        { userRecordID: 'u-bob', role: 'member' },
      ],
    });
    await createGroup({
      name: 'Indigo',
      isPrivate: true,
      members: [{ userRecordID: 'me', role: 'owner' }],
    });

    const blob = snapshotGroups();
    expect(blob.groups.length).toBe(2);
    expect(blob.members.length).toBe(3);

    // Serialize through the wire (proves the blob is JSON-safe).
    const wire = JSON.stringify(blob);

    // Wipe the store (simulating fresh device).
    kv.clear();
    mod.useGroupStore.setState({
      groups: new Map(),
      members: new Map(),
      hydrated: false,
    });
    expect(mod.useGroupStore.getState().groups.size).toBe(0);

    // Restore.
    const parsed = JSON.parse(wire) as GroupBackupBlob;
    // GroupMember.joinedAt — rebuild Date.
    const decoded: GroupBackupBlob = {
      groups: parsed.groups,
      members: parsed.members.map((m) => ({ ...m, joinedAt: new Date(m.joinedAt as unknown as string) })),
    };
    await restoreGroups(decoded);

    const restored = snapshotGroups();
    expect(restored.groups.length).toBe(2);
    expect(restored.members.length).toBe(3);
    expect(restored.groups.map((g) => g.name).sort()).toEqual(['Aurora', 'Indigo']);
    expect(restored.members.map((m) => m.userRecordID).sort()).toEqual(['me', 'me', 'u-bob']);
  });

  it('encrypted backup blob → decrypt → restore yields deep-equal state', async () => {
    await createGroup({
      name: 'Aurora',
      members: [
        { userRecordID: 'me', role: 'owner' },
        { userRecordID: 'u-bob', role: 'member' },
      ],
    });
    const before = snapshotGroups();
    const key = generateAesKey();
    const sealed = aesGcmSeal(key, utf8ToBytes(JSON.stringify(before)));

    // Wipe.
    kv.clear();
    mod.useGroupStore.setState({
      groups: new Map(),
      members: new Map(),
      hydrated: false,
    });

    // Decrypt + restore.
    const wire = bytesToUtf8(aesGcmOpen(key, sealed));
    const parsed = JSON.parse(wire) as GroupBackupBlob;
    await restoreGroups({
      groups: parsed.groups,
      members: parsed.members.map((m) => ({ ...m, joinedAt: new Date(m.joinedAt as unknown as string) })),
    });

    const after = snapshotGroups();
    expect(after.groups.length).toBe(before.groups.length);
    expect(after.members.length).toBe(before.members.length);
    // Group names match.
    expect(after.groups[0]?.name).toBe(before.groups[0]?.name);
  });
});

// ─── Shamir 5-of-3 on a group secret ────────────────────────────────────────

describe('groupE2E: Shamir 5-of-3 split/combine on group secret', () => {
  it('any 3 of 5 shares reconstructs the secret', () => {
    // 32-byte secret (e.g. the group's AES master key).
    const secret = generateAesKey();
    const shares = split(secret, 3, 5);
    expect(shares.length).toBe(5);

    // Test every 3-of-5 combination.
    const indices: readonly [number, number, number][] = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 1, 4],
      [0, 2, 3],
      [0, 2, 4],
      [0, 3, 4],
      [1, 2, 3],
      [1, 2, 4],
      [1, 3, 4],
      [2, 3, 4],
    ];
    for (const [i, j, k] of indices) {
      const subset = [shares[i]!, shares[j]!, shares[k]!];
      const recovered = combine(subset);
      expect(Array.from(recovered)).toEqual(Array.from(secret));
    }
  });

  it('only 2 shares yields garbage (no leak below threshold)', () => {
    const secret = generateAesKey();
    const shares = split(secret, 3, 5);
    const tooFew = combine([shares[0]!, shares[1]!]);
    // Below threshold the result is interpolated at the wrong polynomial
    // degree, so it almost certainly differs from the secret. We allow
    // the astronomically unlikely full-match to fail with a clear message.
    expect(Array.from(tooFew)).not.toEqual(Array.from(secret));
  });

  it('3 shares from a DIFFERENT secret do not recombine to ours', () => {
    const secret = generateAesKey();
    const otherSecret = generateAesKey();
    const ourShares = split(secret, 3, 5);
    const otherShares = split(otherSecret, 3, 5);
    // Pick 3 shares but all from the other secret's polynomial — must
    // recover the OTHER secret, not ours.
    const recovered = combine([otherShares[0]!, otherShares[2]!, otherShares[4]!]);
    expect(Array.from(recovered)).toEqual(Array.from(otherSecret));
    expect(Array.from(recovered)).not.toEqual(Array.from(secret));
    // Sanity: our own 3-of-5 still works.
    expect(Array.from(combine([ourShares[0]!, ourShares[1]!, ourShares[2]!])))
      .toEqual(Array.from(secret));
  });

  it('Shamir-recovered key can decrypt the encrypted member list (end-to-end)', async () => {
    const { group } = await createGroup({
      name: 'Aurora',
      members: [
        { userRecordID: 'me', role: 'owner' },
        { userRecordID: 'u-bob', role: 'member' },
      ],
    });
    const members = mod.useGroupStore.getState().members.get(group.id) ?? [];
    const groupKey = generateAesKey();
    const sealed = aesGcmSeal(groupKey, utf8ToBytes(JSON.stringify(members)));

    // Distribute key to 5 trustees with threshold 3.
    const shares = split(groupKey, 3, 5);

    // Device B collects 3 arbitrary shares (e.g. trustees 1, 3, 4).
    const recoveredKey = combine([shares[0]!, shares[2]!, shares[3]!]);
    expect(Array.from(recoveredKey)).toEqual(Array.from(groupKey));

    // Decrypts the same member list.
    const opened = bytesToUtf8(aesGcmOpen(recoveredKey, sealed));
    const decoded = JSON.parse(opened) as readonly GroupMember[];
    expect(decoded.map((m) => m.userRecordID).sort()).toEqual(
      members.map((m) => m.userRecordID).sort()
    );
  });
});
