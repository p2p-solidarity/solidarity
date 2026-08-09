import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  buildContactFromReceivedCard,
  presentReceivedCard,
  useReceivedCard,
} from '../../src/cards/receivedCard';
import type { BusinessCard } from '@solidarity/shared';

const CARD_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

function makeCard(): BusinessCard {
  const now = new Date('2026-08-09T00:00:00.000Z');
  return {
    id: CARD_ID,
    name: 'Ada',
    email: 'ada@example.com',
    phone: '+1-555-0101',
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

afterEach(() => {
  useReceivedCard.getState().dismiss();
});

describe('received scanned card metadata', () => {
  it('preserves verified QR provenance and sealed route through contact creation', () => {
    const card = makeCard();
    presentReceivedCard({
      card,
      verificationStatus: 'Verified',
      source: 'QR Code',
      sealedRoute: 'sealed-route-1',
    });

    const state = useReceivedCard.getState();
    expect(state.card).toBe(card);
    expect(state.verificationStatus).toBe('Verified');
    expect(state.source).toBe('QR Code');
    expect(state.sealedRoute).toBe('sealed-route-1');

    const receivedAt = new Date('2026-08-09T12:00:00.000Z');
    expect(
      buildContactFromReceivedCard({
        id: CONTACT_ID,
        card,
        receivedAt,
        verificationStatus: state.verificationStatus,
        source: state.source,
        sealedRoute: state.sealedRoute,
      }),
    ).toMatchObject({
      id: CONTACT_ID,
      businessCard: card,
      receivedAt,
      source: 'QR Code',
      verificationStatus: 'Verified',
      sealedRoute: 'sealed-route-1',
    });
  });

  it('does not promote a failed scan while building the saved contact', () => {
    const contact = buildContactFromReceivedCard({
      id: CONTACT_ID,
      card: makeCard(),
      receivedAt: new Date('2026-08-09T12:00:00.000Z'),
      verificationStatus: 'Failed',
      source: 'QR Code',
    });

    expect(contact.verificationStatus).toBe('Failed');
    expect(contact.source).toBe('QR Code');
    expect(contact.sealedRoute).toBeUndefined();
  });

  it('wires scanner metadata into the received model and removes hardcoded save metadata', () => {
    const scan = readFileSync(new URL('../../app/scan/index.tsx', import.meta.url), 'utf8');
    const sheet = readFileSync(
      new URL('../../src/components/cards/ReceivedCardSheet.tsx', import.meta.url),
      'utf8',
    );

    expect(scan).toContain('presentReceivedCard({');
    expect(scan).toContain("source: 'QR Code'");
    expect(scan).toContain('sealedRoute: outcome.sealedRoute');
    expect(sheet).toContain('buildContactFromReceivedCard({');
    expect(sheet).not.toContain("source: 'Proximity'");
    expect(sheet).not.toContain("verificationStatus: 'Unverified'");
    expect(sheet).not.toContain("verificationStatus = 'Unverified'");
    expect(sheet).toContain("t('receivedCard.saveFailed')");
    expect(sheet).toContain('verificationStatusKey(status)');
    expect(sheet).not.toContain('withRepeat');
  });
});
