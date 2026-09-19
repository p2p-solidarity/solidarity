import { describe, expect, it } from 'bun:test';

import { BRAND_GLYPHS } from '../../src/components/icons/brandGlyphs';
import { brandIconForLink } from '../../src/profile/linkPresentation';

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
