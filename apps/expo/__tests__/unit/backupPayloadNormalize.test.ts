import { describe, expect, it } from 'bun:test';

import type { BackupPayload } from '../../src/backup/backupManager';
import { normalizeRestoredPayload } from '../../src/backup/normalizeBackupPayload';

describe('normalizeRestoredPayload', () => {
  it('normalizes the Swift BackupData aliases', () => {
    const businessCard = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'Swift Card',
      sharingPreferences: {
        publicFields: ['name'],
        professionalFields: ['name'],
        personalFields: ['name'],
      },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const businessCards = [businessCard];
    const contactId = '550e8400-e29b-41d4-a716-446655440000';
    const contacts = [{
      id: contactId,
      businessCard,
      receivedAt: '2026-01-01T00:00:00Z',
      source: 'Manual',
    }];

    const result = normalizeRestoredPayload({
      version: 3,
      timestamp: '2026-01-01T00:00:00Z',
      businessCards,
      contacts,
    });

    expect(result?.cards.map((card) => card.id)).toEqual([businessCard.id]);
    expect(result?.contacts.map((contact) => contact.id)).toEqual([contactId]);
    expect(result?.exportedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('preserves an Expo BackupPayload shape', () => {
    const payload: BackupPayload = {
      schemaVersion: 3,
      exportedAt: '2026-01-02T00:00:00Z',
      provider: 'iCloud',
      cards: [],
      contacts: [],
      identityCards: [],
      provableClaims: [],
      storedCredentials: [],
    };

    expect(normalizeRestoredPayload(payload)).toEqual(payload);
  });

  it('defaults missing and undefined arrays to empty arrays', () => {
    const result = normalizeRestoredPayload({
      cards: undefined,
      contacts: undefined,
      identityCards: undefined,
      provableClaims: undefined,
      storedCredentials: undefined,
    });

    expect(result?.cards).toEqual([]);
    expect(result?.contacts).toEqual([]);
    expect(result?.identityCards).toEqual([]);
    expect(result?.provableClaims).toEqual([]);
    expect(result?.storedCredentials).toEqual([]);
  });

  it('rejects non-object payloads', () => {
    for (const raw of [null, 'string', []]) {
      expect(normalizeRestoredPayload(raw)).toBeNull();
    }
  });

  it('defaults the provider to iCloud and preserves googleDrive', () => {
    expect(normalizeRestoredPayload({})?.provider).toBe('iCloud');
    expect(normalizeRestoredPayload({ provider: 'googleDrive' })?.provider).toBe('googleDrive');
  });

  it('rejects an explicitly unsupported Expo schema version', () => {
    expect(() => normalizeRestoredPayload({ schemaVersion: 5, cards: [] }))
      .toThrow('unsupported-backup-schema');
  });

  it('rejects malformed legacy records before restore can write any item', () => {
    expect(() => normalizeRestoredPayload({
      schemaVersion: 3,
      cards: [{ id: 'not-a-card' }],
      contacts: [],
    })).toThrow();
  });

  it('rehydrates legacy identity and credential timestamps before store writes', () => {
    const timestamp = '2026-01-01T00:00:00Z';
    const common = {
      id: 'credential-1', type: 'profile', title: 'Profile', issuerDid: 'did:key:issuer',
      holderDid: 'did:key:holder', trustLevel: 'L1', issuedAt: timestamp, metadataTags: [],
    };
    const result = normalizeRestoredPayload({
      schemaVersion: 3,
      cards: [],
      contacts: [],
      storedCredentials: [{ ...common, rawJwt: 'jwt' }],
      identityCards: [{ ...common, issuerType: 'self', status: 'verified', createdAt: timestamp, updatedAt: timestamp }],
      provableClaims: [{ id: 'claim-1', identityCardId: common.id, claimType: 'profile_card', title: 'Profile',
        issuerType: 'self', trustLevel: 'L1', source: 'Profile', payload: '{}', isPresentable: true,
        createdAt: timestamp, updatedAt: timestamp }],
    });
    expect(result?.storedCredentials?.[0]?.issuedAt).toBeInstanceOf(Date);
    expect(result?.identityCards?.[0]?.updatedAt).toBeInstanceOf(Date);
    expect(result?.provableClaims?.[0]?.createdAt).toBeInstanceOf(Date);
  });
});
