/**
 * The Page tab's verification pill is the page's entire trust claim, so the
 * predicates behind it are held to "prove it, or say nothing".
 */
import { describe, expect, it } from 'bun:test';

import {
  isNostrProfileUrlForNpub,
  recordClaimsAtprotoHandle,
} from '@/components/me/pageRowStyles';

const NPUB = 'npub1exampleexampleexampleexampleexampleexampleexampleexamp';

function parse(href: string): {
  readonly url: URL;
  readonly hostname: string;
  readonly path: readonly string[];
} {
  const url = new URL(href);
  return {
    url,
    hostname: url.hostname.toLowerCase().replace(/^www\./u, ''),
    path: url.pathname.split('/').filter(Boolean).map(decodeURIComponent),
  };
}

function matchesNpub(href: string): boolean {
  const { url, hostname, path } = parse(href);
  return isNostrProfileUrlForNpub(url, hostname, path, NPUB);
}

describe('isNostrProfileUrlForNpub', () => {
  it('accepts a known client rendering the npub as the profile', () => {
    expect(matchesNpub(`https://njump.me/${NPUB}`)).toBe(true);
    expect(matchesNpub(`https://primal.net/p/${NPUB}`)).toBe(true);
    expect(matchesNpub(`https://www.snort.social/p/${NPUB}`)).toBe(true);
    expect(matchesNpub(`nostr:${NPUB}`)).toBe(true);
  });

  it('refuses a page that merely mentions the npub', () => {
    // The binding proves the npub is the owner's. It proves nothing about an
    // unrelated site that happens to carry it in a path segment.
    expect(matchesNpub(`https://example.com/notes/${NPUB}`)).toBe(false);
    expect(matchesNpub(`https://example.com/${NPUB}/about`)).toBe(false);
    expect(matchesNpub(`https://njump.me/${NPUB}/replies`)).toBe(false);
  });

  it('refuses a known client pointing at somebody else', () => {
    expect(matchesNpub('https://njump.me/npub1someoneelse')).toBe(false);
    expect(matchesNpub('nostr:npub1someoneelse')).toBe(false);
  });
});

describe('recordClaimsAtprotoHandle', () => {
  it('accepts a handle the record still claims, normalising the form', () => {
    expect(recordClaimsAtprotoHandle(['at://gimmy.bsky.social'], 'gimmy.bsky.social')).toBe(true);
    expect(recordClaimsAtprotoHandle(['at://Gimmy.bsky.social'], '@gimmy.bsky.social')).toBe(true);
  });

  it('refuses once the claim is gone or replaced', () => {
    // The cached check still describes the OLD handle; without this gate the
    // stale result would keep painting a verified pill on the retained link.
    expect(recordClaimsAtprotoHandle([], 'gimmy.bsky.social')).toBe(false);
    expect(
      recordClaimsAtprotoHandle(['at://someone.else.social'], 'gimmy.bsky.social')
    ).toBe(false);
    expect(
      recordClaimsAtprotoHandle(['nostr:npub1whatever'], 'gimmy.bsky.social')
    ).toBe(false);
  });
});
