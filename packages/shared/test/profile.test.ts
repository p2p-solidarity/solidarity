/**
 * profile.ts — Profile Record schema (01-spec §3) round trip: a valid
 * shape parses to a `ProfileRecord`; any structural deviation (wrong
 * literal `v`, missing field, wrong type, unrecognized extra key,
 * malformed `updatedAt`) is rejected via `Result`, never thrown. Plus
 * consumption of the frozen conformance vectors in ../vectors/profile.json
 * — including the one-way `alsoKnownAs` vector, which documents that
 * schema validity and badge-verified reverse-binding are different
 * concerns (see profile.ts module docstring) — and the oversize vector
 * consumed jointly by fragment.test.ts to prove `encodeFragment`'s
 * `oversize` flag actually trips for a realistic large profile.
 */
import { describe, expect, test } from 'bun:test';

import { parseProfile, profileRecordSchema, type ProfileRecord } from '../src/profile';
import vectors from '../vectors/profile.json';

function baseProfile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    v: 1,
    did: 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN',
    displayName: 'Alice',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-03T00:00:00Z',
    ...overrides,
  };
}

describe('parseProfile', () => {
  test('accepts a minimal well-formed profile', () => {
    const result = parseProfile(baseProfile());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.displayName).toBe('Alice');
  });

  test('accepts a fully-populated profile (links/alsoKnownAs/badges non-empty, avatar url, supersededBy set)', () => {
    const full = baseProfile({
      avatar: 'https://example.com/avatar.png',
      bio: 'hello world',
      links: [{ label: 'Website', url: 'https://example.com' }],
      alsoKnownAs: ['dns:example.com', 'at://alice.bsky.social'],
      badges: [{ type: 'dns', subject: 'example.com', attestation: 'inline:...' }],
      supersededBy: 'did:key:zDnaeaQHQpDWivip1SugnEwZaF5JUCmSyPrYewToLKYmv8CyV',
    });
    const result = parseProfile(full);
    expect(result.ok).toBe(true);
  });

  test('accepts a bounded, signed public Page layout alongside the profile', () => {
    const result = parseProfile(baseProfile({
      page: {
        blocks: [
          {
            id: 'links',
            type: 'links',
            title: 'Links',
            items: [],
            style: 'list',
            visible: true,
            order: 0,
          },
          {
            id: 'portfolio-1',
            type: 'portfolio',
            title: 'Selected work',
            items: [{ id: 'work-1', title: 'Book cover', url: 'https://example.com/work' }],
            style: 'grid',
            visible: true,
            order: 1,
          },
        ],
        appearance: {
          template: 'mint',
          font: 'serif',
          background: 'mint',
          customBackground: null,
          showBrand: true,
          footerText: '',
        },
      },
    }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.page?.blocks[1]?.title).toBe('Selected work');
  });

  test('rejects malformed public Page layouts before they can be signed or rendered', () => {
    const invalidLink = parseProfile(baseProfile({
      page: {
        blocks: [
          {
            id: 'links',
            type: 'links',
            title: 'Links',
            items: [{ id: 'bad', title: 'Bad', url: 'javascript:alert(1)' }],
            style: 'list',
            visible: true,
            order: 0,
          },
        ],
        appearance: {
          template: 'cream',
          font: 'sans',
          background: 'cream',
          customBackground: null,
          showBrand: true,
          footerText: '',
        },
      },
    }));
    const duplicateLinks = parseProfile(baseProfile({
      page: {
        blocks: [
          {
            id: 'links',
            type: 'links',
            title: 'Links',
            items: [],
            style: 'list',
            visible: true,
            order: 0,
          },
          {
            id: 'links-2',
            type: 'links',
            title: 'More links',
            items: [],
            style: 'list',
            visible: true,
            order: 1,
          },
        ],
        appearance: {
          template: 'cream',
          font: 'sans',
          background: 'cream',
          customBackground: null,
          showBrand: true,
          footerText: '',
        },
      },
    }));

    expect(invalidLink.ok).toBe(false);
    if (!invalidLink.ok) expect(invalidLink.error).toContain('page.blocks.0.items.0.url');
    expect(duplicateLinks.ok).toBe(false);
    if (!duplicateLinks.ok) expect(duplicateLinks.error).toContain('page');
  });

  test('rejects wrong literal v', () => {
    const result = parseProfile(baseProfile({ v: 2 as unknown as 1 }));
    expect(result.ok).toBe(false);
  });

  test('rejects a missing required field (did)', () => {
    const bad = baseProfile() as Record<string, unknown>;
    delete bad.did;
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
  });

  test('rejects an unrecognized extra top-level key (e.g. a reintroduced recoveryKey field)', () => {
    const bad = { ...baseProfile(), recoveryKey: 'should-not-exist' };
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
  });

  test('rejects a malformed updatedAt (not ISO8601 Z)', () => {
    const result = parseProfile(baseProfile({ updatedAt: 'not-a-date' }));
    expect(result.ok).toBe(false);
  });

  test('rejects a link missing url', () => {
    const bad = baseProfile({ links: [{ label: 'no url' } as unknown as { label: string; url: string }] });
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
  });

  test('rejects a link url with a javascript: scheme (must never render as a clickable anchor)', () => {
    const bad = baseProfile({ links: [{ label: 'evil', url: 'javascript:alert(1)' }] });
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('links.0.url');
  });

  test('rejects a link url with a data: scheme', () => {
    const bad = baseProfile({ links: [{ label: 'evil', url: 'data:text/html,<script>alert(1)</script>' }] });
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('links.0.url');
  });

  test('rejects a link url with leading whitespace (no silent trim)', () => {
    const bad = baseProfile({ links: [{ label: 'sneaky', url: ' https://example.com' }] });
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('links.0.url');
  });

  test('rejects a link url with trailing whitespace (no silent trim)', () => {
    const bad = baseProfile({ links: [{ label: 'sneaky', url: 'https://example.com ' }] });
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('links.0.url');
  });

  test('accepts a link url with a plain http:// scheme (not just https://)', () => {
    const result = parseProfile(baseProfile({ links: [{ label: 'old site', url: 'http://example.net' }] }));
    expect(result.ok).toBe(true);
  });

  test('accepts a link url with an https:// scheme', () => {
    const result = parseProfile(baseProfile({ links: [{ label: 'site', url: 'https://example.com' }] }));
    expect(result.ok).toBe(true);
  });

  test('rejects a badge missing attestation', () => {
    const bad = baseProfile({
      badges: [{ type: 'dns', subject: 'example.com' } as unknown as {
        type: string;
        subject: string;
        attestation: string;
      }],
    });
    const result = parseProfile(bad);
    expect(result.ok).toBe(false);
  });

  test('accepts a one-way alsoKnownAs claim with no corresponding badge — schema validity is not badge verification', () => {
    const result = parseProfile(
      baseProfile({ alsoKnownAs: ['dns:unverified-claim.example'], badges: [] })
    );
    expect(result.ok).toBe(true);
  });

  // ── T7: optional `scope` projection field ─────────────────────────────
  test('accepts an absent scope (back-compat — absent means full)', () => {
    const result = parseProfile(baseProfile());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scope).toBeUndefined();
  });

  test.each(['public', 'shared', 'full'] as const)('accepts scope: %s', (scope) => {
    const result = parseProfile(baseProfile({ scope }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.scope).toBe(scope);
  });

  test('rejects an unknown scope value (fails closed, does not silently accept)', () => {
    const result = parseProfile(baseProfile({ scope: 'secret' as unknown as 'full' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('scope');
  });

  test('never throws on garbage input', () => {
    expect(() => parseProfile(null)).not.toThrow();
    expect(() => parseProfile(undefined)).not.toThrow();
    expect(() => parseProfile('not an object')).not.toThrow();
    expect(() => parseProfile(42)).not.toThrow();
    expect(() => parseProfile([])).not.toThrow();
  });
});

describe('profile.json conformance vectors', () => {
  for (const v of vectors.valid) {
    test(`valid: ${v.name}`, () => {
      const result = parseProfile(v.profile);
      expect(result.ok).toBe(true);
    });
  }

  for (const v of vectors.invalid) {
    test(`invalid: ${v.name}`, () => {
      const result = parseProfile(v.profile);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(v.errorContains);
    });
  }
});

describe('profileRecordSchema export', () => {
  test('is usable directly with zod safeParse (exported for reuse, not just parseProfile)', () => {
    expect(profileRecordSchema.safeParse(baseProfile()).success).toBe(true);
  });
});
