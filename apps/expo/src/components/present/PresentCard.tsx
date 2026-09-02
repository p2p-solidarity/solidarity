import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProfileRecord } from '@solidarity/shared';

import { generateQrPng } from '@/cards/qrCodeManager';
import { shareFieldPreferencesFromFields } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import { ModalSheet } from '@/components/common/ModalSheet';
import {
  displayProfileShareUrl,
  type PublicPageShareSource,
  type ProfileShareUrlCandidate,
} from '@/components/me/meProfileModel';
import { PageSectionLabel } from '@/components/me/PageSectionLabel';
import { useProfileShareSelection } from '@/components/me/useProfileShareSelection';
import {
  PresentCardVisual,
  type CardQrState,
} from '@/components/present/PresentCardVisual';
import { PhysicalCardSheet } from '@/components/present/PhysicalCardSheet';
import { ThemedButton, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import {
  PRESENT_CARD_PREFERENCE_KEYS,
  selectPresentCardPresets,
  type PresentCardPreset,
  type PresentModel,
} from '@/present/presentModel';
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
    void Promise.resolve()
      .then(() => card === null
        ? { wire: page?.url ?? '', startingLevel: 'M' as const }
        : buildRuntimeSolidarityQrWire(
            card,
            shareFieldPreferencesFromFields(selectedFields),
            { sealedRoute: page?.url },
          ))
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
  const [physicalCardOpen, setPhysicalCardOpen] = useState(false);
  const card = model.cardState.kind === 'ready' ? model.cardState.card : null;
  const { name, selectedFieldKey } = selectedCardContent(model, ownerName);
  const displayUrl = page ? displayProfileShareUrl(page) : null;
  const resolvedAccent = resolveCardAccent(cardAccentHex);
  const qrState = useCardQr(card, page, selectedFieldKey);

  return (
    <>
      <PresentCardVisual
        resolvedAccent={resolvedAccent}
        enableGlow={enableGlow}
        name={name}
        summary={t('present.cardSummary', { count: model.selectedCardOnlyCount })}
        scanHint={t('present.scanToExchange')}
        displayUrl={displayUrl ?? t('present.noPublicLinks')}
        qrState={qrState}
        flipLabel={t('present.flipCard')}
        physicalCardLabel={t('present.orderPhysicalCard')}
        onOpenPhysicalCard={() => {
          setPhysicalCardOpen(true);
        }}
      />
      <PhysicalCardSheet
        visible={physicalCardOpen}
        onClose={() => {
          setPhysicalCardOpen(false);
        }}
      />
    </>
  );
}

export function PresentCardPresetControls({
  model,
}: {
  readonly model: PresentModel;
}): ReactNode {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const savedPresets = usePreferences(selectPresentCardPresets);
  const setPreference = usePreferences((state) => state.set);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const closeSheet = () => {
    setSheetOpen(false);
    setNameInput('');
  };

  const savePreset = () => {
    const name = nameInput.trim();
    if (name.length === 0) return;
    const preset: PresentCardPreset = {
      name,
      preferenceKeys: model.cardOnlyFields
        .filter((field) => field.selected)
        .map((field) => field.preferenceKey),
    };
    setPreference('presentCardPresets', [
      ...savedPresets.filter((existing) => existing.name !== name),
      preset,
    ]);
    pushToast(t('present.presetSaved', { name }), 'success');
    closeSheet();
  };

  const applyPreset = (preset: PresentCardPreset) => {
    const selected = new Set(preset.preferenceKeys);
    for (const key of PRESENT_CARD_PREFERENCE_KEYS) {
      setPreference(key, selected.has(key));
    }
    pushToast(t('present.presetApplied', { name: preset.name }), 'success');
  };

  return (
    <>
      {savedPresets.length > 0 ? (
        <View style={{ gap: 8 }}>
          <PageSectionLabel title={t('present.savedCombinations')} />
          {savedPresets.map((preset) => (
            <ThemedButton
              key={preset.name}
              label={preset.name}
              variant="secondary"
              fullWidth
              onPress={() => {
                applyPreset(preset);
              }}
            />
          ))}
        </View>
      ) : null}
      <ThemedButton
        label={t('present.saveCombination')}
        variant="secondary"
        fullWidth
        onPress={() => {
          setSheetOpen(true);
        }}
      />
      <ModalSheet visible={sheetOpen} onRequestClose={closeSheet}>
        <KeyboardAvoidingView behavior="padding" automaticOffset style={{ flex: 1 }}>
          <View
            className="flex-1 bg-pageBg px-4"
            style={{
              paddingTop: insets.top + 16,
              paddingBottom: Math.max(insets.bottom, 16),
              gap: 18,
            }}
          >
            <ThemedText accessibilityRole="header" variant="titleLarge">
              {t('present.presetNameTitle')}
            </ThemedText>
            <ThemedTextInput
              autoFocus
              value={nameInput}
              onChangeText={setNameInput}
              label={t('present.presetNameLabel')}
              placeholder={t('present.presetNamePlaceholder')}
              returnKeyType="done"
              onSubmitEditing={savePreset}
            />
            <View style={{ marginTop: 'auto', gap: 10 }}>
              <ThemedButton
                fullWidth
                disabled={nameInput.trim().length === 0}
                label={t('present.save')}
                onPress={savePreset}
              />
              <ThemedButton
                fullWidth
                variant="secondary"
                label={t('present.cancel')}
                onPress={closeSheet}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </ModalSheet>
    </>
  );
}
