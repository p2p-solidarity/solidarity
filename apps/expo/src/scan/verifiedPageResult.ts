/**
 * Verified Page result — presentation store for `VerifiedPageResultSheet`
 * (1.3.3 Task A2.3, US-11). Mirrors `src/cards/receivedCard.ts`'s
 * "present(payload) -> a globally-mounted sheet reacts" pattern so the
 * sheet works identically whether the payload arrived via the in-app
 * scanner (`app/scan/index.tsx`) or a universal/deep link handled while the
 * app is already on some other screen (`src/deeplink/router.ts`) — neither
 * caller has to know or care where the sheet is mounted.
 */
import { create } from 'zustand';

import type { VerifiedPageResult } from './verifiedPageHandler';

interface VerifiedPageResultState {
  readonly result: VerifiedPageResult | null;
  /**
   * True while a `#nostr:<npub>` short pointer is being resolved against
   * relays (`resolveProfile.ts`) — an async round-trip the sync fragment
   * path never needs. The sheet shows a spinner; `present(result)` then
   * swaps in the resolved verdict. `false` for every fragment payload
   * (those verify synchronously, so `result` is set in the same tick).
   */
  readonly resolving: boolean;
  readonly present: (result: VerifiedPageResult) => void;
  readonly presentResolving: () => void;
  readonly dismiss: () => void;
}

export const useVerifiedPageResult = create<VerifiedPageResultState>((set) => ({
  result: null,
  resolving: false,
  present: (result) => {
    set({ result, resolving: false });
  },
  presentResolving: () => {
    set({ result: null, resolving: true });
  },
  dismiss: () => {
    set({ result: null, resolving: false });
  },
}));

export function presentVerifiedPageResult(result: VerifiedPageResult): void {
  useVerifiedPageResult.getState().present(result);
}

/** Open the sheet in its loading state while a `#nostr:` pointer resolves. */
export function presentVerifiedPageResolving(): void {
  useVerifiedPageResult.getState().presentResolving();
}
