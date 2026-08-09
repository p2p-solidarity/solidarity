import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { ProfileRecord } from '@solidarity/shared';

import { animalImageSource } from '@/cards/animals';
import { generateQrPng } from '@/cards/qrCodeManager';
import { shareFieldPreferencesFromFields } from '@/cards/solidarityQrPayload';
import { buildRuntimeSolidarityQrWire } from '@/cards/solidarityQrRuntime';
import {
  displayProfileShareUrl,
  type ProfileShareUrlCandidate,
} from '@/components/me/meProfileModel';
import { useProfileShareSelection } from '@/components/me/useProfileShareSelection';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedText } from '@/components/themed';
import { ON_LIGHT } from '@/components/themed/contrast';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import type { PresentModel } from '@/present/presentModel';
import { usePreferences } from '@/settings/preferences';

const CARD_HEIGHT = 220;
const CARD_RADIUS = 20;
const CARD_QR_SIZE = 68;

type CardQrState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly uri: string }
  | { readonly kind: 'error' };

function profileInitial(name: string | null): string {
  const initial = name?.trim().charAt(0).toUpperCase();
  return initial === undefined || initial === '' ? '?' : initial;
}

function useCardQr(
  card: Extract<PresentModel['cardState'], { readonly kind: 'ready' }>['card'] | null,
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

function CardQr({ state }: { readonly state: CardQrState }): ReactNode {
  let content: ReactNode;
  if (state.kind === 'ready') {
    content = (
      <Image
        source={{ uri: state.uri }}
        contentFit="contain"
        style={{ width: CARD_QR_SIZE - 8, height: CARD_QR_SIZE - 8 }}
      />
    );
  } else if (state.kind === 'loading') {
    content = <ActivityIndicator size="small" color={Colors.primaryMauve} />;
  } else {
    content = <SfIcon name="exclamationmark.triangle" size={20} color={Colors.destructive} />;
  }

  return (
    <View
      style={{
        width: CARD_QR_SIZE,
        height: CARD_QR_SIZE,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Colors.cardBg,
        padding: 4,
      }}>
      {content}
    </View>
  );
}

function CardIdentity({
  animal,
  name,
  company,
  title,
  skills,
}: {
  readonly animal: Parameters<typeof animalImageSource>[0] | null | undefined;
  readonly name: string | null;
  readonly company: string | null;
  readonly title: string | null;
  readonly skills: readonly string[];
}): ReactNode {
  return (
    <View className="flex-1 flex-row items-center gap-4">
      {animal ? (
        <Image
          source={animalImageSource(animal)}
          contentFit="cover"
          style={{ width: 84, height: 84, borderRadius: 18 }}
        />
      ) : (
        <View
          className="h-[84px] w-[84px] items-center justify-center rounded-[18px]"
          style={{ backgroundColor: Colors.cardSurface }}>
          <ThemedText variant="headlineLarge" style={{ color: Colors.primaryMauve }}>
            {profileInitial(name)}
          </ThemedText>
        </View>
      )}

      <View className="min-w-0 flex-1 gap-1.5">
        {name ? (
          <ThemedText variant="titleLarge" numberOfLines={1} style={{ color: ON_LIGHT }}>
            {name}
          </ThemedText>
        ) : null}
        {company ? (
          <ThemedText variant="bodyMedium" numberOfLines={1} style={{ color: ON_LIGHT }}>
            {company}
          </ThemedText>
        ) : null}
        {title ? (
          <ThemedText variant="caption" numberOfLines={1} style={{ color: ON_LIGHT }}>
            {title}
          </ThemedText>
        ) : null}
        {skills.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {skills.map((skill) => (
              <View
                key={skill}
                className="rounded-full px-2 py-1"
                style={{ backgroundColor: Colors.cardSurface }}>
                <ThemedText variant="caption" style={{ color: ON_LIGHT }}>
                  {skill}
                </ThemedText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
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
  const card = model.cardState.kind === 'ready' ? model.cardState.card : null;
  const animal = card?.animal;
  const shownFields = new Map(
    model.cardOnlyFields
      .filter((field) => field.selected)
      .map((field) => [field.field, field.values] as const),
  );
  const company = shownFields.get('company')?.[0] ?? null;
  const title = shownFields.get('title')?.[0] ?? null;
  const skills = shownFields.get('skills')?.slice(0, 3) ?? [];
  const name = ownerName ?? model.mandatoryName ?? null;
  const displayUrl = page ? displayProfileShareUrl(page) : null;
  const resolvedAccent = cardAccentHex.startsWith('#') && cardAccentHex.length === 7
    ? cardAccentHex
    : Colors.primaryMauve;
  const accentWash = `${resolvedAccent}99`;
  const selectedFieldKey = model.cardOnlyFields
    .filter((field) => field.selected)
    .map((field) => field.field)
    .join('|');
  const qrState = useCardQr(card, page, selectedFieldKey);

  return (
    <View
      style={{
        height: CARD_HEIGHT,
        borderRadius: CARD_RADIUS,
        shadowColor: Colors.text1,
        shadowOpacity: 0.22,
        shadowRadius: 22,
        shadowOffset: { width: 0, height: 12 },
        elevation: 8,
      }}>
      <LinearGradient
        colors={[Colors.warmCream, accentWash]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flex: 1,
          borderRadius: CARD_RADIUS,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: Colors.cardBorder,
          padding: 18,
        }}>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -60,
            right: -30,
            width: 180,
            height: 180,
            borderRadius: 90,
            backgroundColor: Colors.radarGlow,
          }}
        />

        <View className="flex-row items-start justify-between gap-3">
          <View
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: resolvedAccent }}>
            <ThemedText variant="caption" style={{ color: Colors.invertedButtonText }}>
              {company ?? title ?? t('present.card')}
            </ThemedText>
          </View>
          <SfIcon name="wave.3.right" size={18} color={ON_LIGHT} />
        </View>

        <CardIdentity
          animal={animal}
          name={name}
          company={company}
          title={title}
          skills={skills}
        />

        <View className="flex-row items-end justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <ThemedText variant="caption" style={{ color: ON_LIGHT }}>
              {t('present.cardSummary', { count: model.selectedCardOnlyCount })}
            </ThemedText>
            <ThemedText variant="bodySmall" numberOfLines={1} style={{ color: ON_LIGHT }}>
              {displayUrl ?? t('present.noPublicLinks')}
            </ThemedText>
          </View>
          <CardQr state={qrState} />
        </View>
      </LinearGradient>
    </View>
  );
}
