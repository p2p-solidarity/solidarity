import { describe, expect, it } from 'bun:test';

import { parseDidPointer, parseDidPointerRecords } from '../src';
import vectors from '../vectors/did-pointer.json';

describe('DID retrieval-pointer grammar vectors', () => {
  for (const testCase of vectors.valid) {
    it(`${testCase.name}: parses a supported pointer`, () => {
      const result = parseDidPointer(testCase.input);

      expect(result).toEqual({
        ok: true,
        value: {
          did: testCase.expectedDid,
          sources: testCase.expectedSources,
        },
      });
    });
  }

  for (const testCase of vectors.invalid) {
    it(`${testCase.name}: rejects malformed pointer data`, () => {
      expect(parseDidPointer(testCase.input)).toEqual({ ok: false, error: 'malformedDid' });
    });
  }

  for (const testCase of vectors.recordSets) {
    it(`${testCase.name}: selects the first non-conflicting parseable record`, () => {
      const result = parseDidPointerRecords(testCase.records);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value?.did).toBe(testCase.expectedDid);
    });
  }

  it('returns null when no TXT records exist', () => {
    expect(parseDidPointerRecords([])).toEqual({ ok: true, value: null });
  });

  it('rejects conflicting parseable TXT records instead of silently choosing one', () => {
    expect(parseDidPointerRecords(vectors.conflictingRecords)).toEqual({
      ok: false,
      error: 'conflictingRecords',
    });
  });
});
