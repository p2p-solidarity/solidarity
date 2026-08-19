import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const developerOnlyRoutes = [
  '../../app/oidc/consent.tsx',
  '../../app/credentials/offer.tsx',
  '../../app/websign/review.tsx',
  '../../app/credentials/index.tsx',
  '../../app/credentials/issue.tsx',
  '../../app/settings/dids.tsx',
  '../../app/settings/vc.tsx',
  '../../app/settings/oidc-request.tsx',
  '../../app/settings/groups.tsx',
] as const;

const developerOnlyLayouts = [
  '../../app/id/_layout.tsx',
  '../../app/groups/_layout.tsx',
] as const;

function expectDeveloperRouteGate(relativePath: string): void {
  const route = source(relativePath);

  expect(route).toContain('Redirect');
  expect(route).toContain('usePreferences');
  expect(route).toContain('const developerMode = usePreferences((state) => state.developerMode);');
  expect(route).toContain('if (!developerMode) return <Redirect href="/settings" />;');
}

describe('technical direct-route gate', () => {
  it('keeps every direct protocol route behind Developer Options', () => {
    for (const route of developerOnlyRoutes) expectDeveloperRouteGate(route);
  });

  it('keeps the entire identity and groups route trees behind Developer Options', () => {
    for (const layout of developerOnlyLayouts) expectDeveloperRouteGate(layout);
  });

  it('leaves the normal product routes reachable without Developer Mode', () => {
    for (const route of [
      '../../app/credentials/[id].tsx',
      '../../app/settings/privacy.tsx',
      '../../app/passport/index.tsx',
    ]) {
      expect(source(route)).not.toContain('if (!developerMode) return <Redirect href="/settings" />;');
    }
  });
});
