import { beforeEach, describe, expect, it } from 'bun:test';
import { contactSchema } from '@solidarity/shared';

import * as leaveCardInbox from '../../src/contacts/leaveCardInbox';
import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';
import {
  LEAVE_CARD_STORAGE_KEY,
  __setLeaveCardStorageForTesting,
  contactFromLeaveCard,
  hydrateLeaveCards,
  resetLeaveCardStoreForTesting,
  useLeaveCardStore,
  type LeaveCardStorage,
} from '../../src/contacts/leaveCardInbox';

function memoryStorage(): {
  readonly storage: LeaveCardStorage;
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getString: (key) => values.get(key) ?? null,
      setString: (key, value) => { values.set(key, value); },
    },
  };
}

describe('Pending Leave Card inbox', () => {
  beforeEach(() => {
    resetLeaveCardStoreForTesting();
    __setLeaveCardStorageForTesting(null);
    __resetLocalDataWipeBarrierForTesting();
  });

  it('starts honestly empty and accepts only validated future receiver input', () => {
    const memory = memoryStorage();
    __setLeaveCardStorageForTesting(memory.storage);
    hydrateLeaveCards();
    expect(useLeaveCardStore.getState().pending).toEqual([]);

    const enqueue = Reflect.get(leaveCardInbox, 'enqueueLeaveCard');
    expect(enqueue).toBeTypeOf('function');
    if (typeof enqueue !== 'function') return;

    const invalid = enqueue({ name: ' ', contact: 'not-contact' });
    expect(invalid).toEqual({ ok: false, error: 'invalid' });

    const added = enqueue({
      name: 'Ray Wu',
      contact: 'ray@ncku.edu.tw',
      message: 'Met at the meetup',
      senderPublicKey: 'npub1actualsender',
      receivedAt: '2026-08-10T01:00:00.000Z',
    });
    expect(added.ok).toBe(true);
    expect(useLeaveCardStore.getState().pending).toHaveLength(1);
    expect(memory.values.has(LEAVE_CARD_STORAGE_KEY)).toBe(true);
  });

  it('Skip removes without a contact and Block stores only a local identifier hash', () => {
    const memory = memoryStorage();
    __setLeaveCardStorageForTesting(memory.storage);
    hydrateLeaveCards();
    const first = useLeaveCardStore.getState().enqueue({ name: 'Ray', contact: 'ray@example.com' });
    if (!first.ok) throw new Error('expected enqueue');
    useLeaveCardStore.getState().skip(first.value.id);
    expect(useLeaveCardStore.getState().pending).toEqual([]);

    const second = useLeaveCardStore.getState().enqueue({ name: 'Ray', contact: 'ray@example.com' });
    if (!second.ok) throw new Error('expected enqueue');
    useLeaveCardStore.getState().block(second.value.id);
    const blocked = useLeaveCardStore.getState().blockedIdentifiers;
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).not.toContain('ray@example.com');
    expect(useLeaveCardStore.getState().enqueue({ name: 'Ray', contact: 'ray@example.com' }))
      .toEqual({ ok: false, error: 'blocked' });
  });

  it('Add turns actual card fields into one unverified manual contact', () => {
    const memory = memoryStorage();
    __setLeaveCardStorageForTesting(memory.storage);
    hydrateLeaveCards();
    const result = useLeaveCardStore.getState().enqueue({
      name: 'Mia Ho',
      contact: '+886912345678',
      message: 'Please call after 5',
    });
    if (!result.ok) throw new Error('expected enqueue');

    const contact = contactFromLeaveCard(
      result.value,
      new Date('2026-08-10T02:00:00.000Z'),
    );
    const retry = contactFromLeaveCard(
      result.value,
      new Date('2026-08-10T02:01:00.000Z'),
    );
    expect(contact).toMatchObject({
      source: 'Manual',
      verificationStatus: 'Unverified',
      notes: 'Please call after 5',
      businessCard: { name: 'Mia Ho', phone: '+886912345678' },
    });
    expect(contact.businessCard.email).toBeUndefined();
    expect(contact.pubKey).toBeUndefined();
    expect(contact.id).toBe(retry.id);
    expect(contact.businessCard.id).toBe(retry.businessCard.id);
    expect(contact.id).not.toBe(contact.businessCard.id);
    expect(contactSchema.safeParse(contact).success).toBe(true);
  });

  it('fails closed on an incompatible persisted inbox and resets its live state after a local wipe', () => {
    const memory = memoryStorage();
    memory.values.set(
      LEAVE_CARD_STORAGE_KEY,
      JSON.stringify({ version: 2, pending: [], blockedIdentifiers: [] }),
    );
    __setLeaveCardStorageForTesting(memory.storage);
    hydrateLeaveCards();
    expect(useLeaveCardStore.getState().status).toBe('error');

    memory.values.set(
      LEAVE_CARD_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        pending: [{
          id: '38ef38f5-f22e-4e42-9242-58a37a5f2a71',
          name: 'Invalid persisted card',
          contact: 'not-a-contact',
          receivedAt: '2026-08-10T01:00:00.000Z',
          identifierHash: 'a'.repeat(64),
        }],
        blockedIdentifiers: [],
      }),
    );
    resetLeaveCardStoreForTesting();
    hydrateLeaveCards();
    expect(useLeaveCardStore.getState().status).toBe('error');

    const reset = Reflect.get(useLeaveCardStore.getState(), 'resetForLocalWipe');
    expect(reset).toBeTypeOf('function');
    if (typeof reset !== 'function') return;
    reset();
    expect(useLeaveCardStore.getState()).toMatchObject({
      status: 'loading',
      pending: [],
      blockedIdentifiers: [],
    });
  });

  it('does not persist an inbound card while a local-data wipe owns storage', () => {
    const memory = memoryStorage();
    __setLeaveCardStorageForTesting(memory.storage);
    hydrateLeaveCards();
    beginLocalDataWipe();

    expect(useLeaveCardStore.getState().enqueue({
      name: 'Blocked by wipe',
      contact: 'wipe@example.com',
    })).toEqual({ ok: false, error: 'storage' });
    expect(useLeaveCardStore.getState().pending).toEqual([]);

    completeLocalDataWipe();
  });
});
