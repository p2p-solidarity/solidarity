import { describe, expect, it } from 'bun:test';

import { shouldAutoRepublish } from '../../src/profile/publishingPolicy';

describe('shouldAutoRepublish', () => {
  it('never turns a local-only page into a public page', () => {
    expect(shouldAutoRepublish(false, true)).toBe(false);
  });

  it('re-publishes an already-public page only after explicit opt-in', () => {
    expect(shouldAutoRepublish(true, false)).toBe(false);
    expect(shouldAutoRepublish(true, true)).toBe(true);
  });
});
