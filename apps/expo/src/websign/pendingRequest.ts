/**
 * webSign pending-request handoff — a tiny store that carries the incoming
 * request from the entry point (deep-link handler / scanner) to the consent
 * screen (`app/websign/review.tsx`), mirroring `scan/verifiedPageResult.ts`'s
 * "present(payload) → a screen reads it" pattern.
 *
 * A webSign request draft can be up to 64 KB, which is too large to shuttle
 * reliably through a URL route param, so the entry point stashes the decoded
 * request JWS here and pushes the param-less `/websign/review` route; the
 * screen snapshots this on mount and clears it. Either a decoded `requestJws`
 * OR a `decodeError` is set — the screen renders `ready` / `error` honestly
 * (never a fabricated request).
 */
import { create } from 'zustand';

import { decodeWebSignRequestParam } from './transport';

interface WebSignPendingState {
  readonly requestJws: string | null;
  readonly decodeError: string | null;
  readonly present: (requestJws: string) => void;
  readonly presentError: (detail: string) => void;
  readonly clear: () => void;
}

export const useWebSignPending = create<WebSignPendingState>((set) => ({
  requestJws: null,
  decodeError: null,
  present: (requestJws) => {
    set({ requestJws, decodeError: null });
  },
  presentError: (detail) => {
    set({ requestJws: null, decodeError: detail });
  },
  clear: () => {
    set({ requestJws: null, decodeError: null });
  },
}));

/**
 * Decode a raw `req` param (from a deep link or scanned QR) and stage it for
 * the review screen — a decode failure is staged as an honest error, not
 * swallowed. The caller navigates to `/websign/review` right after.
 */
export function presentWebSignEntry(requestParam: string): void {
  const decoded = decodeWebSignRequestParam(requestParam);
  if (decoded.ok) useWebSignPending.getState().present(decoded.value);
  else useWebSignPending.getState().presentError(decoded.error);
}
