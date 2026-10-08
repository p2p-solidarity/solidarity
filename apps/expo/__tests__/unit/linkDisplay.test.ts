import { displayProfileShareUrl } from '@/components/me/meProfileModel';
import { describe, expect, it } from 'bun:test';
import { hostnameOf, linkDisplay, linkSecondaryLabel } from '@/profile/linkPresentation';

describe('linkDisplay', () => {
  it('shows a canonical profile as a host-derived brand and handle', () => {
    expect(linkDisplay('My account', 'https://x.com/gimmy')).toEqual({ brand: 'x', text: '@gimmy' });
  });
});

it.each([
  ['https://t.me/gimmy', 'telegram', '@gimmy'],
  ['https://www.X.com/gimmy/?a=1#top', 'x', '@gimmy'],
  ['https://example.com:8443/blog/', 'globe', 'example.com:8443/blog'],
  ['https://github.com:8443/gimmy', 'github', 'github.com:8443/gimmy'],
  ['https://alice.example/', 'globe', 'alice.example'],
  ['https://twitter.com/gimmy', 'x', '@gimmy'],
  ['https://www.github.com/gimmy/?tab=repositories#top', 'github', '@gimmy'],
  ['https://instagram.com/gim.my/', 'instagram', '@gim.my'],
  ['https://linkedin.com/in/gimmy', 'linkedin', '@gimmy'],
  ['https://youtube.com/@gimmy', 'youtube', '@gimmy'],
  ['https://threads.net/@gimmy', 'threads', '@gimmy'],
  ['https://threads.com/@gimmy', 'threads', '@gimmy'],
  ['https://bsky.app/profile/gimmy.bsky.social', 'bluesky', '@gimmy.bsky.social'],
  ['https://www.alice.example/blog/?q=1#top', 'globe', 'alice.example/blog'],
  ['https://evil.example/me', 'globe', 'evil.example/me'],
  ['https://x.com.evil.example/a', 'globe', 'x.com.evil.example/a'],
  ['https://github.com/alice/repo', 'github', 'github.com/alice/repo'],
  ['https://youtube.com/watch?v=123', 'youtube', 'youtube.com/watch'],
  ['https://x.com/home', 'x', 'x.com/home'],
  ['https://bsky.app/profile/did:plc:123', 'bluesky', 'bsky.app/profile/did:plc:123'],
  ['  not a URL  ', 'link', 'not a URL'],
  ['mailto:alice@example.com', 'link', 'mailto:alice@example.com'],
] as const)('%s is displayed without trusting its label', (url, brand, text) => {
  expect(linkDisplay('X', url)).toEqual({ brand, text });
});

it('retains the destination host while abbreviating long paths', () => {
  const result = linkDisplay('', `https://alice.example/blog/${'a'.repeat(120)}/tail`);
  expect(result.text).toStartWith('alice.example/blog/');
  expect(result.text).toContain('…');
  expect(result.text).toEndWith('/tail');
  expect(result.text.length).toBeLessThanOrEqual(64);
});

it('hides offline and Nostr tokens and caps page addresses at 32 characters', () => {
  for (const kind of ['offline', 'short'] as const) {
    const url = `https://creds.id/#${'a'.repeat(120)}a1b2`;
    expect(displayProfileShareUrl({ kind, url })).toBe('creds.id/…a1b2');
  }
  const username = `https://creds.id/@${'alice'.repeat(10)}`;
  for (const candidate of [
    { kind: 'username', url: username, displayUrl: username },
    { kind: 'handle', url: username, isVerified: true },
  ] as const) {
    const text = displayProfileShareUrl(candidate);
    expect(text.length).toBeLessThanOrEqual(32);
    expect(text).not.toContain('#');
    expect(text).not.toContain('https://');
  }
  expect(displayProfileShareUrl({ kind: 'username', url: 'https://creds.id/@alice', displayUrl: 'https://creds.id/@alice' })).toBe('creds.id/@alice');
});


it('keeps only useful captions without letting them name the brand', () => {
  expect(linkSecondaryLabel('Twitter', 'https://x.com/gimmy')).toBeNull();
  expect(linkSecondaryLabel('Portfolio', 'https://alice.example/work')).toBe('Portfolio');
  expect(linkSecondaryLabel('X', 'https://evil.example/me')).toBe('X');
  expect(linkSecondaryLabel('https://x.com/gimmy', 'https://x.com/gimmy')).toBeNull();
});

it('shares one hostname reader between imports and saved pages', () => {
  expect(hostnameOf('https://alice.example/blog')).toBe('alice.example');
  expect(hostnameOf(' invalid ')).toBe('invalid');
});
