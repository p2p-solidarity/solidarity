import { visibilityAt, type LinkVisibility } from '@/profile/projection';
import type { ProfileLink } from '@solidarity/shared';

export interface PageLinkEntry {
  readonly link: ProfileLink;
  readonly sourceIndex: number;
  readonly visibility: LinkVisibility;
}

export interface PageLinkSections {
  readonly publicLinks: readonly PageLinkEntry[];
  readonly cardOnlyLinks: readonly PageLinkEntry[];
  readonly hiddenLinks: readonly PageLinkEntry[];
}

/**
 * Pair links with their original local privacy tier before filtering. Keeping
 * the source index and link reference prevents duplicate URLs from being
 * collapsed and preserves the exact editor order in both Page buckets.
 */
export function pageLinkSections(
  links: readonly ProfileLink[],
  linkVisibility: readonly LinkVisibility[],
): PageLinkSections {
  const entries = links.map((link, sourceIndex): PageLinkEntry => ({
    link,
    sourceIndex,
    visibility: visibilityAt(linkVisibility, sourceIndex),
  }));

  return {
    publicLinks: entries.filter((entry) => entry.visibility === 'public'),
    cardOnlyLinks: entries.filter((entry) => entry.visibility === 'link-only'),
    hiddenLinks: entries.filter((entry) => entry.visibility === 'private'),
  };
}
