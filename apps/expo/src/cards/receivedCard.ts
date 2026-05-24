import { create } from 'zustand';

import type { BusinessCard, VerificationStatus } from '@solidarity/shared';

interface ReceivedCardState {
  readonly card: BusinessCard | null;
  readonly verificationStatus: VerificationStatus;
  readonly present: (card: BusinessCard, verificationStatus?: VerificationStatus) => void;
  readonly dismiss: () => void;
}

export const useReceivedCard = create<ReceivedCardState>((set) => ({
  card: null,
  verificationStatus: 'Unverified',
  present: (card, verificationStatus = 'Unverified') => {
    set({ card, verificationStatus });
  },
  dismiss: () => {
    set({ card: null });
  },
}));

export function presentReceivedCard(
  card: BusinessCard,
  verificationStatus: VerificationStatus = 'Unverified'
): void {
  useReceivedCard.getState().present(card, verificationStatus);
}
