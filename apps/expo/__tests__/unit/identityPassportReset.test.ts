import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { CredentialManifestEntry } from '../../src/credentials/credentialManifest';
import type { StoredCredential } from '../../src/credentials/store';
import type { IdentityCardEntity, ProvableClaimEntity } from '../../src/identity/entities';

const kv = new Map<string, string>();

interface CredentialStoreSurface {
  readonly useCredentialStore: {
    getState: () => {
      readonly manifest: readonly { readonly id: string; readonly type: string }[];
      readonly details: ReadonlyMap<string, StoredCredential>;
      readonly add: (credential: StoredCredential) => Promise<void>;
    };
    setState: (state: Partial<{
      manifest: readonly CredentialManifestEntry[];
      details: ReadonlyMap<string, StoredCredential>;
      detailsHydrated: boolean;
    }>) => void;
  };
}

interface IdentityStoreSurface {
  readonly useIdentityData: {
    getState: () => {
      readonly identityCards: readonly IdentityCardEntity[];
      readonly provableClaims: readonly ProvableClaimEntity[];
      readonly hydrated: boolean;
      readonly upsertIdentityCard: (card: IdentityCardEntity) => Promise<void>;
      readonly upsertProvableClaim: (claim: ProvableClaimEntity) => Promise<void>;
      readonly removePassportCredentials: () => Promise<void>;
    };
    setState: (state: Partial<{
      identityCards: readonly IdentityCardEntity[];
      provableClaims: readonly ProvableClaimEntity[];
      hydrated: boolean;
    }>) => void;
  };
}

let credentials: CredentialStoreSurface;
let identity: IdentityStoreSurface;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (key: string): string | undefined => kv.get(key),
      set: (key: string, value: string): void => {
        kv.set(key, value);
      },
      remove: (key: string): void => {
        kv.delete(key);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
      contains: (key: string): boolean => kv.has(key),
    }),
    initMmkv: () => Promise.resolve(undefined),
  }));
  await mock.module('@/storage/encryptionManager', () => ({
    encryptJson: (value: unknown) =>
      Promise.resolve(Buffer.from(JSON.stringify(value)).toString('base64')),
    decryptJson: <T,>(value: string): Promise<T> => {
      const raw = value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
      return Promise.resolve(JSON.parse(raw) as T);
    },
  }));

  credentials = await import('../../src/credentials/store');
  identity = await import('../../src/identity/dataStore');
});

beforeEach(() => {
  kv.clear();
  credentials.useCredentialStore.setState({
    manifest: [],
    details: new Map(),
    detailsHydrated: false,
  });
  identity.useIdentityData.setState({
    identityCards: [],
    provableClaims: [],
    hydrated: false,
  });
});

const now = new Date('2026-05-25T12:00:00.000Z');

function credential(id: string, type: string): StoredCredential {
  return {
    id,
    type,
    title: type === 'passport' ? 'Passport' : 'Business Card',
    issuerDid: type === 'passport' ? 'did:gov:passport:JPN' : 'did:key:zSelf',
    holderDid: 'did:key:zHolder',
    trustLevel: type === 'passport' ? 'L3' : 'L1',
    rawJwt: `${id}.payload.sig`,
    issuedAt: now,
    metadataTags: [],
  };
}

function identityCard(id: string, type: string): IdentityCardEntity {
  return {
    id,
    type,
    issuerType: type === 'passport' ? 'government' : 'self',
    trustLevel: type === 'passport' ? 'L3' : 'L1',
    title: type === 'passport' ? 'Passport' : 'Business Card',
    issuerDid: type === 'passport' ? 'did:gov:passport:JPN' : 'did:key:zSelf',
    holderDid: 'did:key:zHolder',
    issuedAt: now,
    status: 'verified',
    rawCredentialJWT: `${id}.payload.sig`,
    metadataTags: [],
    createdAt: now,
    updatedAt: now,
  };
}

function claim(id: string, identityCardId: string): ProvableClaimEntity {
  return {
    id,
    identityCardId,
    claimType: 'age_over_18',
    title: 'I am over 18',
    issuerType: 'government',
    trustLevel: 'L3',
    source: 'Passport',
    payload: '{}',
    isPresentable: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('removePassportCredentials', () => {
  it('removes passport credentials from the credential store, identity cards, and claims', async () => {
    await credentials.useCredentialStore.getState().add(credential('passport-1', 'passport'));
    await credentials.useCredentialStore.getState().add(credential('card-1', 'business_card'));
    await identity.useIdentityData.getState().upsertIdentityCard(identityCard('passport-1', 'passport'));
    await identity.useIdentityData.getState().upsertIdentityCard(identityCard('card-1', 'business_card'));
    await identity.useIdentityData.getState().upsertProvableClaim(claim('claim-1', 'passport-1'));

    await identity.useIdentityData.getState().removePassportCredentials();

    expect(credentials.useCredentialStore.getState().manifest.map((entry) => entry.id)).toEqual(['card-1']);
    expect(credentials.useCredentialStore.getState().details.has('passport-1')).toBe(false);
    expect(kv.has('vc:passport-1')).toBe(false);
    expect(kv.has('vc:card-1')).toBe(true);
    expect(identity.useIdentityData.getState().identityCards.map((card) => card.id)).toEqual(['card-1']);
    expect(identity.useIdentityData.getState().provableClaims).toEqual([]);
  });

  it('removes stale passport VCs even when identity cards were not hydrated yet', async () => {
    await credentials.useCredentialStore.getState().add(credential('passport-1', 'passport'));
    await credentials.useCredentialStore.getState().add(credential('card-1', 'business_card'));

    await identity.useIdentityData.getState().removePassportCredentials();

    expect(credentials.useCredentialStore.getState().manifest.map((entry) => entry.id)).toEqual(['card-1']);
    expect(kv.has('vc:passport-1')).toBe(false);
    expect(kv.has('vc:card-1')).toBe(true);
  });
});
