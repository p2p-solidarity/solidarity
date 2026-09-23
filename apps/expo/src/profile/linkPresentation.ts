/**
 * Which glyph names a link row's platform.
 *
 * This is a PRESENTATION map, deliberately separate from
 * `linkPresetForHostname` in `./linkUrl` — that one drives label presets and
 * handle→URL builders, so it only knows the seven platforms the editor can
 * compose a URL for. A row can still SHOW a Threads or LINE mark without the
 * editor knowing how to build one, so the host table here is the wider of the
 * two on purpose.
 *
 * Resolution order: a parseable URL is named by its hostname only (a link's
 * URL is what it actually points at; the label never overrides it), falling
 * back to a plain globe. Only a draft row with no usable URL yet consults the
 * label, and ends at `link`.
 */
import type { BrandIconName } from '@/components/icons/brandGlyphs';

/** Exact hosts, matched after stripping `www.`. */
const HOST_BRANDS: Readonly<Record<string, BrandIconName>> = {
  'instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'threads.net': 'threads',
  'threads.com': 'threads',
  'line.me': 'line',
  'linkedin.com': 'linkedin',
  'github.com': 'github',
  'x.com': 'x',
  'twitter.com': 'x',
  't.me': 'telegram',
  'telegram.me': 'telegram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'tiktok.com': 'tiktok',
  'spotify.com': 'spotify',
  'open.spotify.com': 'spotify',
  'bsky.app': 'bluesky',
  'discord.gg': 'discord',
  'discord.com': 'discord',
  'wa.me': 'whatsapp',
  'whatsapp.com': 'whatsapp',
  'linktr.ee': 'linktree',
  'substack.com': 'substack',
  'bsky.social': 'bluesky',
  'mastodon.social': 'mastodon',
  'mastodon.online': 'mastodon',
  'mstdn.jp': 'mastodon',
  'fosstodon.org': 'mastodon',
  'reddit.com': 'reddit',
  'redd.it': 'reddit',
  'twitch.tv': 'twitch',
  'medium.com': 'medium',
  'pinterest.com': 'pinterest',
  'pin.it': 'pinterest',
  'farcaster.xyz': 'farcaster',
  'warpcast.com': 'farcaster',
};

/** Hosts whose subdomains carry the same brand (`alice.substack.com`). */
const HOST_SUFFIX_BRANDS: readonly (readonly [string, BrandIconName])[] = [
  ['.instagram.com', 'instagram'],
  ['.youtube.com', 'youtube'],
  ['.linkedin.com', 'linkedin'],
  ['.github.com', 'github'],
  ['.tiktok.com', 'tiktok'],
  ['.substack.com', 'substack'],
  ['.facebook.com', 'facebook'],
  ['.bsky.social', 'bluesky'],
  ['.reddit.com', 'reddit'],
  ['.medium.com', 'medium'],
  ['.pinterest.com', 'pinterest'],
];

/** Labels a user may type by hand, or an editor preset name. */
const LABEL_BRANDS: Readonly<Record<string, BrandIconName>> = {
  instagram: 'instagram',
  ig: 'instagram',
  youtube: 'youtube',
  threads: 'threads',
  line: 'line',
  linkedin: 'linkedin',
  github: 'github',
  x: 'x',
  twitter: 'x',
  telegram: 'telegram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  spotify: 'spotify',
  bluesky: 'bluesky',
  discord: 'discord',
  mastodon: 'mastodon',
  substack: 'substack',
  whatsapp: 'whatsapp',
  linktree: 'linktree',
  reddit: 'reddit',
  twitch: 'twitch',
  medium: 'medium',
  pinterest: 'pinterest',
  farcaster: 'farcaster',
  website: 'globe',
};

function brandForHostname(hostname: string): BrandIconName | null {
  const normalized = hostname.toLowerCase().replace(/^www\./u, '');
  const exact = HOST_BRANDS[normalized];
  if (exact) return exact;
  const suffix = HOST_SUFFIX_BRANDS.find(([end]) => normalized.endsWith(end));
  return suffix ? suffix[1] : null;
}

export function brandIconForLink(label: string, url: string): BrandIconName {
  try {
    // A parseable URL is named by its host alone: a row labelled "X" that
    // points at `evil.tld` must not borrow the 𝕏 mark. A real site we have
    // no mark for is still a site, not a bare link.
    return brandForHostname(new URL(url).hostname) ?? 'globe';
  } catch {
    // Draft rows may not carry a complete URL yet; the label can still name it.
    return LABEL_BRANDS[label.trim().toLowerCase()] ?? 'link';
  }
}

/**
 * Host-only brand for a link someone else published (a scanned page, a saved
 * person, the public viewer). Unlike `brandIconForLink` the label never picks
 * the mark: a row labelled "X" that points at `evil.tld` must show a globe and
 * its real host, not the 𝕏 logo with the destination hidden.
 */
export function brandIconForHost(url: string): BrandIconName {
  try {
    return brandForHostname(new URL(url).hostname) ?? 'globe';
  } catch {
    return 'link';
  }
}
