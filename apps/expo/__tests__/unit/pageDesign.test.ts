import { describe, expect, it } from 'bun:test';

import {
  PAGE_BLOCK_CATALOG,
  PAGE_TEMPLATE_IDS,
  addPageBlock,
  createInitialPageDesign,
  dismissLapsedAlert,
  pageDesignFromPublicPage,
  movePageBlock,
  normalizePageDesign,
  publicPageDesignEquals,
  syncLapsedAlert,
  togglePageBlock,
  toPublicPageDesign,
  updatePageBlock,
} from '../../src/page/pageDesign';

describe('v2 Page block model', () => {
  it('keeps Links first and exposes the add wall in the HTML order', () => {
    expect(PAGE_BLOCK_CATALOG.map((entry) => entry.type)).toEqual([
      'links',
      'text',
      'portfolio',
      'featured',
      'video',
      'shop',
      'leave-card',
      'booking',
    ]);

    const design = createInitialPageDesign();
    expect(design.blocks).toEqual([
      {
        id: 'links',
        type: 'links',
        title: 'Links',
        items: [],
        style: 'list',
        visible: true,
        order: 0,
      },
    ]);
  });

  it('adds one real empty block, edits it, toggles it, and reorders only movable blocks', () => {
    const initial = createInitialPageDesign();
    const withPortfolio = addPageBlock(initial, 'portfolio', 'portfolio-1');
    const withVideo = addPageBlock(withPortfolio, 'video', 'video-1');
    const edited = updatePageBlock(withVideo, 'portfolio-1', {
      title: 'Selected Work',
      style: 'carousel',
      items: [{ id: 'work-1', title: 'Book cover', url: 'https://example.com/work' }],
    });
    const hidden = togglePageBlock(edited, 'video-1', false);
    const moved = movePageBlock(hidden, 'video-1', 'up');

    expect(moved.blocks.map(({ id, order }) => [id, order])).toEqual([
      ['links', 0],
      ['video-1', 1],
      ['portfolio-1', 2],
    ]);
    expect(moved.blocks[0]?.visible).toBe(true);
    expect(moved.blocks[1]?.visible).toBe(false);
    expect(moved.blocks[2]).toMatchObject({
      title: 'Selected Work',
      style: 'carousel',
      items: [{ id: 'work-1', title: 'Book cover', url: 'https://example.com/work' }],
    });
  });

  it('allows multiple content sections but never lets Links move or turn off', () => {
    const initial = createInitialPageDesign();
    const withText = addPageBlock(initial, 'text', 'text-1');
    const withSecondText = addPageBlock(withText, 'text', 'text-2');

    expect(withSecondText.blocks.map((block) => block.id)).toEqual(['links', 'text-1', 'text-2']);
    expect(movePageBlock(withText, 'links', 'down')).toBe(withText);
    expect(togglePageBlock(withText, 'links', false)).toBe(withText);
  });

  it('keeps local editing within the same section and item bounds as the signed Page', () => {
    let design = createInitialPageDesign();
    for (let index = 1; index <= 15; index += 1) {
      design = addPageBlock(design, 'text', `text-${index}`);
    }
    expect(design.blocks).toHaveLength(16);
    expect(addPageBlock(design, 'portfolio', 'too-many')).toBe(design);

    const withTooManyItems = updatePageBlock(design, 'text-1', {
      items: Array.from({ length: 25 }, (_, index) => ({
        id: `item-${index}`,
        title: `Item ${index}`,
      })),
    });
    expect(withTooManyItems.blocks.find((block) => block.id === 'text-1')?.items).toHaveLength(24);
  });

  it('fails closed when persisted data contains more than one fixed Links section', () => {
    const design = createInitialPageDesign();
    const malformed = {
      ...design,
      blocks: [...design.blocks, { ...design.blocks[0]!, id: 'other-links', order: 1 }],
    };

    expect(normalizePageDesign(malformed)).toEqual({
      ok: false,
      error: 'Page design is malformed.',
    });
  });

  it('accepts all eight templates and fails closed on malformed persisted data', () => {
    expect(PAGE_TEMPLATE_IDS).toEqual([
      'cream',
      'ink',
      'journal',
      'gradient',
      'night',
      'mint',
      'sun',
      'minimal',
    ]);

    const valid = createInitialPageDesign();
    for (const template of PAGE_TEMPLATE_IDS) {
      expect(normalizePageDesign({ ...valid, appearance: { ...valid.appearance, template } }).ok)
        .toBe(true);
    }
    expect(normalizePageDesign({ blocks: 'not-an-array' })).toEqual({
      ok: false,
      error: 'Page design is malformed.',
    });
  });

  it('projects only public Page data into the signed profile payload and restores it without local alert state', () => {
    const local = addPageBlock(createInitialPageDesign(), 'portfolio', 'portfolio-1');
    const projected = toPublicPageDesign({
      ...local,
      appearance: { ...local.appearance, template: 'mint' },
      lapsedAlert: { currentSignature: 'nostr', dismissedSignature: 'nostr' },
    });
    const restored = pageDesignFromPublicPage(projected);

    expect(projected).not.toHaveProperty('lapsedAlert');
    expect(projected.blocks.map((block) => block.id)).toEqual(['links', 'portfolio-1']);
    expect(restored.lapsedAlert).toEqual({ currentSignature: null, dismissedSignature: null });
    expect(publicPageDesignEquals(projected, toPublicPageDesign(restored))).toBe(true);
  });
});

describe('v2 Page lapsed-check alert', () => {
  it('stays dismissed while the same real stale evidence persists', () => {
    const first = syncLapsedAlert(
      { currentSignature: null, dismissedSignature: null },
      [{ id: 'bluesky', label: 'Bluesky' }]
    );
    const dismissed = dismissLapsedAlert(first);
    const retriedButStillStale = syncLapsedAlert(dismissed, [
      { id: 'bluesky', label: 'Bluesky' },
    ]);

    expect(first.visible).toBe(true);
    expect(dismissed.visible).toBe(false);
    expect(retriedButStillStale.visible).toBe(false);
  });

  it('resets dismissal only after the evidence state changes', () => {
    const stale = syncLapsedAlert(
      { currentSignature: null, dismissedSignature: null },
      [{ id: 'nostr', label: 'Published Page' }]
    );
    const dismissed = dismissLapsedAlert(stale);
    const recovered = syncLapsedAlert(dismissed, []);
    const lapsedAgain = syncLapsedAlert(recovered, [
      { id: 'nostr', label: 'Published Page' },
    ]);

    expect(recovered.visible).toBe(false);
    expect(lapsedAgain.visible).toBe(true);
  });
});
