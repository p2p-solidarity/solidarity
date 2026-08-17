import { describe, expect, it } from 'bun:test';

import { linkIconNameFor } from '../../src/profile/linkPresentation';

describe('linkIconNameFor', () => {
  it('uses recognizable platform icons and a globe for personal websites', () => {
    expect(linkIconNameFor('LinkedIn', 'https://linkedin.com/in/alice')).toBe('briefcase.fill');
    expect(linkIconNameFor('Instagram', 'https://instagram.com/alice')).toBe('camera.fill');
    expect(linkIconNameFor('Telegram', 'https://t.me/alice')).toBe('paperplane.fill');
    expect(linkIconNameFor('X', 'https://x.com/alice')).toBe('at');
    expect(linkIconNameFor('GitHub', 'https://github.com/alice')).toBe(
      'chevron.left.forwardslash.chevron.right',
    );
    expect(linkIconNameFor('YouTube', 'https://youtube.com/@alice')).toBe('play.rectangle.fill');
    expect(linkIconNameFor('Website', 'https://alice.example')).toBe('globe');
  });

  it('recognizes a platform from its hostname even when the label is custom', () => {
    expect(linkIconNameFor('Follow me', 'https://www.instagram.com/alice')).toBe('camera.fill');
    expect(linkIconNameFor('Code', 'not a URL')).toBe('link');
  });
});
