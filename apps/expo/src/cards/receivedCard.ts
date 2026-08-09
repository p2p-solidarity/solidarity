import { create } from 'zustand';

import type {
  BusinessCard,
  Contact,
  ContactSource,
  VerificationStatus,
} from '@solidarity/shared';

export interface ReceivedCardPresentation {
  readonly card: BusinessCard;
  readonly verificationStatus: VerificationStatus;
  readonly source: ContactSource;
  readonly sealedRoute?: string;
}

interface ReceivedCardState {
  readonly card: BusinessCard | null;
  readonly verificationStatus: VerificationStatus;
  readonly source: ContactSource;
  readonly sealedRoute?: string;
  readonly present: (presentation: ReceivedCardPresentation) => void;
  readonly dismiss: () => void;
}

export const useReceivedCard = create<ReceivedCardState>((set) => ({
  card: null,
  verificationStatus: 'Unverified',
  source: 'QR Code',
  sealedRoute: undefined,
  present: ({ card, verificationStatus, source, sealedRoute }) => {
    set({ card, verificationStatus, source, sealedRoute });
  },
  dismiss: () => {
    set({
      card: null,
      verificationStatus: 'Unverified',
      source: 'QR Code',
      sealedRoute: undefined,
    });
  },
}));

export function presentReceivedCard(presentation: ReceivedCardPresentation): void {
  useReceivedCard.getState().present(presentation);
}

export function buildContactFromReceivedCard({
  id,
  card,
  receivedAt,
  verificationStatus,
  source,
  sealedRoute,
}: ReceivedCardPresentation & {
  readonly id: string;
  readonly receivedAt: Date;
}): Contact {
  return {
    id,
    businessCard: card,
    receivedAt,
    source,
    tags: [],
    verificationStatus,
    ...(sealedRoute === undefined ? {} : { sealedRoute }),
  };
}
