/**
 * Cross-platform group sync — TS port of CloudKitGroupSyncManager*.swift.
 *
 * Backed by `@solidarity/nitro-cloudkit`, which on iOS hits real CloudKit
 * (CKShare, private/shared DB) and on Android hits Google Drive REST.
 *
 * High-level surface:
 *   - syncManager().createGroup({...})           → publishes a record + locally caches
 *   - syncManager().createInviteLink(group)      → CKShare URL on iOS, Drive webViewLink on Android
 *   - syncManager().joinGroup(urlOrToken)        → accepts the invite, pulls members
 *   - syncManager().pushGroup(group)             → re-syncs a locally-mutated group
 *   - syncManager().fetchAllGroups()             → refreshes local cache from cloud
 *
 * No raw CKContainer calls leak past this module. Components import
 * `syncManager()` and never touch `getCloudKit()` directly — keeps the
 * Nitro surface swap-able when we add platform-specific code paths.
 *
 * NOTE on platform parity: the Drive "shared zone" is *not* the same as
 * CKShare. Drive permissions grant per-user read/write on a single file
 * or folder; there's no concept of a cross-device synchronised zone with
 * incremental change tokens. We document the gaps here:
 *
 *   - Real-time push: iOS fires `recordSaved` from CKDatabaseSubscription;
 *     Drive has no listener channel inside the Nitro module's process, so
 *     events are only emitted on local writes. Callers should poll
 *     `fetchAllGroups()` on app foreground for incoming changes.
 *   - Member discovery: iOS lets the share-owner enumerate participants
 *     via `CKShare.participants`; Drive only exposes the permission ID,
 *     not the user list of "writers" without escalated scopes.
 */
import {
  getCloudKit,
  type CloudKit,
  type CloudKitRecord,
  type CloudKitShareInvite,
} from '@solidarity/nitro-cloudkit';

import {
  CURRENT_USER_RECORD_ID,
  useGroupStore,
  type GroupMember,
  type GroupModel,
} from './store';

const GROUP_RECORD_TYPE = 'AirmeishiGroup';
const MEMBER_RECORD_TYPE = 'AirmeishiGroupMember';
const CONTAINER_ID = 'iCloud.kidneyweakx.airmeishi';

interface GroupRecordFields {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly ownerRecordID: string;
  readonly merkleRoot?: string;
  readonly merkleTreeDepth: number;
  readonly memberCount: number;
  readonly isPrivate: boolean;
  readonly credentialIssuers: readonly string[];
}

interface MemberRecordFields {
  readonly id: string;
  readonly groupID: string;
  readonly userRecordID: string;
  readonly role: 'owner' | 'member';
  readonly status: 'active' | 'pending' | 'left' | 'kicked';
  readonly merkleIndex: number;
  readonly joinedAtMs: number;
  readonly sealedRoute?: string;
  readonly pubKey?: string;
  readonly signPubKey?: string;
  readonly commitment?: string;
}

let initialized = false;

async function ensureInitialized(): Promise<CloudKit> {
  const ck = getCloudKit();
  if (!initialized) {
    await ck.initialize(CONTAINER_ID);
    initialized = true;
  }
  return ck;
}

function recordToGroup(record: CloudKitRecord): GroupModel | null {
  try {
    const parsed: GroupRecordFields = JSON.parse(record.fields);
    return {
      id: parsed.id,
      name: parsed.name,
      description: parsed.description ?? '',
      ownerRecordID: parsed.ownerRecordID,
      merkleRoot: parsed.merkleRoot,
      merkleTreeDepth: parsed.merkleTreeDepth ?? 20,
      memberCount: parsed.memberCount ?? 0,
      isPrivate: parsed.isPrivate ?? false,
      isSynced: true,
      credentialIssuers: parsed.credentialIssuers ?? [],
    };
  } catch {
    return null;
  }
}

function recordToMember(record: CloudKitRecord): GroupMember | null {
  try {
    const parsed: MemberRecordFields = JSON.parse(record.fields);
    return {
      id: parsed.id,
      groupID: parsed.groupID,
      userRecordID: parsed.userRecordID,
      role: parsed.role,
      status: parsed.status,
      merkleIndex: parsed.merkleIndex ?? 0,
      joinedAt: new Date(parsed.joinedAtMs ?? 0),
      sealedRoute: parsed.sealedRoute,
      pubKey: parsed.pubKey,
      signPubKey: parsed.signPubKey,
      commitment: parsed.commitment,
    };
  } catch {
    return null;
  }
}

function groupToRecord(group: GroupModel): CloudKitRecord {
  const fields: GroupRecordFields = {
    id: group.id,
    name: group.name,
    description: group.description,
    ownerRecordID: group.ownerRecordID,
    merkleRoot: group.merkleRoot,
    merkleTreeDepth: group.merkleTreeDepth,
    memberCount: group.memberCount,
    isPrivate: group.isPrivate,
    credentialIssuers: group.credentialIssuers,
  };
  return {
    recordId: group.id,
    recordType: GROUP_RECORD_TYPE,
    fields: JSON.stringify(fields),
    modifiedTime: 0,
  };
}

function memberToRecord(member: GroupMember): CloudKitRecord {
  const fields: MemberRecordFields = {
    id: member.id,
    groupID: member.groupID,
    userRecordID: member.userRecordID,
    role: member.role,
    status: member.status,
    merkleIndex: member.merkleIndex,
    joinedAtMs: member.joinedAt.getTime(),
    sealedRoute: member.sealedRoute,
    pubKey: member.pubKey,
    signPubKey: member.signPubKey,
    commitment: member.commitment,
  };
  return {
    recordId: member.id,
    recordType: MEMBER_RECORD_TYPE,
    fields: JSON.stringify(fields),
    modifiedTime: 0,
  };
}

export interface CreateGroupArgs {
  readonly name: string;
  readonly description?: string;
  readonly isPrivate?: boolean;
}

export interface GroupSyncManager {
  isAvailable(): Promise<boolean>;
  createGroup(args: CreateGroupArgs): Promise<GroupModel>;
  pushGroup(group: GroupModel): Promise<GroupModel>;
  deleteGroup(group: GroupModel): Promise<void>;
  createInviteLink(group: GroupModel): Promise<CloudKitShareInvite>;
  joinGroup(urlOrToken: string): Promise<string>;
  fetchAllGroups(): Promise<readonly GroupModel[]>;
  fetchMembers(group: GroupModel): Promise<readonly GroupMember[]>;
  pushMember(member: GroupMember): Promise<void>;
}

class CloudGroupSyncManager implements GroupSyncManager {
  async isAvailable(): Promise<boolean> {
    const ck = await ensureInitialized();
    return ck.isAvailable();
  }

  async createGroup(args: CreateGroupArgs): Promise<GroupModel> {
    const ck = await ensureInitialized();
    const id = generateId();
    const group: GroupModel = {
      id,
      name: args.name,
      description: args.description ?? '',
      ownerRecordID: CURRENT_USER_RECORD_ID,
      merkleTreeDepth: 20,
      memberCount: 1,
      isPrivate: args.isPrivate ?? false,
      isSynced: false,
      credentialIssuers: [],
    };
    await ck.saveRecord(groupToRecord(group));
    const synced: GroupModel = { ...group, isSynced: true };
    await useGroupStore.getState().upsertGroup(synced);
    return synced;
  }

  async pushGroup(group: GroupModel): Promise<GroupModel> {
    const ck = await ensureInitialized();
    await ck.saveRecord(groupToRecord(group));
    const synced: GroupModel = { ...group, isSynced: true };
    await useGroupStore.getState().upsertGroup(synced);
    return synced;
  }

  async deleteGroup(group: GroupModel): Promise<void> {
    const ck = await ensureInitialized();
    await ck.deleteRecord(group.id);
    await useGroupStore.getState().deleteGroup(group.id);
  }

  async createInviteLink(group: GroupModel): Promise<CloudKitShareInvite> {
    const ck = await ensureInitialized();
    return await ck.createShare(group.id, group.name, !group.isPrivate);
  }

  async joinGroup(urlOrToken: string): Promise<string> {
    const ck = await ensureInitialized();
    return await ck.acceptShare(urlOrToken);
  }

  async fetchAllGroups(): Promise<readonly GroupModel[]> {
    const ck = await ensureInitialized();
    const records = await ck.queryRecords(GROUP_RECORD_TYPE, '{}');
    const groups: GroupModel[] = [];
    for (const record of records) {
      const group = recordToGroup(record);
      if (group) {
        await useGroupStore.getState().upsertGroup(group);
        groups.push(group);
      }
    }
    return groups;
  }

  async fetchMembers(group: GroupModel): Promise<readonly GroupMember[]> {
    const ck = await ensureInitialized();
    const records = await ck.queryRecords(
      MEMBER_RECORD_TYPE,
      JSON.stringify({ key: 'groupID', op: '=', value: group.id })
    );
    const out: GroupMember[] = [];
    for (const record of records) {
      const m = recordToMember(record);
      if (m) {
        out.push(m);
        await useGroupStore.getState().upsertMember(m);
      }
    }
    return out;
  }

  async pushMember(member: GroupMember): Promise<void> {
    const ck = await ensureInitialized();
    await ck.saveRecord(memberToRecord(member));
    await useGroupStore.getState().upsertMember(member);
  }
}

const singleton: GroupSyncManager = new CloudGroupSyncManager();

export function syncManager(): GroupSyncManager {
  return singleton;
}

function generateId(): string {
  // RFC 4122 v4 — `crypto.randomUUID()` is available in Hermes via JSI on
  // RN 0.74+; falls back to the polyfill from react-native-get-random-values
  // (already a dependency).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const first = bytes[6] ?? 0;
  const second = bytes[8] ?? 0;
  bytes[6] = (first & 0x0f) | 0x40;
  bytes[8] = (second & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Extract a CloudKit / Drive share URL or bare share token from a string.
 * Accepts:
 *   - https://www.icloud.com/share/...
 *   - https://drive.google.com/file/d/.../view
 *   - solidarity://group/<token>
 *   - airmeishi://...?token=...
 *   - Bare UUID token strings
 */
export function extractShareTarget(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('https://')) return trimmed;
  try {
    const url = new URL(trimmed);
    const fromQuery = url.searchParams.get('token');
    if (fromQuery) return fromQuery;
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last) return last;
  } catch {
    // not a URL, return as-is
  }
  return trimmed;
}
