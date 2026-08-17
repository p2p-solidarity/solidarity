import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  PAGE_DESIGN_STORAGE_KEY,
  __setPageDesignStorageForTesting,
  hydratePageDesign,
  preparePageDesign,
  resetPageDesignStoreForTesting,
  usePageDesignStore,
  type PageDesignStorage,
} from '../../src/page/pageDesignStore';
import { addPageBlock, createInitialPageDesign, toPublicPageDesign } from '../../src/page/pageDesign';
import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';

function memoryStorage(seed: string | null = null): {
  readonly storage: PageDesignStorage;
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (seed !== null) values.set(PAGE_DESIGN_STORAGE_KEY, seed);
  return {
    values,
    storage: {
      getString: (key) => values.get(key) ?? null,
      setString: (key, value) => {
        values.set(key, value);
      },
    },
  };
}

describe('Page design persistence', () => {
  beforeEach(() => {
    resetPageDesignStoreForTesting();
    __setPageDesignStorageForTesting(null);
  });

  afterEach(() => {
    __resetLocalDataWipeBarrierForTesting();
  });

  it('hydrates a missing record into the honest Links-only design and persists it', () => {
    const memory = memoryStorage();
    __setPageDesignStorageForTesting(memory.storage);

    hydratePageDesign();

    const state = usePageDesignStore.getState();
    expect(state.status).toBe('ready');
    expect(state.design.blocks.map((block) => block.type)).toEqual(['links']);
    expect(memory.values.has(PAGE_DESIGN_STORAGE_KEY)).toBe(true);
  });

  it('persists add, edit, visibility, order, and appearance changes', () => {
    const memory = memoryStorage();
    __setPageDesignStorageForTesting(memory.storage);
    hydratePageDesign();

    const store = usePageDesignStore.getState();
    store.addBlock('portfolio');
    const portfolio = usePageDesignStore.getState().design.blocks.find(
      (block) => block.type === 'portfolio'
    );
    expect(portfolio).toBeDefined();
    store.updateBlock(portfolio!.id, { title: 'Work' });
    store.setBlockVisible(portfolio!.id, false);
    store.setAppearance({ template: 'night', font: 'serif', showBrand: false });

    resetPageDesignStoreForTesting();
    hydratePageDesign();

    expect(usePageDesignStore.getState().design).toMatchObject({
      blocks: [
        { type: 'links', visible: true, order: 0 },
        { type: 'portfolio', title: 'Work', visible: false, order: 1 },
      ],
      appearance: { template: 'night', font: 'serif', showBrand: false },
    });
  });

  it('renders a real error state instead of replacing malformed data with plausible content', () => {
    const memory = memoryStorage('{bad json');
    __setPageDesignStorageForTesting(memory.storage);

    hydratePageDesign();

    expect(usePageDesignStore.getState()).toMatchObject({
      status: 'error',
      error: 'Page design could not be read.',
    });
  });

  it('adopts a signed Page only when this device still has the untouched default draft', () => {
    const memory = memoryStorage();
    __setPageDesignStorageForTesting(memory.storage);
    hydratePageDesign();
    const signed = toPublicPageDesign(
      addPageBlock(createInitialPageDesign(), 'portfolio', 'portfolio-1', 'Selected work')
    );

    usePageDesignStore.getState().adoptPublishedPage(signed);

    expect(usePageDesignStore.getState().design.blocks.map((block) => block.title)).toEqual([
      'Links',
      'Selected work',
    ]);

    usePageDesignStore.getState().addBlock('video', 'Local draft');
    usePageDesignStore.getState().adoptPublishedPage(
      toPublicPageDesign(addPageBlock(createInitialPageDesign(), 'text', 'text-1', 'Remote draft'))
    );
    expect(usePageDesignStore.getState().design.blocks.map((block) => block.title)).toContain('Local draft');
    expect(usePageDesignStore.getState().design.blocks.map((block) => block.title)).not.toContain('Remote draft');
  });

  it('drops live page design and never recreates it while a local wipe is active', () => {
    const memory = memoryStorage();
    __setPageDesignStorageForTesting(memory.storage);
    hydratePageDesign();
    usePageDesignStore.getState().addBlock('portfolio');

    beginLocalDataWipe();
    memory.values.clear(); // Mirrors the durable MMKV clear in production.
    const reset = (
      usePageDesignStore.getState() as {
        readonly resetForLocalWipe?: () => void;
      }
    ).resetForLocalWipe;

    expect(typeof reset).toBe('function');
    reset?.();
    usePageDesignStore.getState().setAppearance({ template: 'night' });

    expect(usePageDesignStore.getState().design.blocks).toHaveLength(1);
    expect(memory.values.has(PAGE_DESIGN_STORAGE_KEY)).toBe(false);
  });

  it('rehydrates an empty Page design only after a successful wipe releases the barrier', async () => {
    const memory = memoryStorage();
    __setPageDesignStorageForTesting(memory.storage);
    hydratePageDesign();
    usePageDesignStore.getState().addBlock('portfolio');

    beginLocalDataWipe();
    memory.values.clear();
    usePageDesignStore.getState().resetForLocalWipe();

    await preparePageDesign();
    expect(usePageDesignStore.getState().status).toBe('loading');
    expect(memory.values.has(PAGE_DESIGN_STORAGE_KEY)).toBe(false);

    completeLocalDataWipe();
    await preparePageDesign();

    const state = usePageDesignStore.getState();
    expect(state.status).toBe('ready');
    expect(state.design.blocks.map((block) => block.type)).toEqual(['links']);
    expect(state.design.blocks[0]).toMatchObject({ visible: true, order: 0 });
    expect(memory.values.has(PAGE_DESIGN_STORAGE_KEY)).toBe(true);
  });
});
