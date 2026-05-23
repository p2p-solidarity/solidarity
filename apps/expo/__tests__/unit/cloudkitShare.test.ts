/**
 * cloudkitShare — CKShare / Drive-share orchestration with a mocked Nitro
 * module.
 *
 * We can't run real CloudKit / Drive in `bun test`, so we install a fake
 * implementing the `@solidarity/nitro-cloudkit` surface and assert that:
 *
 *   1. `createInviteLink(group)` produces a share id + URL the JS layer
 *      can hand to a peer.
 *   2. `joinGroup(url)` accepts the same URL and yields a stable share id.
 *   3. The local group store is updated as records flow through saveRecord.
 *   4. `extractShareTarget` cleanly handles iCloud URLs, Drive webViewLink,
 *      `solidarity://group/<token>` deep links, and bare token strings.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type {
  CloudKit,
  CloudKitEvent,
  CloudKitRecord,
  CloudKitShareInvite,
} from '@solidarity/nitro-cloudkit';

// ─── Fake Nitro CloudKit ───────────────────────────────────────────────────

interface FakeShareEntry {
  readonly shareId: string;
  readonly rootRecordId: string;
  readonly url: string;
}

const records = new Map<string, CloudKitRecord>();
const shares = new Map<string, FakeShareEntry>();
let driveToken: string | undefined;

const FakeCloudKit: CloudKit = {
  initialize: async () => true,
  isAvailable: () => true,
  currentUserId: async () => 'fake-user',
  saveRecord: async (record: CloudKitRecord) => {
    const stamped: CloudKitRecord = {
      ...record,
      recordId: record.recordId || `auto-${records.size + 1}`,
      modifiedTime: Date.now(),
    };
    records.set(stamped.recordId, stamped);
    return stamped;
  },
  fetchRecord: async (id: string) => {
    const r = records.get(id);
    if (!r) throw new Error(`record not found: ${id}`);
    return r;
  },
  deleteRecord: async (id: string) => {
    records.delete(id);
  },
  queryRecords: async (recordType: string) => {
    return Array.from(records.values()).filter((r) => r.recordType === recordType);
  },
  createShare: async (rootRecordId: string, title: string): Promise<CloudKitShareInvite> => {
    const shareId = `share-${rootRecordId}`;
    const url = `https://www.icloud.com/share/${shareId}`;
    shares.set(shareId, { shareId, rootRecordId, url });
    return { shareId, url, title, thumbnail: undefined };
  },
  acceptShare: async (url: string): Promise<string> => {
    // The fake URL embeds the share id as the trailing path segment.
    const last = url.split('/').filter(Boolean).pop() ?? url;
    return last;
  },
  fetchSharedRecords: async (shareId: string) => {
    const entry = shares.get(shareId);
    if (!entry) return [];
    const root = records.get(entry.rootRecordId);
    return root ? [root] : [];
  },
  removeShare: async (shareId: string) => {
    shares.delete(shareId);
  },
  addEventListener: (_handler: (event: CloudKitEvent) => void) => () => undefined,
  setDriveAccessToken: (token: string) => { driveToken = token; },
} as unknown as CloudKit;

// ─── Module mocks ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await mock.module('@solidarity/nitro-cloudkit', () => ({
    getCloudKit: () => FakeCloudKit,
  }));
  await mock.module('react-native', () => ({
    Platform: { OS: 'ios', select: <T,>(o: { ios?: T; android?: T; default?: T }) =>
      o.ios ?? o.default },
  }));
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      set: () => undefined,
      getString: () => undefined,
      getAllKeys: () => [],
      remove: () => undefined,
    }),
  }));
  await mock.module('@/storage/encryptionManager', () => ({
    encryptJson: async (v: unknown) => JSON.stringify(v),
    decryptJson: async (s: string) => JSON.parse(s),
  }));
});

beforeEach(() => {
  records.clear();
  shares.clear();
  driveToken = undefined;
});

afterEach(() => {
  // Reset module-internal `initialized` flag by re-importing on the next
  // beforeAll if needed. The fake doesn't track init state so we're safe.
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('cloudkitShare — invite link', () => {
  it('creates a share for a group and exposes a URL', async () => {
    const { syncManager } = await import('../../src/groups/cloudSync');
    const group = await syncManager().createGroup({
      name: 'Test',
      description: 'unit',
      isPrivate: true,
    });
    const invite = await syncManager().createInviteLink(group);
    expect(invite.shareId).toMatch(/^share-/);
    expect(invite.url).toContain(invite.shareId);
    expect(invite.title).toBe('Test');
  });

  it('joinGroup accepts the URL produced by createInviteLink', async () => {
    const { syncManager } = await import('../../src/groups/cloudSync');
    const group = await syncManager().createGroup({ name: 'Aurora' });
    const invite = await syncManager().createInviteLink(group);
    const shareId = await syncManager().joinGroup(invite.url);
    expect(shareId).toBe(invite.shareId);
  });

  it('createGroup pushes a record into the fake store', async () => {
    const { syncManager } = await import('../../src/groups/cloudSync');
    const before = records.size;
    await syncManager().createGroup({ name: 'Solid' });
    expect(records.size).toBe(before + 1);
  });
});

describe('cloudkitShare — extractShareTarget', () => {
  it('returns iCloud share URLs unchanged', async () => {
    const { extractShareTarget } = await import('../../src/groups/cloudSync');
    const u = 'https://www.icloud.com/share/0AbCDeFg';
    expect(extractShareTarget(u)).toBe(u);
  });

  it('returns Drive webViewLink URLs unchanged', async () => {
    const { extractShareTarget } = await import('../../src/groups/cloudSync');
    const u = 'https://drive.google.com/file/d/1abc/view';
    expect(extractShareTarget(u)).toBe(u);
  });

  it('extracts token from a custom-scheme deep link with ?token=…', async () => {
    const { extractShareTarget } = await import('../../src/groups/cloudSync');
    const u = 'airmeishi://groups/join?token=ABC123';
    expect(extractShareTarget(u)).toBe('ABC123');
  });

  it('extracts the trailing path segment from solidarity://group/<token>', async () => {
    const { extractShareTarget } = await import('../../src/groups/cloudSync');
    const u = 'solidarity://group/THE-TOKEN';
    expect(extractShareTarget(u)).toBe('THE-TOKEN');
  });

  it('passes a bare token through unchanged', async () => {
    const { extractShareTarget } = await import('../../src/groups/cloudSync');
    expect(extractShareTarget('  BARE-TOKEN  ')).toBe('BARE-TOKEN');
  });
});

describe('cloudkitShare — Drive token plumbing', () => {
  it('setDriveAccessToken on the cloud provider also reaches the Nitro fake', async () => {
    const cloud = (await import('../../src/backup/cloudProvider')) as {
      setGoogleAccessToken: (t: string) => void;
    };
    cloud.setGoogleAccessToken('drive-token-xyz');
    expect(driveToken).toBe('drive-token-xyz');
  });
});
