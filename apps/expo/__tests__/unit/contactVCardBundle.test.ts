import { describe, expect, it } from 'bun:test';

import { prepareContactVCardBundle } from '../../src/contacts/vCardBundle';
import type { BusinessCard, Contact } from '@solidarity/shared';

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

function makeCard(
  id: string,
  name: string,
  email: string,
  phone: string,
): BusinessCard {
  const now = new Date('2026-08-09T00:00:00.000Z');
  return {
    id,
    name,
    email,
    phone,
    socialNetworks: [],
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(['name']),
      professionalFields: new Set(['name', 'email', 'phone']),
      personalFields: new Set(['name', 'email', 'phone']),
      allowForwarding: true,
      useZK: false,
      sharingFormat: 'didSigned',
    },
    nameType: 'display_name',
    verifiedFields: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

function makeContact(id: string, name: string, email: string, phone: string): Contact {
  return {
    id,
    businessCard: makeCard(id, name, email, phone),
    receivedAt: new Date('2026-08-09T00:00:00.000Z'),
    source: 'QR Code',
    tags: [],
    verificationStatus: 'Verified',
  };
}

describe('prepareContactVCardBundle', () => {
  it('hydrates every selected detail and preserves requested order with full fields', async () => {
    const selectedIds = [SECOND_ID, FIRST_ID];
    const selectedBefore = [...selectedIds];
    const contacts = new Map<string, Contact>([
      [FIRST_ID, makeContact(FIRST_ID, 'Ada', 'ada@example.com', '+1-555-0101')],
      [SECOND_ID, makeContact(SECOND_ID, 'Grace', 'grace@example.com', '+1-555-0102')],
    ]);
    const loaded: string[] = [];

    const bundle = await prepareContactVCardBundle(selectedIds, async (id) => {
      loaded.push(id);
      return contacts.get(id) ?? null;
    });

    expect(loaded).toEqual([SECOND_ID, FIRST_ID]);
    expect(selectedIds).toEqual(selectedBefore);
    expect(bundle.indexOf('FN:Grace')).toBeLessThan(bundle.indexOf('FN:Ada'));
    expect(bundle).toContain('EMAIL;TYPE=INTERNET:grace@example.com');
    expect(bundle).toContain('TEL:+1-555-0102');
    expect(bundle).toContain('EMAIL;TYPE=INTERNET:ada@example.com');
    expect(bundle).toContain('TEL:+1-555-0101');
    expect(bundle.match(/BEGIN:VCARD/gu)).toHaveLength(2);
    expect(bundle.match(/END:VCARD/gu)).toHaveLength(2);
    expect(bundle).toContain('END:VCARD\nBEGIN:VCARD');
  });

  it('fails the entire bundle when any encrypted detail is missing', async () => {
    const loaded: string[] = [];

    await expect(
      prepareContactVCardBundle([FIRST_ID, SECOND_ID], async (id) => {
        loaded.push(id);
        return id === FIRST_ID
          ? makeContact(FIRST_ID, 'Ada', 'ada@example.com', '+1-555-0101')
          : null;
      }),
    ).rejects.toThrow(`Contact detail unavailable: ${SECOND_ID}`);
    expect(loaded).toEqual([FIRST_ID, SECOND_ID]);
  });

  it('rejects without a partial bundle when detail loading fails', async () => {
    const failure = new Error('decrypt failed');
    const loaded: string[] = [];

    await expect(
      prepareContactVCardBundle([FIRST_ID, SECOND_ID], async (id) => {
        loaded.push(id);
        if (id === SECOND_ID) throw failure;
        return makeContact(FIRST_ID, 'Ada', 'ada@example.com', '+1-555-0101');
      }),
    ).rejects.toBe(failure);
    expect(loaded).toEqual([FIRST_ID, SECOND_ID]);
  });
});
