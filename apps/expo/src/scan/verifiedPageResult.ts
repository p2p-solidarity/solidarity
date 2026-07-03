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
  readonly present: (result: VerifiedPageResult) => void;
  readonly dismiss: () => void;
}

export const useVerifiedPageResult = create<VerifiedPageResultState>((set) => ({
  result: null,
  present: (result) => {
    set({ result });
  },
  dismiss: () => {
    set({ result: null });
  },
}));

export function presentVerifiedPageResult(result: VerifiedPageResult): void {
  useVerifiedPageResult.getState().present(result);
}
