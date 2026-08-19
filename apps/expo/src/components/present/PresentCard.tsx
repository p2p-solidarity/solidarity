import { useEffect, useState, type ReactNode } from 'react';
import type { ProfileRecord } from '@solidarity/shared';

import { generateQrPng } from '@/cards/qrCodeManager';
import { shareFieldPreferencesFromFields } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import {
  displayProfileShareUrl,
  type PublicPageShareSource,
  type ProfileShareUrlCandidate,
} from '@/components/me/meProfileModel';
import { useProfileShareSelection } from '@/components/me/useProfileShareSelection';
import {
  PresentCardVisual,
  type CardQrState,
} from '@/components/present/PresentCardVisual';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { PresentModel } from '@/present/presentModel';
import { usePreferences } from '@/settings/preferences';

const CARD_QR_SIZE = 68;

type ReadyCard = Extract<PresentModel['cardState'], { readonly kind: 'ready' }>['card'];

function resolveCardAccent(value: string): string {
  return value.startsWith('#') && value.length === 7 ? value : Colors.primaryMauve;
}

/**
 * What the card face prints, and the key identifying what the QR encodes.
 *
 * The mock's steel face carries only the name and the page address — every
 * optional field the user switched on travels INSIDE the QR, so a glance at
 * someone's card never leaks a field they only meant to hand over on scan.
 */
function selectedCardContent(model: PresentModel, ownerName: string | null) {
  return {
    name: ownerName ?? model.mandatoryName ?? null,
    selectedFieldKey: model.cardOnlyFields
      .filter((field) => field.selected)
      .map((field) => field.field)
      .join('|'),
  };
}

function useCardQr(
  card: ReadyCard | null,
  page: ProfileShareUrlCandidate | null,
  selectedFieldKey: string,
): CardQrState {
  const [qrState, setQrState] = useState<CardQrState>({ kind: 'loading' });

  useEffect(() => {
    if (page === null && card === null) {
      setQrState({ kind: 'error' });
      return;
    }
    let cancelled = false;
    setQrState({ kind: 'loading' });
    const selectedFields = ['name', ...selectedFieldKey.split('|').filter(Boolean)];
    const qrSource = card === null
      ? Promise.resolve({ wire: page?.url ?? '', startingLevel: 'M' as const })
      : buildRuntimeSolidarityQrWire(
          card,
          shareFieldPreferencesFromFields(selectedFields),
          { sealedRoute: page?.url },
        );
    void qrSource
      .then(({ wire, startingLevel }) =>
        generateQrPng(wire, { size: CARD_QR_SIZE, startingLevel })
      )
      .then((uri) => {
        if (!cancelled) setQrState({ kind: 'ready', uri });
      })
      .catch(() => {
        if (!cancelled) setQrState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [card, page?.url, selectedFieldKey]);

  return qrState;
}

export function PresentCardWithPageUrl({
  model,
  ownerName,
  shareRecord,
  shareJws,
  publicPage = null,
  nostrShortUrlReady,
}: {
  readonly model: PresentModel;
  readonly ownerName: string | null;
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly publicPage?: PublicPageShareSource | null;
  readonly nostrShortUrlReady: boolean;
}): ReactNode {
  const shareSelection = useProfileShareSelection(
    shareRecord,
    shareJws,
    nostrShortUrlReady,
    0,
    publicPage,
  );
  const page = shareSelection.kind === 'ready' ? shareSelection.selected : null;
  return <PresentCard model={model} ownerName={ownerName} page={page} />;
}

export function PresentCard({
  model,
  ownerName,
  page,
}: {
  readonly model: PresentModel;
  readonly ownerName: string | null;
  readonly page: ProfileShareUrlCandidate | null;
}): ReactNode {
  const { t } = useTranslation();
  const cardAccentHex = usePreferences((state) => state.cardAccentHex);
  const enableGlow = usePreferences((state) => state.enableGlow);
  const card = model.cardState.kind === 'ready' ? model.cardState.card : null;
  const { name, selectedFieldKey } = selectedCardContent(model, ownerName);
  const displayUrl = page ? displayProfileShareUrl(page) : null;
  const resolvedAccent = resolveCardAccent(cardAccentHex);
  const qrState = useCardQr(card, page, selectedFieldKey);

  return (
    <PresentCardVisual
      resolvedAccent={resolvedAccent}
      enableGlow={enableGlow}
      name={name}
      summary={t('present.cardSummary', { count: model.selectedCardOnlyCount })}
      scanHint={t('present.scanToExchange')}
      displayUrl={displayUrl ?? t('present.noPublicLinks')}
      qrState={qrState}
      flipLabel={t('present.flipCard')}
    />
  );
}
