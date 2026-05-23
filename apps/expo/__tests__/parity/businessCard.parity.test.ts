/**
 * Parity test — BusinessCard JSON wire format.
 *
 * Asserts the Zod 4 schema in @solidarity/shared accepts a JSON blob
 * produced by Swift's JSONEncoder (sorted keys, secondsSince1970 dates)
 * without losing any field. Mirror failure modes:
 *   - new Swift field added but not in Zod schema → schema throws
 *   - field rename → schema throws (good — catches wire breaks early)
 *   - enum rawValue drift (e.g. animal "sheep" → "ewe") → schema throws
 *
 * Run:
 *   cd apps/expo && bun test __tests__/parity/businessCard.parity.test.ts
 */
import { describe, expect, it } from 'bun:test';

import { businessCardSchema } from '@solidarity/shared';

import fixture from '../../../../packages/parity-fixtures/fixtures/types/business_card_round_trip.json' assert { type: 'json' };

const { json } = fixture as { readonly json: string };

describe('BusinessCard parity: Swift Codable ↔ Zod 4', () => {
  it('parses Swift-encoded JSON without loss', () => {
    const decoded = JSON.parse(json) as unknown;
    const parsed = businessCardSchema.parse(decoded);
    expect(parsed.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(parsed.name).toBe('Ada Lovelace');
    expect(parsed.animal).toBe('sheep');
    expect(parsed.nameType).toBe('display_name');
    expect(parsed.sharingPreferences.sharingFormat).toBe('didSigned');
  });
});
