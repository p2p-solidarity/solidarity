/**
 * Groups store — zustand mirror of Swift CloudKitGroupSyncManager +
 * LocalCacheManager. Local-first: groups + members live in MMKV (encrypted
 * via storageManager). Cloud sync (CloudKit on iOS, Drive on Android)
 * happens via the backup adapter when the user opts in; the store doesn't
 * talk to CloudKit directly.
 *
 * Mirrors Swift GroupModel + GroupMemberModel shapes from the agent
 * inventory (docs/migration/03-models-inventory.md).
 *
 * Boot model (Path A — manifest + lazy details):
 *
 *   Frame 1   `manifest`  populated synchronously from MMKV via
 *             `seedFromManifest()`. Holds non-sensitive display fields
 *             only — id, name, description, memberCount, isPrivate. List
 *             screens can render the group picker without decrypting any
 *             record.
 *
 *   After     `groups`    ReadonlyMap<id, GroupModel> populated lazily.
 *             `loadDetail(id)` decrypts a single record; `hydrate()` bulk-
 *             decrypts every group + member in the background. Screens
 *             that filter on ownerRecordID / credentialIssuers / merkleRoot
 *             read from `groups`.
 *
 *   Members   `members`   bulk-loaded inside `hydrate()`. Members are tied
 *             to a group's detail view (kick/approve, merkle-tree section,
 *             VC issuance) and are never rendered on screens that don't
 *             also need the full GroupModel — so there is no separate
 *             member manifest. Detail screens trigger `hydrate()` on
 *             mount; the call is idempotent.
 *
 *   Writes    `upsertGroup(g)` persists the encrypted record + updates the
 *             manifest + warms the `groups` map in one atomic state
 *             update. `deleteGroup(id)` mirrors that across all three.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { ManifestStorage } from '@/storage/manifestStorage';
import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import {
  GROUPS_MANIFEST_SCOPE,
  toGroupManifest,
  type GroupManifestEntry,
} from './groupManifest';

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
let localWipeGeneration = 0;

async function setEncrypted<T>(
  key: string,
  value: T,
  writeEpoch: LocalDataEpoch,
): Promise<boolean> {
  if (!canCommitLocalData(writeEpoch)) return false;
  const encrypted = await encryptJson(value);
  if (!canCommitLocalData(writeEpoch)) return false;
  getMmkv().set(key, encrypted);
  return true;
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
  readonly manifest: readonly GroupManifestEntry[];
  readonly groups: ReadonlyMap<string, GroupModel>;
  readonly members: ReadonlyMap<string, readonly GroupMember[]>;
  readonly hydrated: boolean;
  /** Re-read the manifest from MMKV. Frame-1 safe; call after `initMmkv()`. */
  readonly seedFromManifest: () => void;
  /** Background bulk-decrypt of every group + member. Idempotent. */
  readonly hydrate: () => Promise<void>;
  /** Lazy single-record decrypt for detail screens. */
  readonly loadDetail: (id: string) => Promise<GroupModel | null>;
  readonly upsertGroup: (g: GroupModel) => Promise<void>;
  readonly deleteGroup: (id: string) => Promise<void>;
  readonly upsertMember: (m: GroupMember) => Promise<void>;
  /** Drop every live reference after the encrypted local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

export const useGroupStore = create<GroupStoreState>((set, get) => ({
  manifest: [],
  groups: new Map(),
  members: new Map(),
  hydrated: false,

  seedFromManifest: () => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    const seed = ManifestStorage.get<GroupManifestEntry>(GROUPS_MANIFEST_SCOPE);
    if (seed) set({ manifest: seed });
  },

  hydrate: async () => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    if (get().hydrated) return;
    const groups = new Map<string, GroupModel>();
    const members = new Map<string, GroupMember[]>();
    // Tolerant load — a single corrupt record must not wipe the whole list.
    for (const k of listKeys(GROUP_PREFIX)) {
      try {
        const g = await getEncrypted<GroupModel>(k);
        if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
        if (g) groups.set(g.id, g);
      } catch {
        // Skip the bad row; it'll be re-synced from cloud or rewritten on
        // the next user mutation.
      }
    }
    for (const k of listKeys(MEMBER_PREFIX)) {
      try {
        const m = await getEncrypted<GroupMember>(k);
        if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
        if (!m) continue;
        const bucket = members.get(m.groupID) ?? [];
        bucket.push(m);
        members.set(m.groupID, bucket);
      } catch {
        // Same tolerance as above — drop bad rows silently.
      }
    }
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    const manifest = Array.from(groups.values()).map(toGroupManifest);
    ManifestStorage.set(GROUPS_MANIFEST_SCOPE, manifest);
    set({ manifest, groups, members, hydrated: true });
  },

  loadDetail: async (id) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return null;
    const cached = get().groups.get(id);
    if (cached) return cached;
    try {
      const g = await getEncrypted<GroupModel>(`${GROUP_PREFIX}${id}`);
      if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return null;
      if (!g) return null;
      set((s) => {
        const next = new Map(s.groups);
        next.set(id, g);
        return { groups: next };
      });
      return g;
    } catch {
      return null;
    }
  },

  upsertGroup: async (g) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    if (!(await setEncrypted(`${GROUP_PREFIX}${g.id}`, g, writeEpoch))) return;
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    set((s) => {
      const nextGroups = new Map(s.groups);
      nextGroups.set(g.id, g);
      const entry = toGroupManifest(g);
      const idx = s.manifest.findIndex((m) => m.id === entry.id);
      const nextManifest = idx >= 0
        ? s.manifest.map((m, i) => (i === idx ? entry : m))
        : [...s.manifest, entry];
      ManifestStorage.set(GROUPS_MANIFEST_SCOPE, nextManifest);
      return { groups: nextGroups, manifest: nextManifest };
    });
  },

  deleteGroup: async (id) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    getMmkv().remove(`${GROUP_PREFIX}${id}`);
    set((s) => {
      const nextGroups = new Map(s.groups);
      nextGroups.delete(id);
      const nextManifest = s.manifest.filter((m) => m.id !== id);
      ManifestStorage.set(GROUPS_MANIFEST_SCOPE, nextManifest);
      return { groups: nextGroups, manifest: nextManifest };
    });
  },

  upsertMember: async (m) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    if (!(await setEncrypted(`${MEMBER_PREFIX}${m.id}`, m, writeEpoch))) return;
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    set((s) => {
      const next = new Map(s.members);
      const bucket = (next.get(m.groupID) ?? []).filter((x) => x.id !== m.id);
      next.set(m.groupID, [...bucket, m]);
      return { members: next };
    });
  },

  resetForLocalWipe: () => {
    localWipeGeneration += 1;
    set({ manifest: [], groups: new Map(), members: new Map(), hydrated: true });
  },
}));

export const useGroup = (id: string | undefined): GroupModel | undefined =>
  useGroupStore((s) => (id ? s.groups.get(id) : undefined));

// Stable empty fallback — a fresh `[]` literal in the selector trips Zustand
// v5's snapshot identity check and loops on "Maximum update depth exceeded",
// same as the `useShallow`-wrapped derivations below.
const EMPTY_MEMBERS: readonly GroupMember[] = Object.freeze([]);

export const useGroupMembers = (id: string | undefined): readonly GroupMember[] =>
  useGroupStore((s) => (id ? (s.members.get(id) ?? EMPTY_MEMBERS) : EMPTY_MEMBERS));

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
 *
 * Operates on the hydrated `groups` map — call `hydrate()` on mount if you
 * also need ownerRecordID / credentialIssuers (the filtering hooks below).
 * Frame-1 list rendering with just name + memberCount can use
 * `useGroupManifest()` instead, which reads the synchronous manifest.
 */
export const useAllGroups = (): readonly GroupModel[] =>
  useGroupStore(useShallow((s) => Array.from(s.groups.values())));

/**
 * Manifest-only view for list screens that just need name + memberCount +
 * isPrivate on frame 1 (no decrypt required). Filtering by ownership still
 * needs `useAllGroups` because `ownerRecordID` is intentionally not in the
 * manifest.
 */
export const useGroupManifest = (): readonly GroupManifestEntry[] =>
  useGroupStore((s) => s.manifest);

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

export type { GroupManifestEntry } from './groupManifest';
