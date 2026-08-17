/**
 * projection.ts (T7) — three-tier link visibility → public/shared/full
 * projections of a local profile. Pure, no store, no signing; this suite pins
 * the filtering + scope-stamp contract the store's Face-ID signer builds on.
 */
import { describe, expect, it } from 'bun:test';

import {
  buildProjection,
  normalizeLinkVisibility,
  scopeIncludes,
  summarizeVisibility,
  visibilityAt,
  type LinkVisibility,
  type LocalProfile,
} from '@/profile/projection';
import type { ProfileRecord } from '@solidarity/shared';

const LINKS = [
  { label: 'Public', url: 'https://public.example' },
  { label: 'LinkOnly', url: 'https://linkonly.example' },
  { label: 'Private', url: 'https://private.example' },
];

function localProfile(
  visibility: readonly LinkVisibility[],
  recordOverrides: Partial<ProfileRecord> = {}
): LocalProfile {
  return {
    record: {
      v: 1,
      did: 'did:key:zAlice',
      displayName: 'Alice',
      avatar: null,
      bio: 'hi',
      links: LINKS,
      alsoKnownAs: ['nostr:npub1alice', 'at://alice.bsky.social'],
      badges: [{ type: 'dns', subject: 'alice.example', attestation: 'inline:x' }],
      supersededBy: null,
      updatedAt: '2026-07-03T00:00:00Z',
      ...recordOverrides,
    },
    linkVisibility: visibility,
  };
}

describe('buildProjection — link filtering by scope', () => {
  const local = localProfile(['public', 'link-only', 'private']);

  it('public → public links only, scope stamped', () => {
    const projected = buildProjection(local, 'public');
    expect(projected.scope).toBe('public');
    expect(projected.links.map((l) => l.url)).toEqual(['https://public.example']);
  });

  it('shared → public + link-only links, scope stamped', () => {
    const projected = buildProjection(local, 'shared');
    expect(projected.scope).toBe('shared');
    expect(projected.links.map((l) => l.url)).toEqual([
      'https://public.example',
      'https://linkonly.example',
    ]);
  });

  it('full → all links, scope stamped', () => {
    const projected = buildProjection(local, 'full');
    expect(projected.scope).toBe('full');
    expect(projected.links.map((l) => l.url)).toEqual([
      'https://public.example',
      'https://linkonly.example',
      'https://private.example',
    ]);
  });

  it('copies every non-link identity field verbatim into each projection (only links are filtered)', () => {
    for (const scope of ['public', 'shared', 'full'] as const) {
      const projected = buildProjection(local, scope);
      expect(projected.displayName).toBe('Alice');
      expect(projected.avatar).toBeNull();
      expect(projected.bio).toBe('hi');
      expect(projected.updatedAt).toBe('2026-07-03T00:00:00Z');
      // Bindings + badges are identity-level → present in every projection.
      expect(projected.alsoKnownAs).toEqual(['nostr:npub1alice', 'at://alice.bsky.social']);
      expect(projected.badges).toHaveLength(1);
    }
  });

  it('is deterministic — same input yields byte-identical output', () => {
    expect(JSON.stringify(buildProjection(local, 'shared'))).toBe(
      JSON.stringify(buildProjection(local, 'shared'))
    );
  });

  it('does not mutate the source record', () => {
    const before = JSON.stringify(local.record);
    buildProjection(local, 'public');
    expect(JSON.stringify(local.record)).toBe(before);
  });
});

describe('buildProjection — visibility defaults (back-compat)', () => {
  it('an untagged link (missing/short visibility array) defaults to public', () => {
    const local = localProfile([]); // no visibility entries at all
    expect(buildProjection(local, 'public').links.map((l) => l.url)).toEqual([
      'https://public.example',
      'https://linkonly.example',
      'https://private.example',
    ]);
    // A partial array: only the first link tagged; the rest default to public.
    const partial = localProfile(['private']);
    expect(buildProjection(partial, 'public').links.map((l) => l.url)).toEqual([
      'https://linkonly.example',
      'https://private.example',
    ]);
  });
});

describe('scopeIncludes / visibilityAt / normalizeLinkVisibility', () => {
  it('scopeIncludes encodes the inclusion table', () => {
    expect(scopeIncludes('public', 'public')).toBe(true);
    expect(scopeIncludes('public', 'link-only')).toBe(false);
    expect(scopeIncludes('public', 'private')).toBe(false);
    expect(scopeIncludes('shared', 'link-only')).toBe(true);
    expect(scopeIncludes('shared', 'private')).toBe(false);
    expect(scopeIncludes('full', 'private')).toBe(true);
  });

  it('visibilityAt defaults out-of-range/missing entries to public', () => {
    expect(visibilityAt(['private'], 0)).toBe('private');
    expect(visibilityAt(['private'], 5)).toBe('public');
    expect(visibilityAt([], 0)).toBe('public');
  });

  it('normalizeLinkVisibility yields exactly one entry per link, defaulting to public', () => {
    expect(normalizeLinkVisibility(LINKS, ['private'])).toEqual(['private', 'public', 'public']);
    expect(normalizeLinkVisibility(LINKS, undefined)).toEqual(['public', 'public', 'public']);
    // Extra provided entries beyond `links.length` are dropped.
    expect(normalizeLinkVisibility([{ label: 'a', url: 'https://a' }], ['private', 'link-only'])).toEqual([
      'private',
    ]);
  });
});

describe('summarizeVisibility — pre-publish preview counts', () => {
  it('counts each tier and the total', () => {
    expect(summarizeVisibility(LINKS, ['public', 'link-only', 'private'])).toEqual({
      total: 3,
      public: 1,
      linkOnly: 1,
      private: 1,
    });
  });

  it('treats untagged links as public', () => {
    expect(summarizeVisibility(LINKS, [])).toEqual({ total: 3, public: 3, linkOnly: 0, private: 0 });
  });
});
