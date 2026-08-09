import { useEffect, useState, type ReactNode } from 'react';
import type { ProfileRecord } from '@solidarity/shared';

import { generateQrPng } from '@/cards/qrCodeManager';
import { shareFieldPreferencesFromFields } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import {
  displayProfileShareUrl,
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

function selectedCardContent(model: PresentModel, ownerName: string | null) {
  const shownFields = new Map(
    model.cardOnlyFields
      .filter((field) => field.selected)
      .map((field) => [field.field, field.values] as const),
  );
  return {
    company: shownFields.get('company')?.[0] ?? null,
    title: shownFields.get('title')?.[0] ?? null,
    skills: shownFields.get('skills')?.slice(0, 3) ?? [],
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
  nostrShortUrlReady,
}: {
  readonly model: PresentModel;
  readonly ownerName: string | null;
  readonly shareRecord: ProfileRecord;
  readonly shareJws: string;
  readonly nostrShortUrlReady: boolean;
}): ReactNode {
  const shareSelection = useProfileShareSelection(
    shareRecord,
    shareJws,
    nostrShortUrlReady,
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
  const selectedAnimal = usePreferences((state) => state.selectedAnimal);
  const card = model.cardState.kind === 'ready' ? model.cardState.card : null;
  const animal = card?.animal;
  const { company, title, skills, name, selectedFieldKey } = selectedCardContent(
    model,
    ownerName,
  );
  const displayUrl = page ? displayProfileShareUrl(page) : null;
  const resolvedAccent = resolveCardAccent(cardAccentHex);
  const qrState = useCardQr(card, page, selectedFieldKey);

  return (
    <PresentCardVisual
      resolvedAccent={resolvedAccent}
      enableGlow={enableGlow}
      selectedAnimal={selectedAnimal}
      animal={animal}
      name={name}
      company={company}
      title={title}
      skills={skills}
      category={company ?? title ?? t('present.card')}
      summary={t('present.cardSummary', { count: model.selectedCardOnlyCount })}
      displayUrl={displayUrl ?? t('present.noPublicLinks')}
      qrState={qrState}
      flipLabel={t('present.flipCard')}
    />
  );
}
