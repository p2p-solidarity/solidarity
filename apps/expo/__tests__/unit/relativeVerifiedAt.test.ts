/**
 * verifiedAtRelative — pure bucketing math backing the People tab's
 * "Verified Pages" section relative-time label (Task A2.3b,
 * apps/expo/src/people/relativeVerifiedAt.ts).
 */
import { describe, expect, it } from 'bun:test';

import { verifiedAtRelative } from '../../src/people/relativeVerifiedAt';

const NOW = Date.parse('2026-07-03T12:00:00Z');

describe('verifiedAtRelative', () => {
  it('buckets under a minute as justNow', () => {
    expect(verifiedAtRelative('2026-07-03T11:59:31Z', NOW)).toEqual({ unit: 'justNow', count: 0 });
  });

  it('buckets whole minutes under an hour', () => {
    expect(verifiedAtRelative('2026-07-03T11:55:00Z', NOW)).toEqual({ unit: 'minutes', count: 5 });
  });

  it('buckets whole hours under a day', () => {
    expect(verifiedAtRelative('2026-07-03T09:00:00Z', NOW)).toEqual({ unit: 'hours', count: 3 });
  });

  it('buckets whole days beyond a day', () => {
    expect(verifiedAtRelative('2026-06-30T12:00:00Z', NOW)).toEqual({ unit: 'days', count: 3 });
  });

  it('clamps a same-instant timestamp to justNow', () => {
    expect(verifiedAtRelative('2026-07-03T12:00:00Z', NOW)).toEqual({ unit: 'justNow', count: 0 });
  });

  it('clamps a future timestamp to justNow rather than a negative count', () => {
    expect(verifiedAtRelative('2026-07-03T12:05:00Z', NOW)).toEqual({ unit: 'justNow', count: 0 });
  });

  it('clamps an unparseable timestamp to justNow rather than throwing', () => {
    expect(verifiedAtRelative('not-a-date', NOW)).toEqual({ unit: 'justNow', count: 0 });
  });

  it('defaults `now` to the current time when omitted', () => {
    const justHappened = new Date().toISOString();
    expect(verifiedAtRelative(justHappened)).toEqual({ unit: 'justNow', count: 0 });
  });
});
