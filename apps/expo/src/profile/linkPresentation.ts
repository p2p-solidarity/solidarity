import type { SFSymbol } from 'expo-symbols';

const PLATFORM_ICONS: Readonly<Record<string, SFSymbol>> = {
  linkedin: 'briefcase.fill',
  instagram: 'camera.fill',
  telegram: 'paperplane.fill',
  x: 'at',
  twitter: 'at',
  github: 'chevron.left.forwardslash.chevron.right',
  youtube: 'play.rectangle.fill',
  website: 'globe',
};

function platformForHostname(hostname: string): keyof typeof PLATFORM_ICONS | null {
  const normalized = hostname.toLowerCase().replace(/^www\./u, '');
  if (normalized === 'linkedin.com' || normalized.endsWith('.linkedin.com')) return 'linkedin';
  if (normalized === 'instagram.com' || normalized.endsWith('.instagram.com')) return 'instagram';
  if (normalized === 't.me' || normalized === 'telegram.me') return 'telegram';
  if (normalized === 'x.com' || normalized === 'twitter.com') return 'x';
  if (normalized === 'github.com' || normalized.endsWith('.github.com')) return 'github';
  if (normalized === 'youtube.com' || normalized === 'youtu.be') return 'youtube';
  return null;
}

export function linkIconNameFor(label: string, url: string): SFSymbol {
  try {
    const platform = platformForHostname(new URL(url).hostname);
    const platformIcon = platform ? PLATFORM_ICONS[platform] : undefined;
    if (platformIcon) return platformIcon;
  } catch {
    // Draft rows may not contain a complete URL yet; the label can still identify the icon.
  }
  return PLATFORM_ICONS[label.trim().toLowerCase()] ?? 'link';
}
