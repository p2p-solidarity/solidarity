import { create } from 'zustand';

import { uuid, type PublicPageDesign } from '@solidarity/shared';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';
import type { getMmkv as GetMmkvFn } from '@/storage/mmkv';

import {
  addPageBlock,
  createInitialPageDesign,
  dismissLapsedAlert,
  movePageBlock,
  normalizePageDesign,
  pageDesignFromPublicPage,
  publicPageDesignEquals,
  removePageBlock,
  syncLapsedAlert,
  togglePageBlock,
  toPublicPageDesign,
  updatePageBlock,
  type LapsedAlertModel,
  type LapsedEvidence,
  type PageAppearance,
  type PageBlock,
  type PageBlockType,
  type PageDesign,
} from './pageDesign';

export const PAGE_DESIGN_STORAGE_KEY = 'page:design:v1';

export interface PageDesignStorage {
  readonly getString: (key: string) => string | null;
  readonly setString: (key: string, value: string) => void;
}

let cachedGetMmkv: typeof GetMmkvFn | undefined;

const defaultStorage: PageDesignStorage = {
  getString: (key) => {
    if (!cachedGetMmkv) throw new Error('Page design storage is not ready.');
    return cachedGetMmkv().getString(key) ?? null;
  },
  setString: (key, value) => {
    if (!cachedGetMmkv) throw new Error('Page design storage is not ready.');
    cachedGetMmkv().set(key, value);
  },
};

let activeStorage = defaultStorage;

export function __setPageDesignStorageForTesting(storage: PageDesignStorage | null): void {
  activeStorage = storage ?? defaultStorage;
}

/** Resolve the already-open MMKV handle without pulling native storage into
 * pure model/store tests at module load time. */
export async function warmPageDesignStorage(): Promise<void> {
  const mod = await import('@/storage/mmkv');
  cachedGetMmkv = mod.getMmkv;
}

export async function preparePageDesign(): Promise<void> {
  // Unit tests and future alternate storage adapters supply their own
  // synchronous storage seam; loading the native MMKV module in that case is
  // both unnecessary and unsafe in the Bun test runtime.
  if (activeStorage === defaultStorage) {
    try {
      await warmPageDesignStorage();
    } catch {
      // `hydratePageDesign` below turns an unavailable default storage handle
      // into the store's explicit error state rather than leaving it loading.
    }
  }
  hydratePageDesign();
}

export type PageDesignStatus = 'loading' | 'ready' | 'error';

interface PageDesignState {
  readonly status: PageDesignStatus;
  readonly error: string | null;
  readonly design: PageDesign;
  readonly addBlock: (type: Exclude<PageBlockType, 'links'>, title?: string) => void;
  readonly updateBlock: (
    id: string,
    patch: Partial<Pick<PageBlock, 'title' | 'items' | 'style'>>
  ) => void;
  readonly removeBlock: (id: string) => void;
  readonly setBlockVisible: (id: string, visible: boolean) => void;
  readonly moveBlock: (id: string, direction: 'up' | 'down') => void;
  readonly setAppearance: (patch: Partial<PageAppearance>) => void;
  readonly syncLapsedEvidence: (evidence: readonly LapsedEvidence[]) => void;
  readonly dismissLapsedAlert: () => void;
  /** Seed the local editor from a signed Page after profile hydration, but
   * never overwrite a real local draft that has not been published yet. */
  readonly adoptPublishedPage: (page: PublicPageDesign | undefined) => void;
  /** Drop the local-only Page controls after a full device wipe. */
  readonly resetForLocalWipe: () => void;
}

const INITIAL_STATE = {
  status: 'loading' as const,
  error: null,
  design: createInitialPageDesign(),
};
const INITIAL_PUBLIC_PAGE = toPublicPageDesign(INITIAL_STATE.design);

function persist(design: PageDesign): boolean {
  try {
    activeStorage.setString(PAGE_DESIGN_STORAGE_KEY, JSON.stringify(design));
    return true;
  } catch {
    return false;
  }
}

export const usePageDesignStore = create<PageDesignState>((set, get) => {
  const commit = (next: PageDesign): void => {
    if (next === get().design) return;
    // Every Page mutation is synchronous after its caller has started. A
    // fresh epoch is therefore enough to reject UI events that arrive while
    // the wipe coordinator owns the durable store.
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    if (!persist(next)) {
      set({ status: 'error', error: 'Page design could not be saved.' });
      return;
    }
    set({ design: next, status: 'ready', error: null });
  };

  return {
    ...INITIAL_STATE,
    addBlock: (type, title) => {
      commit(addPageBlock(get().design, type, uuid(), title));
    },
    updateBlock: (id, patch) => {
      commit(updatePageBlock(get().design, id, patch));
    },
    removeBlock: (id) => {
      commit(removePageBlock(get().design, id));
    },
    setBlockVisible: (id, visible) => {
      commit(togglePageBlock(get().design, id, visible));
    },
    moveBlock: (id, direction) => {
      commit(movePageBlock(get().design, id, direction));
    },
    setAppearance: (patch) => {
      commit({
        ...get().design,
        appearance: { ...get().design.appearance, ...patch },
      });
    },
    syncLapsedEvidence: (evidence) => {
      const current = get().design;
      const model = syncLapsedAlert(current.lapsedAlert, evidence);
      if (
        model.currentSignature === current.lapsedAlert.currentSignature &&
        model.dismissedSignature === current.lapsedAlert.dismissedSignature
      ) return;
      commit({
        ...current,
        lapsedAlert: {
          currentSignature: model.currentSignature,
          dismissedSignature: model.dismissedSignature,
        },
      });
    },
    dismissLapsedAlert: () => {
      const current = get().design;
      const model: LapsedAlertModel = {
        ...current.lapsedAlert,
        evidence: [],
        visible: current.lapsedAlert.currentSignature !== null,
      };
      const dismissed = dismissLapsedAlert(model);
      commit({
        ...current,
        lapsedAlert: {
          currentSignature: dismissed.currentSignature,
          dismissedSignature: dismissed.dismissedSignature,
        },
      });
    },
    adoptPublishedPage: (page) => {
      if (!page) return;
      const current = get();
      if (
        current.status !== 'ready' ||
        !publicPageDesignEquals(toPublicPageDesign(current.design), INITIAL_PUBLIC_PAGE)
      ) return;
      const next = pageDesignFromPublicPage(page);
      if (publicPageDesignEquals(toPublicPageDesign(current.design), toPublicPageDesign(next))) return;
      commit(next);
    },
    resetForLocalWipe: () => {
      set(INITIAL_STATE);
    },
  };
});

export function hydratePageDesign(): void {
  if (!canCommitLocalData(captureLocalDataEpoch())) return;
  try {
    const raw = activeStorage.getString(PAGE_DESIGN_STORAGE_KEY);
    if (raw === null) {
      const initial = createInitialPageDesign();
      if (!persist(initial)) throw new Error('write failed');
      usePageDesignStore.setState({ status: 'ready', error: null, design: initial });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      usePageDesignStore.setState({ status: 'error', error: 'Page design could not be read.' });
      return;
    }
    const normalized = normalizePageDesign(parsed);
    if (!normalized.ok) {
      usePageDesignStore.setState({ status: 'error', error: 'Page design could not be read.' });
      return;
    }
    usePageDesignStore.setState({ status: 'ready', error: null, design: normalized.value });
  } catch {
    usePageDesignStore.setState({ status: 'error', error: 'Page design could not be read.' });
  }
}

export function resetPageDesignStoreForTesting(): void {
  usePageDesignStore.setState(INITIAL_STATE);
}
