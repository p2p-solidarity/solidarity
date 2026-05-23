/**
 * vCard 3.0 serializer — mirrors solidarity/Models/BusinessCard+Extensions.swift
 * `var vCardData: String`. We test that `toVCard()` produces output the
 * existing `parseVCard()` can roundtrip back without losing the fields it
 * preserves. Newly-ported area: the Share tab encodes the user's BusinessCard
 * as a vCard before stuffing it into the QR payload.
 *
 * Spec source: Swift emits these line patterns (no blank lines for missing
 * optional fields — that's the parity bug we guard against here):
 *   BEGIN:VCARD
 *   VERSION:3.0
 *   FN:<name>
 *   TITLE:<title>           ← only if non-empty
 *   ORG:<company>           ← only if non-empty
 *   EMAIL:<email>           ← only if non-empty (Swift uses bare EMAIL: ; TS adds ;TYPE=INTERNET)
 *   TEL:<phone>             ← only if non-empty
 *   URL:<url>               ← one line per non-empty social url (Swift)
 *   END:VCARD
 */
import { describe, expect, it } from 'bun:test';

import { parseVCard, type BusinessCard } from '@solidarity/shared';

import { toVCard } from '../../src/cards/vCard';

const baseSharingPrefs = {
  publicFields: new Set(['name']),
  professionalFields: new Set(['name']),
  personalFields: new Set(['name']),
  allowForwarding: true,
  useZK: false,
  sharingFormat: 'didSigned' as const,
};

function makeCard(overrides: Partial<BusinessCard> = {}): BusinessCard {
  const now = new Date('2025-01-01T00:00:00Z');
  return {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    name: 'Ada Lovelace',
    title: undefined,
    company: undefined,
    email: undefined,
    phone: undefined,
    profileImage: undefined,
    animal: undefined,
    socialNetworks: [],
    skills: [],
    categories: [],
    sharingPreferences: baseSharingPrefs,
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as BusinessCard;
}

describe('toVCard (vCard 3.0 serializer)', () => {
  it('always emits the BEGIN/VERSION/FN/END skeleton', () => {
    const v = toVCard(makeCard());
    const lines = v.split('\n');
    expect(lines[0]).toBe('BEGIN:VCARD');
    expect(lines[1]).toBe('VERSION:3.0');
    expect(lines[2]).toBe('FN:Ada Lovelace');
    expect(lines[lines.length - 1]).toBe('END:VCARD');
  });

  it('omits TEL line when phone is missing (no empty trailing colon)', () => {
    const v = toVCard(makeCard({ phone: undefined }));
    expect(v).not.toMatch(/^TEL:?\s*$/m);
    expect(v).not.toContain('TEL:');
  });

  it('omits EMAIL line when email is missing', () => {
    const v = toVCard(makeCard({ email: undefined }));
    expect(v).not.toContain('EMAIL');
  });

  it('omits TITLE / ORG when those fields are missing', () => {
    const v = toVCard(makeCard({ title: undefined, company: undefined }));
    expect(v).not.toContain('TITLE:');
    expect(v).not.toContain('ORG:');
  });

  it('emits TITLE / ORG / EMAIL / TEL when populated', () => {
    const v = toVCard(
      makeCard({
        title: 'Founder',
        company: 'Solidarity',
        email: 'ada@solidarity.gg',
        phone: '+15550100',
      })
    );
    expect(v).toContain('TITLE:Founder');
    expect(v).toContain('ORG:Solidarity');
    expect(v).toContain('EMAIL');
    expect(v).toContain('ada@solidarity.gg');
    expect(v).toContain('TEL');
    expect(v).toContain('+15550100');
  });

  it('escapes special vCard characters (\\, comma, semicolon, newline)', () => {
    const v = toVCard(
      makeCard({
        company: 'A, B; C\\D\ne',
      })
    );
    // Order in escape(): \\ first, then \n, then , , then ; .
    expect(v).toContain('ORG:A\\, B\\; C\\\\D\\ne');
  });

  it('produces parser-roundtrippable output for the canonical fields', () => {
    const v = toVCard(
      makeCard({
        title: 'Founder',
        company: 'Solidarity',
        email: 'ada@solidarity.gg',
        phone: '+15550100',
      })
    );
    // The parser accepts \n or \r\n line breaks; toVCard uses \n.
    const parsed = parseVCard(v);
    expect(parsed).not.toBeNull();
    expect(parsed?.fullName).toBe('Ada Lovelace');
    expect(parsed?.title).toBe('Founder');
    expect(parsed?.organization).toBe('Solidarity');
    expect(parsed?.emails).toContain('ada@solidarity.gg');
    expect(parsed?.phones).toContain('+15550100');
  });

  it('round-trips a minimal name-only card without spurious empty fields', () => {
    const v = toVCard(makeCard({ name: 'Bob' }));
    const parsed = parseVCard(v);
    expect(parsed?.fullName).toBe('Bob');
    expect(parsed?.emails).toEqual([]);
    expect(parsed?.phones).toEqual([]);
    expect(parsed?.organization).toBeUndefined();
    expect(parsed?.title).toBeUndefined();
  });
});
