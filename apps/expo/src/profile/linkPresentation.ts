import type { SFSymbol } from 'expo-symbols';

import { linkPresetForHostname } from './linkUrl';

const PLATFORM_ICONS: Readonly<Record<string, SFSymbol>> = {
  linkedin: 'briefcase.fill',
  instagram: 'camera.fill',
  telegram: 'paperplane.fill',
  x: 'at',
  github: 'chevron.left.forwardslash.chevron.right',
  youtube: 'play.rectangle.fill',
  website: 'globe',
};

export function linkIconNameFor(label: string, url: string): SFSymbol {
  try {
    const platform = linkPresetForHostname(new URL(url).hostname);
    const platformIcon = platform ? PLATFORM_ICONS[platform] : undefined;
    if (platformIcon) return platformIcon;
  } catch {
    // Draft rows may not contain a complete URL yet; the label can still identify the icon.
  }
  return PLATFORM_ICONS[label.trim().toLowerCase()] ?? 'link';
}
