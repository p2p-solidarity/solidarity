/**
 * Contacts importer — VCF parse + device picker → Contact mapping + dedupe.
 *
 * Mirrors solidarity/Services/Contacts/ContactImportService.swift behaviour:
 *   - importFromVCF iterates parsed contacts, skips empty names, upserts via
 *     the local repository.
 *   - importPickedContacts maps OS contacts → Solidarity Contact (source:
 *     'Device', verificationStatus: 'Unverified', tags: []).
 *   - duplicate keys (same id) replace the existing record, not append.
 *   - permission denial returns granted=false and imports zero rows.
 *
 * `expo-contacts`, `@/storage/mmkv`, and `@/storage/encryptionManager` are all
 * mocked so the test runs as pure TS over an in-memory KV.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

interface ImporterModule {
  readonly importFromVcf: (text: string) => Promise<number>;
  readonly importFromDevice: () => Promise<{
    readonly granted: boolean;
    readonly count: number;
  }>;
  readonly loadDeviceContacts: () => Promise<{
    readonly access: 'all' | 'limited' | 'none';
    readonly rows: readonly { readonly key: string; readonly name: string }[];
  }>;
}

interface RepositoryModule {
  readonly useContactStore: {
    getState: () => {
      readonly manifest: readonly unknown[];
      readonly details: ReadonlyMap<string, unknown>;
      readonly upsert: (c: unknown) => Promise<void>;
    };
    setState: (s: {
      readonly manifest?: readonly unknown[];
      readonly details?: ReadonlyMap<string, unknown>;
    }) => void;
  };
}

const kv = new Map<string, string>();

// Mutable state for the expo-contacts mock; each test rewrites these.
type MockContact = {
  readonly id: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly fullName?: string | null;
  readonly emails?: readonly { address?: string }[];
  readonly phones?: readonly { number?: string }[];
  readonly company?: string | null;
  readonly jobTitle?: string;
  readonly image?: string | null;
};

let mockPermission: 'granted' | 'denied' = 'granted';
let mockAccessPrivileges: 'all' | 'limited' | 'none' = 'all';
let mockContacts: readonly MockContact[] = [];

let importer: ImporterModule;
let repository: RepositoryModule;

beforeAll(async () => {
  // `@/storage` (imported transitively via the contact repository) drags in
  // `react-native` + the `expo` runtime (`__DEV__`) + `expo-sqlite` /
  // `expo-secure-store` native modules — none of which load under bun. Stub
  // them like the sibling storage suites so this file runs standalone instead
  // of depending on another suite's mock leaking through the shared registry.
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  await mock.module('react-native', () => ({
    ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
      .__AIRMEISHI_RN_MOCK__),
    Platform: {
      OS: 'ios',
      select: <T,>(o: { ios?: T; android?: T; default?: T }): T | undefined =>
        o.ios ?? o.default,
    },
  }));
  await mock.module('expo-sqlite', () => ({
    openDatabaseAsync: async () => ({
      execAsync: async () => undefined,
      getFirstAsync: async () => null,
      runAsync: async () => undefined,
    }),
  }));
  await mock.module('expo-secure-store', () => ({
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: async () => null,
    setItemAsync: async () => undefined,
    deleteItemAsync: async () => undefined,
  }));
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
    encryptJson: async (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64'),
    decryptJson: async <T,>(s: string): Promise<T> => {
      const raw = s.startsWith('{') ? s : Buffer.from(s, 'base64').toString('utf8');
      return JSON.parse(raw) as T;
    },
  }));
  await mock.module('expo-contacts', () => {
    class Contact {
      static async getAllDetails(): Promise<readonly MockContact[]> {
        return mockContacts;
      }
      static async hasAny(): Promise<boolean> {
        return mockContacts.length > 0;
      }
      static async presentPicker(): Promise<null> {
        return null;
      }
    }
    return {
      Contact,
      ContactField: {
        FULL_NAME: 'fullName',
        GIVEN_NAME: 'givenName',
        FAMILY_NAME: 'familyName',
        EMAILS: 'emails',
        PHONES: 'phones',
        COMPANY: 'company',
        JOB_TITLE: 'jobTitle',
        IMAGE: 'image',
      },
      PermissionStatus: {
        GRANTED: 'granted',
        DENIED: 'denied',
        UNDETERMINED: 'undetermined',
      },
      requestPermissionsAsync: async (): Promise<{
        status: string;
        accessPrivileges: string;
      }> => ({
        status: mockPermission,
        accessPrivileges: mockAccessPrivileges,
      }),
      getPermissionsAsync: async (): Promise<{
        status: string;
        accessPrivileges: string;
      }> => ({
        status: mockPermission,
        accessPrivileges: mockAccessPrivileges,
      }),
    };
  });

  importer = (await import('../../src/contacts/importer')) as unknown as ImporterModule;
  repository = (await import('../../src/contacts/repository')) as unknown as RepositoryModule;
});

beforeEach(() => {
  kv.clear();
  repository.useContactStore.setState({ manifest: [], details: new Map() });
  mockPermission = 'granted';
  mockAccessPrivileges = 'all';
  mockContacts = [];
});

afterEach(() => {
  mockContacts = [];
});

const SIMPLE_VCF = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Lovelace;Ada;;;',
  'FN:Ada Lovelace',
  'EMAIL:ada@solidarity.gg',
  'TEL:+15550100',
  'ORG:Solidarity',
  'TITLE:Founder',
  'END:VCARD',
].join('\r\n');

describe('importFromVcf', () => {
  it('parses a single vCard and inserts one contact', async () => {
    const count = await importer.importFromVcf(SIMPLE_VCF);
    expect(count).toBe(1);
    const all = Array.from(repository.useContactStore.getState().details.values());
    expect(all.length).toBe(1);
  });

  it('parses a bundle of cards and inserts each', async () => {
    const bundle = [SIMPLE_VCF, SIMPLE_VCF.replace('Ada Lovelace', 'Grace Hopper')]
      .join('\r\n');
    const count = await importer.importFromVcf(bundle);
    expect(count).toBe(2);
  });
});

describe('importFromDevice — permission flow', () => {
  it('returns granted=false and count=0 when permission is denied', async () => {
    mockPermission = 'denied';
    mockContacts = [
      { id: 'cn-1', givenName: 'Ada', familyName: 'Lovelace' },
    ];
    const result = await importer.importFromDevice();
    expect(result.granted).toBe(false);
    expect(result.count).toBe(0);
    expect(repository.useContactStore.getState().details.size).toBe(0);
  });
});

describe('importFromDevice — VCF parse → Contact mapping', () => {
  it('maps OS contact → Solidarity Contact with source=Manual, status=Unverified, tags=[]', async () => {
    mockContacts = [
      {
        id: 'cn-1',
        givenName: 'Ada',
        familyName: 'Lovelace',
        fullName: 'Ada Lovelace',
        emails: [{ address: 'ada@solidarity.gg' }],
        phones: [{ number: '+15550100' }],
        company: 'Solidarity',
        jobTitle: 'Founder',
      },
    ];

    const result = await importer.importFromDevice();
    expect(result.granted).toBe(true);
    expect(result.count).toBe(1);

    const list = Array.from(
      repository.useContactStore.getState().details.values()
    ) as readonly {
      readonly source: string;
      readonly verificationStatus: string;
      readonly tags: readonly string[];
      readonly businessCard: {
        readonly name: string;
        readonly email?: string;
        readonly phone?: string;
        readonly company?: string;
        readonly title?: string;
      };
    }[];
    expect(list.length).toBe(1);
    const c = list[0]!;
    expect(c.source).toBe('Manual');
    expect(c.verificationStatus).toBe('Unverified');
    expect(c.tags).toEqual([]);
    expect(c.businessCard.name).toBe('Ada Lovelace');
    expect(c.businessCard.email).toBe('ada@solidarity.gg');
    expect(c.businessCard.phone).toBe('+15550100');
    expect(c.businessCard.company).toBe('Solidarity');
    expect(c.businessCard.title).toBe('Founder');
  });

  it('skips contacts with no name', async () => {
    mockContacts = [
      { id: 'cn-1', givenName: '', familyName: '', fullName: '' },
      { id: 'cn-2', givenName: 'Grace', familyName: 'Hopper' },
    ];
    const result = await importer.importFromDevice();
    expect(result.count).toBe(1);
    expect(repository.useContactStore.getState().details.size).toBe(1);
  });

  it('falls back to givenName + familyName when fullName is missing', async () => {
    mockContacts = [
      { id: 'cn-1', givenName: 'Ada', familyName: 'Lovelace' },
    ];
    const result = await importer.importFromDevice();
    expect(result.count).toBe(1);
    const c = Array.from(
      repository.useContactStore.getState().details.values()
    )[0] as { readonly businessCard: { readonly name: string } };
    expect(c.businessCard.name).toBe('Ada Lovelace');
  });
});

describe('loadDeviceContacts — iOS 18+ limited access', () => {
  it("reports access 'all' when the user granted full access", async () => {
    mockPermission = 'granted';
    mockAccessPrivileges = 'all';
    mockContacts = [{ id: 'cn-1', givenName: 'Ada', familyName: 'Lovelace' }];
    const result = await importer.loadDeviceContacts();
    expect(result.access).toBe('all');
    expect(result.rows.length).toBe(1);
  });

  it("reports access 'limited' when the user shared only selected contacts", async () => {
    mockPermission = 'granted';
    mockAccessPrivileges = 'limited';
    mockContacts = [{ id: 'cn-1', givenName: 'Ada', familyName: 'Lovelace' }];
    const result = await importer.loadDeviceContacts();
    expect(result.access).toBe('limited');
    // Limited still surfaces the shared subset so the picker can list them.
    expect(result.rows.length).toBe(1);
  });

  it("reports access 'none' and no rows when permission is denied", async () => {
    mockPermission = 'denied';
    mockAccessPrivileges = 'none';
    mockContacts = [{ id: 'cn-1', givenName: 'Ada', familyName: 'Lovelace' }];
    const result = await importer.loadDeviceContacts();
    expect(result.access).toBe('none');
    expect(result.rows.length).toBe(0);
  });
});

describe('importFromDevice — dedupe on re-import', () => {
  it('does not double-insert the same OS contact on a second import', async () => {
    mockContacts = [
      {
        id: 'cn-1',
        givenName: 'Ada',
        familyName: 'Lovelace',
        emails: [{ address: 'ada@solidarity.gg' }],
      },
    ];
    await importer.importFromDevice();
    const sizeAfterFirst = repository.useContactStore.getState().details.size;
    expect(sizeAfterFirst).toBe(1);

    // Second import of the same OS contact should not create a duplicate.
    await importer.importFromDevice();
    const sizeAfterSecond = repository.useContactStore.getState().details.size;
    expect(sizeAfterSecond).toBe(1);
  });
});
