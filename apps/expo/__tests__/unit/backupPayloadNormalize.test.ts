import { describe, expect, it } from 'bun:test';

import type { BackupPayload } from '../../src/backup/backupManager';
import { normalizeRestoredPayload } from '../../src/backup/normalizeBackupPayload';

describe('normalizeRestoredPayload', () => {
  it('normalizes the Swift BackupData aliases', () => {
    const businessCards = [{ id: 'swift-card' }];
    const contacts = [{ id: 'swift-contact' }];

    const result = normalizeRestoredPayload({
      version: 3,
      timestamp: '2026-01-01T00:00:00Z',
      businessCards,
      contacts,
    });

    expect(result?.cards.map((card) => card.id)).toEqual(['swift-card']);
    expect(result?.contacts.map((contact) => contact.id)).toEqual(['swift-contact']);
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
});
