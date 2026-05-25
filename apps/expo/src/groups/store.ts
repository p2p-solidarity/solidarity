/**
 * Groups store — zustand mirror of Swift CloudKitGroupSyncManager + LocalCacheManager.
 *
 * Local-first: groups + members live in MMKV (encrypted via storageManager).
 * Cloud sync (CloudKit on iOS, Drive on Android) happens via backup adapter
 * when the user opts in; the store doesn't talk to CloudKit directly.
 *
 * Mirrors Swift GroupModel + GroupMemberModel shapes from the agent
 * inventory (docs/migration/03-models-inventory.md).
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

export interface GroupModel {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownerRecordID: string;
  readonly merkleRoot?: string;
  readonly merkleTreeDepth: number;
  readonly memberCount: number;
  readonly isPrivate: boolean;
  readonly isSynced: boolean;
  readonly credentialIssuers: readonly string[];
}

export interface GroupMember {
  readonly id: string;
  readonly groupID: string;
  readonly userRecordID: string;
  readonly role: 'owner' | 'member';
  readonly status: 'active' | 'pending' | 'left' | 'kicked';
  readonly merkleIndex: number;
  readonly joinedAt: Date;
  readonly sealedRoute?: string;
  readonly pubKey?: string;
  readonly signPubKey?: string;
  readonly commitment?: string;
}

const GROUP_PREFIX = 'group:';
const MEMBER_PREFIX = 'member:';

async function setEncrypted<T>(key: string, value: T): Promise<void> {
  getMmkv().set(key, await encryptJson(value));
}

async function getEncrypted<T>(key: string): Promise<T | null> {
  const raw = getMmkv().getString(key);
  return raw ? await decryptJson<T>(raw) : null;
}

function listKeys(prefix: string): readonly string[] {
  return getMmkv()
    .getAllKeys()
    .filter((k) => k.startsWith(prefix));
}

interface GroupStoreState {
  readonly groups: ReadonlyMap<string, GroupModel>;
  readonly members: ReadonlyMap<string, readonly GroupMember[]>;
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly upsertGroup: (g: GroupModel) => Promise<void>;
  readonly deleteGroup: (id: string) => Promise<void>;
  readonly upsertMember: (m: GroupMember) => Promise<void>;
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  groups: new Map(),
  members: new Map(),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const groups = new Map<string, GroupModel>();
    const members = new Map<string, GroupMember[]>();
    for (const k of listKeys(GROUP_PREFIX)) {
      const g = await getEncrypted<GroupModel>(k);
      if (g) groups.set(g.id, g);
    }
    for (const k of listKeys(MEMBER_PREFIX)) {
      const m = await getEncrypted<GroupMember>(k);
      if (!m) continue;
      const bucket = members.get(m.groupID) ?? [];
      bucket.push(m);
      members.set(m.groupID, bucket);
    }
    set({ groups, members, hydrated: true });
  },

  upsertGroup: async (g) => {
    await setEncrypted(`${GROUP_PREFIX}${g.id}`, g);
    set((s) => {
      const next = new Map(s.groups);
      next.set(g.id, g);
      return { groups: next };
    });
  },

  deleteGroup: async (id) => {
    getMmkv().remove(`${GROUP_PREFIX}${id}`);
    set((s) => {
      const next = new Map(s.groups);
      next.delete(id);
      return { groups: next };
    });
  },

  upsertMember: async (m) => {
    await setEncrypted(`${MEMBER_PREFIX}${m.id}`, m);
    set((s) => {
      const next = new Map(s.members);
      const bucket = (next.get(m.groupID) ?? []).filter((x) => x.id !== m.id);
      next.set(m.groupID, [...bucket, m]);
      return { members: next };
    });
  },
}));

export const useGroup = (id: string | undefined): GroupModel | undefined =>
  useGroupStore((s) => (id ? s.groups.get(id) : undefined));

export const useGroupMembers = (id: string | undefined): readonly GroupMember[] =>
  useGroupStore((s) => (id ? (s.members.get(id) ?? []) : []));

/**
 * Local-only "current user" record id. The Swift app reads
 * `CKContainer.default().userRecordID`; on the Expo port we don't have
 * CloudKit, so the owner of any locally-created group is the literal
 * string `"me"` (see `apps/expo/app/groups/new.tsx`). Keeping the
 * constant here means screens compare against one place and the
 * future CloudKit / Drive sync layer can swap the implementation.
 *
 * TODO(android): wire to backup-provider identity when CloudKitGroupSync
 * Manager / Drive equivalent lands.
 */
export const CURRENT_USER_RECORD_ID = 'me';

/**
 * All groups (insertion order).
 *
 * `useShallow` is required for any selector that derives a fresh array from
 * the underlying `ReadonlyMap`. Without it the new reference returned each
 * render trips Zustand v5's `useSyncExternalStore` cache and React loops on
 * "Maximum update depth exceeded".
 */
export const useAllGroups = (): readonly GroupModel[] =>
  useGroupStore(useShallow((s) => Array.from(s.groups.values())));

/** Public (non-private) groups. Mirrors Swift YourGroupsSectionView.publicGroups. */
export const usePublicGroups = (): readonly GroupModel[] =>
  useGroupStore(
    useShallow((s) =>
      Array.from(s.groups.values()).filter((g) => !g.isPrivate)
    )
  );

/** Private groups owned by the current user. */
export const usePrivateOwnedGroups = (): readonly GroupModel[] =>
  useGroupStore(
    useShallow((s) =>
      Array.from(s.groups.values()).filter(
        (g) => g.isPrivate && g.ownerRecordID === CURRENT_USER_RECORD_ID
      )
    )
  );

/** Private groups shared with the current user. */
export const usePrivateSharedGroups = (): readonly GroupModel[] =>
  useGroupStore(
    useShallow((s) =>
      Array.from(s.groups.values()).filter(
        (g) => g.isPrivate && g.ownerRecordID !== CURRENT_USER_RECORD_ID
      )
    )
  );

/** True if the current user owns the given group. */
export function isOwner(group: GroupModel): boolean {
  return group.ownerRecordID === CURRENT_USER_RECORD_ID;
}

/** True if the current user is allowed to issue group VCs. */
export function canIssueCredentials(group: GroupModel): boolean {
  return (
    isOwner(group) ||
    group.credentialIssuers.includes(CURRENT_USER_RECORD_ID)
  );
}
