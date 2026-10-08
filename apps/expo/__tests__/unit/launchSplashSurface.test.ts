import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function splashPlugin(): Record<string, unknown> {
  const appConfig = JSON.parse(source('../../app.json')) as {
    readonly expo: { readonly plugins: readonly unknown[] };
  };
  const plugin = appConfig.expo.plugins.find(
    (entry): entry is readonly [string, Record<string, unknown>] =>
      Array.isArray(entry) && entry[0] === 'expo-splash-screen'
  );

  if (plugin === undefined) throw new Error('expo-splash-screen plugin missing');
  return plugin[1];
}

describe('launch splash surface', () => {
  it('uses the centred brand-mark native splash without legacy full-screen art', () => {
    const plugin = splashPlugin();
    const appConfig = source('../../app.json');

    expect(plugin['image']).toBe('./assets/splash-icon.png');
    expect(plugin['imageWidth']).toBe(220);
    expect(plugin['resizeMode']).toBe('contain');
    expect(plugin['backgroundColor']).toBe('#000000');
    expect(appConfig).not.toContain('enableFullScreenImage_legacy');
    expect(appConfig).not.toContain('splash.png');
  });

  it('keeps the static BrandMark paths byte-for-byte aligned with the SVG asset', () => {
    const markSvg = source('../../assets/brand/mark.svg');
    const component = source('../../src/components/brand/BrandMark.tsx');
    const topArc = markSvg.match(/<path id="top-arc"[^>]* d="([^"]+)"/u)?.[1];
    const bottomArc = markSvg.match(/<path id="bottom-arc"[^>]* d="([^"]+)"/u)?.[1];
    const componentTopArc = component.match(
      /export const BRAND_MARK_TOP_ARC = '([^']+)';/u
    )?.[1];
    const componentBottomArc = component.match(
      /export const BRAND_MARK_BOTTOM_ARC = '([^']+)';/u
    )?.[1];

    expect(componentTopArc).toBe(topArc);
    expect(componentBottomArc).toBe(bottomArc);
    expect(component).toContain("BRAND_MARK_VIEWBOX = '0 0 1024 1024'");
  });

  it('keeps the JS overlay accessible, motion-aware, and responsible for hiding native splash', () => {
    const launchSplash = source('../../src/components/brand/LaunchSplash.tsx');
    const rootLayout = source('../../app/_layout.tsx');

    expect(launchSplash).toContain('useReducedMotion');
    expect(launchSplash).toContain('SPRING.gentle');
    expect(launchSplash).toContain('1500');
    expect(launchSplash).toContain('pointerEvents="none"');
    expect(launchSplash).toContain('SplashScreen.hideAsync');
    expect(rootLayout).toContain('<LaunchSplash');
    expect(rootLayout).not.toContain('SplashScreen.hideAsync');
  });

  it('keeps launch-splash colour literals in the shared palette only', () => {
    const files = [
      source('../../src/components/brand/BrandMark.tsx'),
      source('../../src/components/brand/LaunchSplash.tsx'),
    ];

    for (const file of files) {
      expect(file).not.toMatch(/#[0-9a-fA-F]{3,8}/u);
    }
  });
});
