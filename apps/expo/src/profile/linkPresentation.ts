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
 * Resolution order: hostname first (a link's URL is what it actually points
 * at), then the label (a draft row may have no usable URL yet), then a plain
 * globe for any other reachable site, and `link` when there is no URL at all.
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
    const brand = brandForHostname(new URL(url).hostname);
    if (brand) return brand;
    // A real site we have no mark for is still a site, not a bare link.
    return LABEL_BRANDS[label.trim().toLowerCase()] ?? 'globe';
  } catch {
    // Draft rows may not carry a complete URL yet; the label can still name it.
    return LABEL_BRANDS[label.trim().toLowerCase()] ?? 'link';
  }
}
