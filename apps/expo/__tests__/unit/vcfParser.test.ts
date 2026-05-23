/**
 * vCard parser — covers the field shapes Solidarity actually imports.
 */
import { describe, expect, it } from 'bun:test';

import { parseVCard, parseVCardBundle } from '@solidarity/shared';

const SIMPLE = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Lovelace;Ada;;;',
  'FN:Ada Lovelace',
  'EMAIL:ada@solidarity.gg',
  'TEL:+15550100',
  'ORG:Solidarity',
  'TITLE:Founder',
  'NOTE:Counts on her fingers in binary.',
  'END:VCARD',
].join('\r\n');

describe('parseVCard', () => {
  it('extracts the basic fields', () => {
    const card = parseVCard(SIMPLE);
    expect(card?.fullName).toBe('Ada Lovelace');
    expect(card?.givenName).toBe('Ada');
    expect(card?.familyName).toBe('Lovelace');
    expect(card?.emails).toEqual(['ada@solidarity.gg']);
    expect(card?.phones).toEqual(['+15550100']);
    expect(card?.organization).toBe('Solidarity');
    expect(card?.title).toBe('Founder');
  });

  it('returns null on non-vCard input', () => {
    expect(parseVCard('just a string')).toBeNull();
  });

  it('parses a bundle of multiple cards', () => {
    const bundle = [SIMPLE, SIMPLE].join('\r\n');
    const cards = parseVCardBundle(bundle);
    expect(cards.length).toBe(2);
    expect(cards[0]?.fullName).toBe('Ada Lovelace');
  });

  it('handles folded lines (continuation with leading space)', () => {
    const folded = [
      'BEGIN:VCARD',
      'FN:Ada',
      ' Lovelace',
      'EMAIL:ada@example.com',
      'END:VCARD',
    ].join('\r\n');
    const card = parseVCard(folded);
    expect(card?.fullName).toBe('AdaLovelace');
  });
});
