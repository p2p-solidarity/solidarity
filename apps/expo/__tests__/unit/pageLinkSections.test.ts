import { describe, expect, it } from 'bun:test';

import { pageLinkSections } from '../../src/components/me/pageLinkSections';
import type { LinkVisibility } from '../../src/profile/projection';
import type { ProfileLink } from '@solidarity/shared';

const LINKS: readonly ProfileLink[] = [
  { label: 'Website', url: 'https://example.com' },
  { label: 'Work', url: 'https://work.example.com' },
  { label: 'Private', url: 'https://private.example.com' },
];

describe('pageLinkSections', () => {
  it('defaults a missing visibility entry to Public Page', () => {
    const sections = pageLinkSections([LINKS[0]!], []);

    expect(sections.publicLinks).toEqual([
      { link: LINKS[0]!, sourceIndex: 0, visibility: 'public' },
    ]);
    expect(sections.cardOnlyLinks).toEqual([]);
  });

  it('keeps public, Card Only, and legacy private links in honest separate buckets', () => {
    const visibility: readonly LinkVisibility[] = ['public', 'link-only', 'private'];
    const sections = pageLinkSections(LINKS, visibility);

    expect(sections.publicLinks.map(({ sourceIndex, visibility: tier }) => [sourceIndex, tier]))
      .toEqual([[0, 'public']]);
    expect(sections.cardOnlyLinks.map(({ sourceIndex, visibility: tier }) => [sourceIndex, tier]))
      .toEqual([[1, 'link-only']]);
    expect(sections.hiddenLinks.map(({ sourceIndex, visibility: tier }) => [sourceIndex, tier]))
      .toEqual([[2, 'private']]);
    expect(sections.hiddenLinks[0]?.visibility).toBe('private');
  });

  it('pairs before filtering so mixed duplicate URLs retain source index, tier, and order', () => {
    const duplicateUrlLinks: readonly ProfileLink[] = [
      { label: 'First', url: 'https://same.example.com' },
      { label: 'Second', url: 'https://same.example.com' },
      { label: 'Third', url: 'https://same.example.com' },
      { label: 'Fourth', url: 'https://fourth.example.com' },
    ];
    const visibility: readonly LinkVisibility[] = ['link-only', 'public', 'private', 'public'];

    const sections = pageLinkSections(duplicateUrlLinks, visibility);

    expect(sections.publicLinks.map(({ link, sourceIndex, visibility: tier }) => ({
      label: link.label,
      sourceIndex,
      tier,
    }))).toEqual([
      { label: 'Second', sourceIndex: 1, tier: 'public' },
      { label: 'Fourth', sourceIndex: 3, tier: 'public' },
    ]);
    expect(sections.cardOnlyLinks.map(({ link, sourceIndex, visibility: tier }) => ({
      label: link.label,
      sourceIndex,
      tier,
    }))).toEqual([{ label: 'First', sourceIndex: 0, tier: 'link-only' }]);
    expect(sections.hiddenLinks.map(({ link, sourceIndex, visibility: tier }) => ({
      label: link.label,
      sourceIndex,
      tier,
    }))).toEqual([{ label: 'Third', sourceIndex: 2, tier: 'private' }]);
    expect(sections.publicLinks[0]?.link).toBe(duplicateUrlLinks[1]);
    expect(sections.cardOnlyLinks[0]?.link).toBe(duplicateUrlLinks[0]);
    expect(sections.hiddenLinks[0]?.link).toBe(duplicateUrlLinks[2]);
  });

  it('does not mutate either input', () => {
    const links = LINKS.map((link) => ({ ...link }));
    const visibility: LinkVisibility[] = ['private', 'public', 'link-only'];
    const linksBefore = structuredClone(links);
    const visibilityBefore = [...visibility];

    pageLinkSections(links, visibility);

    expect(links).toEqual(linksBefore);
    expect(visibility).toEqual(visibilityBefore);
  });
});
