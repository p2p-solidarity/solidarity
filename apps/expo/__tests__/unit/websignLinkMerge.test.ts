/**
 * webSign scope-aware review (src/websign/appSigner.ts) — the website edits a
 * PROJECTION of the local profile, never the full record, so:
 *   - the consent diff is computed against the projection the website could
 *     see (`visibleProjection`): links outside the request's scope are not
 *     reported as removed;
 *   - `mergeWebSignedLinks` folds the approved draft back into the FULL
 *     profile, keeping every link the website never saw with its tier, and
 *     keeping each draft link's existing tier when the scope still shows it;
 *   - a request with no `scope` is treated as `'full'` (every omission real);
 *   - the signed Page layout is diffed (items + a whole-page changed flag);
 *   - `reviewWebSignRequest` exposes the scope, the diff, and the merge.
 * Drives the seam with an in-memory session signer — no RN, no Face ID.
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  computeWebSignDiff,
  mergeWebSignedLinks,
  reviewWebSignRequest,
  visibleProjection,
  visibleScopeOf,
} from '../../src/websign/appSigner';
import type { LocalProfile } from '../../src/profile/projection';
import {
  buildWebSignRequest,
  didKeyFromPublicKey,
  hexToBytes,
  publicKeyFromPrivate,
  signWebSignRequest,
  type ProfileRecord,
  type PublicPageDesign,
  type Signer,
} from '@solidarity/shared';

const ROOT_DID = didKeyFromPublicKey(publicKeyFromPrivate(hexToBytes('11'.repeat(32))));
const sessionScalar = hexToBytes('22'.repeat(32));
const SESSION_DID = didKeyFromPublicKey(publicKeyFromPrivate(sessionScalar));
const sessionSigner: Signer = async (digest) => p256.sign(digest, sessionScalar, { prehash: false });

const IAT = 1_700_000_000;
const NOW_MS = (IAT + 10) * 1000;

const A = { label: 'Web', url: 'https://alice.example' };
const B = { label: 'Team chat', url: 'https://chat.example/alice' };
const C = { label: 'Home number', url: 'https://tel.example/alice' };
const D = { label: 'GitHub', url: 'https://github.com/alice' };

const full: ProfileRecord = {
  v: 1,
  did: ROOT_DID,
  displayName: 'Alice',
  avatar: null,
  bio: 'hello',
  links: [A, B, C],
  alsoKnownAs: ['nostr:npub1alice'],
  badges: [],
  supersededBy: null,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/** A public / link-only / private link, as the local profile stores them. */
const local: LocalProfile = { record: full, linkVisibility: ['public', 'link-only', 'private'] };

function draftAt(scope: ProfileRecord['scope'], links: ProfileRecord['links'], extra: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    ...full,
    links,
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...(scope === undefined ? {} : { scope }),
    ...extra,
  };
}

const APPEARANCE: PublicPageDesign['appearance'] = {
  template: 'cream',
  font: 'sans',
  background: 'cream',
  customBackground: null,
  showBrand: true,
  footerText: '',
};

function pageWith(
  items: readonly { readonly id: string; readonly title: string; readonly url?: string }[],
  template: PublicPageDesign['appearance']['template'] = 'cream'
): PublicPageDesign {
  return {
    blocks: [
      { id: 'links', type: 'links', title: 'Links', items: [], style: 'list', visible: true, order: 0 },
      { id: 'shop', type: 'shop', title: 'Shop', items: items.map((item) => ({ ...item })), style: 'list', visible: true, order: 1 },
    ],
    appearance: { ...APPEARANCE, template },
  };
}

async function requestFor(draft: ProfileRecord): Promise<string> {
  const request = buildWebSignRequest({
    requestId: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url'),
    nonce: Buffer.from(new Uint8Array(16).fill(9)).toString('base64url'),
    originHint: 'https://creds.id',
    webSessionDid: SESSION_DID,
    draft,
    iat: IAT,
    exp: IAT + 120,
  });
  return signWebSignRequest(request, SESSION_DID, sessionSigner);
}

describe('visibleScopeOf / visibleProjection', () => {
  it('defaults a scope-less draft to full and projects the local profile at the draft scope', () => {
    expect(visibleScopeOf(draftAt(undefined, []))).toBe('full');
    expect(visibleScopeOf(draftAt('public', []))).toBe('public');
    expect(visibleProjection(null, draftAt('public', []))).toBeNull();
    expect(visibleProjection(local, draftAt('public', []))?.links).toEqual([A]);
    expect(visibleProjection(local, draftAt('shared', []))?.links).toEqual([A, B]);
    expect(visibleProjection(local, draftAt(undefined, []))?.links).toEqual([A, B, C]);
  });

  it('diffing against the projection hides links the website never saw; diffing against the full record would not', () => {
    const draft = draftAt('public', [{ ...A, label: 'Homepage' }, D]);
    const againstProjection = computeWebSignDiff(visibleProjection(local, draft), draft);
    expect(againstProjection.links.removed).toEqual([]);
    expect(againstProjection.links.added).toEqual([D]);
    expect(againstProjection.links.changed).toEqual([{ url: A.url, before: 'Web', after: 'Homepage' }]);

    const againstFull = computeWebSignDiff(full, draft);
    expect(againstFull.links.removed).toEqual([B, C]);
  });
});

describe('mergeWebSignedLinks', () => {
  it('keeps every link outside a public-scope request with its tier, after the draft links', () => {
    const merge = mergeWebSignedLinks(local, draftAt('public', [{ ...A, label: 'Homepage' }, D]));
    expect(merge.links).toEqual([{ ...A, label: 'Homepage' }, D, B, C]);
    expect(merge.linkVisibility).toEqual(['public', 'public', 'link-only', 'private']);
    expect(merge.preserved).toEqual([B, C]);
  });

  it('under a shared-scope request only private links are outside the scope', () => {
    const merge = mergeWebSignedLinks(local, draftAt('shared', [A, B]));
    expect(merge.links).toEqual([A, B, C]);
    expect(merge.linkVisibility).toEqual(['public', 'link-only', 'private']);
    expect(merge.preserved).toEqual([C]);
  });

  it('a scope-less (full) request saw every link, so omitted links are really removed', () => {
    const merge = mergeWebSignedLinks(local, draftAt(undefined, [A]));
    expect(merge.links).toEqual([A]);
    expect(merge.linkVisibility).toEqual(['public']);
    expect(merge.preserved).toEqual([]);
  });

  it('a link the website (re)added that the scope would hide gets the narrowest tier the scope shows', () => {
    // C is private locally; the website put it on the public page → public.
    // B (link-only) was still outside the public scope, so it is preserved after them.
    const pub = mergeWebSignedLinks(local, draftAt('public', [A, C]));
    expect(pub.links).toEqual([A, C, B]);
    expect(pub.linkVisibility).toEqual(['public', 'public', 'link-only']);
    expect(pub.preserved).toEqual([B]);
    // Under a shared-scope request the least exposure that still shows it is link-only,
    // and B was visible to the website, so its omission is a real removal.
    const shared = mergeWebSignedLinks(local, draftAt('shared', [A, C]));
    expect(shared.linkVisibility).toEqual(['public', 'link-only']);
    expect(shared.preserved).toEqual([]);
  });

  it('a draft link the scope already shows keeps its existing tier', () => {
    const merge = mergeWebSignedLinks(local, draftAt('shared', [B, A]));
    expect(merge.linkVisibility).toEqual(['link-only', 'public', 'private']);
    expect(merge.links).toEqual([B, A, C]);
  });

  it('with no local profile every draft link is public and nothing is preserved', () => {
    const merge = mergeWebSignedLinks(null, draftAt('public', [A, D]));
    expect(merge).toEqual({ links: [A, D], linkVisibility: ['public', 'public'], preserved: [] });
  });

  it('a short or absent visibility array means public, matching the store default', () => {
    const untagged: LocalProfile = { record: full, linkVisibility: [] };
    const merge = mergeWebSignedLinks(untagged, draftAt('public', [A]));
    expect(merge.links).toEqual([A]);
    expect(merge.preserved).toEqual([]);
  });
});

describe('computeWebSignDiff — signed Page layout', () => {
  const current: ProfileRecord = { ...full, page: pageWith([{ id: 'i1', title: 'Print', url: 'https://shop.example/print' }]) };

  it('reports items a request adds or removes', () => {
    const draft: ProfileRecord = {
      ...current,
      page: pageWith([{ id: 'i2', title: 'Poster', url: 'https://shop.example/poster' }]),
    };
    const diff = computeWebSignDiff(current, draft);
    expect(diff.page.changed).toBe(true);
    expect(diff.page.added).toEqual([{ title: 'Poster', url: 'https://shop.example/poster' }]);
    expect(diff.page.removed).toEqual([{ title: 'Print', url: 'https://shop.example/print' }]);
    expect(diff.hasChanges).toBe(true);
  });

  it('flags a layout-only change (no item changes) so it still needs consent', () => {
    const draft: ProfileRecord = { ...current, page: pageWith([{ id: 'i1', title: 'Print', url: 'https://shop.example/print' }], 'ink') };
    const diff = computeWebSignDiff(current, draft);
    expect(diff.page).toEqual({ changed: true, added: [], removed: [] });
    expect(diff.hasChanges).toBe(true);
  });

  it('an identical page is unchanged, and a request that drops the page entirely is a change', () => {
    expect(computeWebSignDiff(current, { ...current }).page).toEqual({ changed: false, added: [], removed: [] });
    expect(computeWebSignDiff(current, { ...current }).hasChanges).toBe(false);
    const dropped = computeWebSignDiff(current, full);
    expect(dropped.page.changed).toBe(true);
    expect(dropped.page.removed).toEqual([{ title: 'Print', url: 'https://shop.example/print' }]);
  });
});

describe('reviewWebSignRequest — scope-aware review', () => {
  it('exposes the request scope, a projection-based diff, and the full-profile merge', async () => {
    const draft = draftAt('public', [{ ...A, label: 'Homepage' }, D]);
    const reviewed = reviewWebSignRequest(await requestFor(draft), {
      currentRecord: full,
      currentLinkVisibility: ['public', 'link-only', 'private'],
      nowMs: NOW_MS,
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    expect(reviewed.value.scope).toBe('public');
    expect(reviewed.value.diff.links.removed).toEqual([]);
    expect(reviewed.value.diff.links.added).toEqual([D]);
    expect(reviewed.value.merge.preserved).toEqual([B, C]);
    expect(reviewed.value.merge.links).toEqual([{ ...A, label: 'Homepage' }, D, B, C]);
  });

  it('without a visibility array every local link counts as public — nothing is preserved, omissions show as removed', async () => {
    const draft = draftAt('public', [A]);
    const reviewed = reviewWebSignRequest(await requestFor(draft), { currentRecord: full, nowMs: NOW_MS });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    expect(reviewed.value.diff.links.removed).toEqual([B, C]);
    expect(reviewed.value.merge.preserved).toEqual([]);
    expect(reviewed.value.merge.links).toEqual([A]);
  });
});
