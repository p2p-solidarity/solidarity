/**
 * Group store — local mirror of CloudKitGroupSyncManager + LocalCacheManager.
 *
 * Mirrors apps/expo/src/groups/store.ts. Swift reference:
 *   solidarity/Models/GroupEntities.swift               (SwiftData GroupEntity / MemberEntity)
 *   solidarity/Models/CloudKitGroupModels.swift          (GroupModel / GroupMemberModel)
 *   solidarity/Services/CloudKit/CloudKitGroupSyncManager+MemberData.swift
 *     (canIssueCredentials, addCredentialIssuer, kickMember semantics)
 *
 * The TS store has add/remove via upsertGroup / deleteGroup / upsertMember,
 * and exposes derived hooks (isOwner, canIssueCredentials). Tests:
 *   - upsertGroup writes to MMKV + memory, exposes through `groups` Map
 *   - deleteGroup drops from memory
 *   - upsertMember appends a NEW member to the bucket
 *   - upsertMember replaces an existing member (same id) instead of duplicating
 *   - kick via upsertMember(status:'kicked') reflects in the bucket
 *   - canIssueCredentials respects owner + credentialIssuers list
 *   - isOwner only true for the local "me" record id
 *   - hydrate rebuilds groups + members from MMKV
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

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
    decryptJson: async <T,>(s: string): Promise<T> => JSON.parse(s) as T,
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

function makeGroup(overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    id: 'g-1',
    name: 'Aurora',
    description: 'A test group',
    ownerRecordID: mod.CURRENT_USER_RECORD_ID,
    merkleRoot: undefined,
    merkleTreeDepth: 20,
    memberCount: 1,
    isPrivate: false,
    isSynced: true,
    credentialIssuers: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    id: 'm-1',
    groupID: 'g-1',
    userRecordID: 'u-bob',
    role: 'member',
    status: 'active',
    merkleIndex: 1,
    joinedAt: new Date('2025-01-01T00:00:00Z'),
    sealedRoute: undefined,
    pubKey: undefined,
    signPubKey: undefined,
    commitment: undefined,
    ...overrides,
  };
}

describe('groupStore.upsertGroup', () => {
  it('assigns the group to the in-memory map by id', async () => {
    const g = makeGroup();
    await mod.useGroupStore.getState().upsertGroup(g);
    const got = mod.useGroupStore.getState().groups.get('g-1');
    expect(got?.name).toBe('Aurora');
  });

  it('preserves the credentialIssuers list across the upsert', async () => {
    const g = makeGroup({ credentialIssuers: ['u-bob', 'u-alice'] });
    await mod.useGroupStore.getState().upsertGroup(g);
    const got = mod.useGroupStore.getState().groups.get('g-1');
    expect(Array.from(got?.credentialIssuers ?? [])).toEqual(['u-bob', 'u-alice']);
  });

  it('toggle of group VC issuance persists (add then remove an issuer)', async () => {
    await mod.useGroupStore.getState().upsertGroup(makeGroup({ credentialIssuers: ['u-bob'] }));
    const before = mod.useGroupStore.getState().groups.get('g-1');
    expect(before?.credentialIssuers).toEqual(['u-bob']);
    // Mirrors Swift CloudKitGroupSyncManager+MemberData.removeCredentialIssuer.
    await mod.useGroupStore.getState().upsertGroup(makeGroup({ credentialIssuers: [] }));
    const after = mod.useGroupStore.getState().groups.get('g-1');
    expect(after?.credentialIssuers).toEqual([]);
  });

  it('persists into MMKV under the group: prefix', async () => {
    await mod.useGroupStore.getState().upsertGroup(makeGroup());
    expect(kv.has('group:g-1')).toBe(true);
  });
});

describe('groupStore.deleteGroup', () => {
  it('removes the group from memory + MMKV', async () => {
    await mod.useGroupStore.getState().upsertGroup(makeGroup());
    await mod.useGroupStore.getState().deleteGroup('g-1');
    expect(mod.useGroupStore.getState().groups.has('g-1')).toBe(false);
    expect(kv.has('group:g-1')).toBe(false);
  });
});

describe('groupStore.upsertMember', () => {
  it('add member appends to the membership list for the group', async () => {
    const m = makeMember();
    await mod.useGroupStore.getState().upsertMember(m);
    const list = mod.useGroupStore.getState().members.get('g-1') ?? [];
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('m-1');
  });

  it('two distinct members append cleanly (no replace)', async () => {
    await mod.useGroupStore.getState().upsertMember(makeMember({ id: 'm-1' }));
    await mod.useGroupStore.getState().upsertMember(makeMember({ id: 'm-2', userRecordID: 'u-eve' }));
    const list = mod.useGroupStore.getState().members.get('g-1') ?? [];
    expect(list.length).toBe(2);
    expect(list.map((x) => x.id).sort()).toEqual(['m-1', 'm-2']);
  });

  it('upsert with same id replaces the existing entry (mirrors CloudKit modify)', async () => {
    await mod.useGroupStore.getState().upsertMember(makeMember({ status: 'active' }));
    await mod.useGroupStore.getState().upsertMember(makeMember({ status: 'kicked' }));
    const list = mod.useGroupStore.getState().members.get('g-1') ?? [];
    expect(list.length).toBe(1);
    expect(list[0]?.status).toBe('kicked');
  });

  it('"remove member" = upsert with status:kicked (Swift kickMember parity)', async () => {
    await mod.useGroupStore.getState().upsertMember(makeMember());
    await mod.useGroupStore.getState().upsertMember(makeMember({ status: 'kicked' }));
    const list = mod.useGroupStore.getState().members.get('g-1') ?? [];
    expect(list.length).toBe(1);
    expect(list[0]?.status).toBe('kicked');
  });
});

describe('groupStore.canIssueCredentials / isOwner', () => {
  it('owner of the group can issue credentials', () => {
    const g = makeGroup({ ownerRecordID: mod.CURRENT_USER_RECORD_ID });
    expect(mod.isOwner(g)).toBe(true);
    expect(mod.canIssueCredentials(g)).toBe(true);
  });

  it('non-owner not in credentialIssuers cannot issue', () => {
    const g = makeGroup({ ownerRecordID: 'someone-else' });
    expect(mod.isOwner(g)).toBe(false);
    expect(mod.canIssueCredentials(g)).toBe(false);
  });

  it('non-owner LISTED in credentialIssuers can issue', () => {
    const g = makeGroup({
      ownerRecordID: 'someone-else',
      credentialIssuers: [mod.CURRENT_USER_RECORD_ID],
    });
    expect(mod.isOwner(g)).toBe(false);
    expect(mod.canIssueCredentials(g)).toBe(true);
  });
});

describe('groupStore.hydrate', () => {
  it('rebuilds groups + members from MMKV after add()', async () => {
    await mod.useGroupStore.getState().upsertGroup(makeGroup());
    await mod.useGroupStore.getState().upsertMember(makeMember());
    // Reset in-memory state but keep KV; force a hydrate.
    mod.useGroupStore.setState({
      groups: new Map(),
      members: new Map(),
      hydrated: false,
    });
    await mod.useGroupStore.getState().hydrate();
    expect(mod.useGroupStore.getState().groups.size).toBe(1);
    expect(mod.useGroupStore.getState().members.get('g-1')?.length).toBe(1);
  });

  it('is gated by `hydrated` — a second call is a no-op', async () => {
    mod.useGroupStore.setState({ hydrated: true });
    kv.set('group:g-X', JSON.stringify(makeGroup({ id: 'g-X' })));
    await mod.useGroupStore.getState().hydrate();
    expect(mod.useGroupStore.getState().groups.has('g-X')).toBe(false);
  });
});

describe('CURRENT_USER_RECORD_ID', () => {
  it('is the literal "me" until backup-provider identity wires up', () => {
    // Swift uses CKContainer.default().userRecordID; on Expo we don't have
    // CloudKit on Android, so the locally-created owner is the literal "me".
    // Mirror this in the store so screens compare against one place.
    expect(mod.CURRENT_USER_RECORD_ID).toBe('me');
  });
});
