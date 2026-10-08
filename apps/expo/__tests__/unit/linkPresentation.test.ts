import { describe, expect, it } from 'bun:test';

import { BRAND_GLYPHS } from '../../src/components/icons/brandGlyphs';
import { brandIconForHost, brandIconForLink } from '../../src/profile/linkPresentation';

describe('brandIconForLink', () => {
  it('names the actual platform rather than borrowing a generic symbol', () => {
    expect(brandIconForLink('LinkedIn', 'https://linkedin.com/in/alice')).toBe('linkedin');
    expect(brandIconForLink('Instagram', 'https://instagram.com/alice')).toBe('instagram');
    expect(brandIconForLink('Telegram', 'https://t.me/alice')).toBe('telegram');
    expect(brandIconForLink('X', 'https://x.com/alice')).toBe('x');
    expect(brandIconForLink('GitHub', 'https://github.com/alice')).toBe('github');
    expect(brandIconForLink('YouTube', 'https://youtube.com/@alice')).toBe('youtube');
  });

  it('covers platforms the URL builder cannot compose, which rows still show', () => {
    expect(brandIconForLink('Threads', 'https://threads.net/@alice')).toBe('threads');
    expect(brandIconForLink('LINE', 'https://line.me/ti/p/~alice')).toBe('line');
    expect(brandIconForLink('Bluesky', 'https://bsky.app/profile/alice')).toBe('bluesky');
    expect(brandIconForLink('Newsletter', 'https://alice.substack.com')).toBe('substack');
  });

  it('recognizes a platform from its hostname even when the label is custom', () => {
    expect(brandIconForLink('Follow me', 'https://www.instagram.com/alice')).toBe('instagram');
    expect(brandIconForLink('Watch', 'https://youtu.be/abc')).toBe('youtube');
  });

  it('falls back to a globe for a real site and a link for an unusable URL', () => {
    expect(brandIconForLink('My blog', 'https://alice.example')).toBe('globe');
    expect(brandIconForLink('Website', 'https://alice.example')).toBe('globe');
    // A draft row with no usable URL can still be named by its label.
    expect(brandIconForLink('Instagram', 'not a URL')).toBe('instagram');
    expect(brandIconForLink('Code', 'not a URL')).toBe('link');
  });

  it('only ever names a glyph the sprite actually carries', () => {
    const samples = [
      ['LinkedIn', 'https://linkedin.com/in/alice'],
      ['Threads', 'https://threads.net/@alice'],
      ['My blog', 'https://alice.example'],
      ['Code', 'not a URL'],
    ] as const;
    for (const [label, url] of samples) {
      expect(BRAND_GLYPHS[brandIconForLink(label, url)]).toBeDefined();
    }
  });
});

describe('brandIconForHost', () => {
  it('names the newer platforms and their subdomains from the host', () => {
    expect(brandIconForHost('https://www.reddit.com/u/alice')).toBe('reddit');
    expect(brandIconForHost('https://old.reddit.com/u/alice')).toBe('reddit');
    expect(brandIconForHost('https://twitch.tv/alice')).toBe('twitch');
    expect(brandIconForHost('https://alice.medium.com')).toBe('medium');
    expect(brandIconForHost('https://pin.it/abc')).toBe('pinterest');
    expect(brandIconForHost('https://warpcast.com/alice')).toBe('farcaster');
    expect(brandIconForHost('https://alice.bsky.social')).toBe('bluesky');
    expect(brandIconForHost('https://mastodon.social/@alice')).toBe('mastodon');
  });

  it('never lets a label borrow a brand the host does not have', () => {
    // The same spoof brandIconForLink would dress up as 𝕏 or GitHub.
    expect(brandIconForLink('X', 'https://evil.example/me')).toBe('globe');
    expect(brandIconForHost('https://evil.example/me')).toBe('globe');
    expect(brandIconForHost('https://x.com.evil.example/alice')).toBe('globe');
    expect(brandIconForHost('https://notgithub.com/alice')).toBe('globe');
    expect(brandIconForHost('not a URL')).toBe('link');
  });

  it('only ever names a glyph the sprite actually carries', () => {
    for (const url of ['https://reddit.com/r/x', 'https://evil.example', 'nope']) {
      expect(BRAND_GLYPHS[brandIconForHost(url)]).toBeDefined();
    }
  });
});
