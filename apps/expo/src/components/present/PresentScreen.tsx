import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProfileRecord } from '@solidarity/shared';
import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { PresentAttestationsMode as AttestationsMode } from '@/components/present/PresentAttestations';
import { PresentCard, PresentCardWithPageUrl } from '@/components/present/PresentCard';
import {
  ThemedButton,
  ThemedSurface,
  ThemedText,
  readableTextOn,
} from '@/components/themed';
import { useThemeColors } from '@/constants/useThemeColors';
import { useCredentialStore } from '@/credentials/store';
import { useTranslation } from '@/i18n';
import { useDisplayClaims, useIdentityData } from '@/identity';
import { filterAvailablePassportPresentationClaims } from '@/passport/presentationClaims';
import { hasPassportShowWitnessSafe } from '@/passport/showWitnessVault';
import {
  buildPresentModel,
  resolvePresentAttestationsState,
  resolvePresentCardState,
  type PresentCardOnlyField,
  type PresentModel,
} from '@/present/presentModel';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';
type PresentMode = 'card' | 'attestations';
export function PresentScreen(): ReactNode {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<PresentMode>('card');
  const [cardHydrationError, setCardHydrationError] = useState(false);
  const [cardRetryNonce, setCardRetryNonce] = useState(0);
  const [identityHydrationError, setIdentityHydrationError] = useState(false);
  const [identityRetryNonce, setIdentityRetryNonce] = useState(0);

  const manifest = useCardStore((state) => state.manifest);
  const detailsHydrated = useCardStore((state) => state.detailsHydrated);
  const hydrateCards = useCardStore((state) => state.hydrate);
  const card = useMyCardDetail();
  const preferences = usePreferences();

  const record = useProfileStore((state) => state.record);
  const jws = useProfileStore((state) => state.jws);
  const linkVisibility = useProfileStore((state) => state.linkVisibility);
  const shared = useProfileStore((state) => state.shared);
  const published = useProfileStore((state) => state.published);
  const nostrPublishedJws = useProfileStore((state) => state.nostrPublishedJws);
  const shareRecord = shared?.record ?? record;
  const shareJws = shared?.jws ?? jws;
  const nostrShortUrlReady = published !== null && nostrPublishedJws === published.jws;
  const trimmedOwnerName = record?.displayName.trim();

  const hydrateIdentity = useIdentityData((state) => state.hydrate);
  const identityHydrated = useIdentityData((state) => state.hydrated);
  const credentialDetails = useCredentialStore((state) => state.details);
  const displayClaims = useDisplayClaims();
  const availableCredentialIds = useMemo(
    () => new Set(credentialDetails.keys()),
    [credentialDetails]
  );
  const passportShowCredentialIds = useMemo(
    () => new Set(
      Array.from(credentialDetails.values())
        .filter(
          (credential) =>
            credential.metadataTags.includes('passport-openac-v3') &&
            hasPassportShowWitnessSafe(credential.id)
        )
        .map((credential) => credential.id)
    ),
    [credentialDetails]
  );
  const passportClaims = filterAvailablePassportPresentationClaims(
    displayClaims,
    availableCredentialIds,
    passportShowCredentialIds,
  );

  useEffect(() => {
    let active = true;
    setCardHydrationError(false);
    void hydrateCards().catch(() => {
      if (active) setCardHydrationError(true);
    });
    return () => {
      active = false;
    };
  }, [cardRetryNonce, hydrateCards]);

  useEffect(() => {
    let active = true;
    setIdentityHydrationError(false);
    void hydrateIdentity().catch(() => {
      if (active) setIdentityHydrationError(true);
    });
    return () => {
      active = false;
    };
  }, [hydrateIdentity, identityRetryNonce]);

  const cardState = resolvePresentCardState({
    detailsHydrated,
    hasManifest: manifest.length > 0,
    card,
    hasError: cardHydrationError,
  });
  const model = buildPresentModel({
    cardState,
    links: record?.links ?? [],
    linkVisibility,
    preferences,
  });
  const attestationsState = resolvePresentAttestationsState({
    hydrated: identityHydrated,
    hasError: identityHydrationError,
    claimCount: passportClaims.length,
  });

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <PresentHeader onScan={() => { router.push('/scan'); }} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 100 + insets.bottom,
          gap: 20,
        }}
      >
        <PresentSegmentedControl mode={mode} onChange={setMode} />
        {mode === 'card' ? (
          <CardMode
            model={model}
            ownerName={
              trimmedOwnerName !== undefined && trimmedOwnerName.length > 0
                ? trimmedOwnerName
                : null
            }
            shareRecord={shareRecord}
            shareJws={shareJws}
            nostrShortUrlReady={nostrShortUrlReady}
            onRetry={() => { setCardRetryNonce((value) => value + 1); }}
            onSetPreference={(key, value) => { preferences.set(key, value); }}
          />
        ) : (
          <AttestationsMode
            claims={passportClaims}
            state={attestationsState}
            onRetry={() => { setIdentityRetryNonce((value) => value + 1); }}
          />
        )}
      </ScrollView>
    </View>
  );
}

function PresentHeader({ onScan }: { readonly onScan: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center justify-between gap-3 px-4"
      style={{ minHeight: 56 }}
    >
      <ThemedText accessibilityRole="header" variant="titleLarge">
        {t('present.title')}
      </ThemedText>
      <ThemedButton
        label={t('present.scanSomeone')}
        variant="secondary"
        size="sm"
        onPress={onScan}
      />
    </View>
  );
}

function PresentSegmentedControl({
  mode,
  onChange,
}: {
  readonly mode: PresentMode;
  readonly onChange: (mode: PresentMode) => void;
}): ReactNode {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const options: readonly { readonly mode: PresentMode; readonly label: string }[] = [
    { mode: 'card', label: t('present.card') },
    { mode: 'attestations', label: t('present.attestations') },
  ];

  return (
    <ThemedSurface
      accessibilityRole="tablist"
      variant="inset"
      className="flex-row rounded-none p-1"
    >
      {options.map((option) => {
        const selected = option.mode === mode;
        return (
          <PressableScale
            key={option.mode}
            fill
            haptic="tap"
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            onPress={() => { onChange(option.mode); }}
            style={{
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? colors.primaryMauve : 'transparent',
            }}
          >
            <ThemedText
              variant="label"
              style={selected ? { color: readableTextOn(colors.primaryMauve) } : undefined}
            >
              {option.label}
            </ThemedText>
          </PressableScale>
        );
      })}
    </ThemedSurface>
  );
}

function CardMode({
  model,
  ownerName,
  shareRecord,
  shareJws,
  nostrShortUrlReady,
  onRetry,
  onSetPreference,
}: {
  readonly model: PresentModel;
  readonly ownerName: string | null;
  readonly shareRecord: ProfileRecord | null;
  readonly shareJws: string | null;
  readonly nostrShortUrlReady: boolean;
  readonly onRetry: () => void;
  readonly onSetPreference: (
    key: PresentCardOnlyField['preferenceKey'],
    value: boolean
  ) => void;
}): ReactNode {
  return (
    <View className="gap-6">
      {shareRecord !== null && shareJws !== null ? (
        <PresentCardWithPageUrl
          model={model}
          ownerName={ownerName}
          shareRecord={shareRecord}
          shareJws={shareJws}
          nostrShortUrlReady={nostrShortUrlReady}
        />
      ) : (
        <PresentCard model={model} ownerName={ownerName} page={null} />
      )}
      <PublicPageSection model={model} />
      <CardOnlySection
        model={model}
        onRetry={onRetry}
        onSetPreference={onSetPreference}
      />
    </View>
  );
}

function PublicPageSection({ model }: { readonly model: PresentModel }): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <SectionHeading title={t('present.publicPage')} />
      {model.publicLinks.length === 0 ? (
        <ThemedSurface variant="outlined" padded className="rounded-none">
          <ThemedText variant="bodyMedium" tone="tertiary">
            {t('present.noPublicLinks')}
          </ThemedText>
        </ThemedSurface>
      ) : (
        <View className="gap-2">
          {model.publicLinks.map(({ link, sourceIndex }) => (
            <ThemedSurface
              key={`${String(sourceIndex)}-${link.label}-${link.url}`}
              variant="inset"
              className="flex-row items-center gap-3 rounded-none px-4 py-3"
              style={{ minHeight: 56 }}
            >
              <SfIcon name="link" size={15} />
              <View className="flex-1 gap-0.5">
                {link.label.trim().length > 0 ? (
                  <ThemedText variant="bodyMedium" numberOfLines={1}>
                    {link.label}
                  </ThemedText>
                ) : null}
                <ThemedText
                  variant="caption"
                  tone="tertiary"
                  numberOfLines={1}
                  ellipsizeMode="middle"
                >
                  {link.url}
                </ThemedText>
              </View>
            </ThemedSurface>
          ))}
        </View>
      )}
      <ThemedText variant="bodySmall" tone="tertiary">
        {t('present.publicPageHint')}
      </ThemedText>
    </View>
  );
}

function CardOnlySection({
  model,
  onRetry,
  onSetPreference,
}: {
  readonly model: PresentModel;
  readonly onRetry: () => void;
  readonly onSetPreference: (
    key: PresentCardOnlyField['preferenceKey'],
    value: boolean
  ) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="gap-3">
      <SectionHeading title={t('present.cardOnly')} />
      {model.cardState.kind === 'loading' ? (
        <ThemedSurface
          variant="outlined"
          padded
          className="items-center gap-3 rounded-none"
        >
          <ActivityIndicator />
          <ThemedText variant="bodySmall" tone="tertiary">
            {t('present.loadingCard')}
          </ThemedText>
        </ThemedSurface>
      ) : null}
      {model.cardState.kind === 'error' ? (
        <ThemedSurface variant="outlined" padded className="gap-3 rounded-none">
          <ThemedText variant="bodyMedium" tone="error">
            {t('present.cardLoadError')}
          </ThemedText>
          <ThemedButton
            label={t('present.retry')}
            variant="secondary"
            onPress={onRetry}
          />
        </ThemedSurface>
      ) : null}
      {model.cardState.kind === 'empty' ? (
        <ThemedSurface variant="outlined" padded className="gap-4 rounded-none">
          <ThemedText variant="bodyMedium" tone="tertiary">
            {t('present.noCard')}
          </ThemedText>
          <ThemedButton
            label={t('present.createCard')}
            variant="secondary"
            fullWidth
            onPress={() => { router.push('/cards/edit'); }}
          />
        </ThemedSurface>
      ) : null}
      {model.cardState.kind === 'ready' ? (
        <>
          {model.mandatoryName !== null ? (
            <ThemedSurface
              variant="inset"
              className="flex-row items-center gap-3 rounded-none px-4 py-3"
              style={{ minHeight: 56 }}
            >
              <SfIcon name="person.fill" size={15} />
              <View className="flex-1 gap-0.5">
                <ThemedText variant="bodyMedium">{t('present.field.name')}</ThemedText>
                <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
                  {model.mandatoryName}
                </ThemedText>
              </View>
              <ThemedText variant="caption" tone="accent">
                {t('present.alwaysIncluded')}
              </ThemedText>
            </ThemedSurface>
          ) : null}
          {model.cardOnlyFields.map((field) => (
            <CardFieldToggle
              key={field.field}
              field={field}
              onValueChange={(value) => { onSetPreference(field.preferenceKey, value); }}
            />
          ))}
          {model.cardOnlyFields.length === 0 ? (
            <ThemedSurface variant="outlined" padded className="rounded-none">
              <ThemedText variant="bodyMedium" tone="tertiary">
                {t('present.noOptionalCardFields')}
              </ThemedText>
            </ThemedSurface>
          ) : null}
          <ThemedText variant="bodySmall" tone="tertiary">
            {t('present.cardQrHint')}
          </ThemedText>
          <ThemedButton
            label={t('present.showCardQr')}
            variant="secondary"
            fullWidth
            onPress={() => { router.push('/settings/share-settings'); }}
          />
        </>
      ) : null}
    </View>
  );
}

function CardFieldToggle({
  field,
  onValueChange,
}: {
  readonly field: PresentCardOnlyField;
  readonly onValueChange: (value: boolean) => void;
}): ReactNode {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <ThemedSurface
      variant="inset"
      className="flex-row items-center gap-3 rounded-none px-4 py-3"
      style={{ minHeight: 56 }}
    >
      <SfIcon name={fieldIcon(field.field)} size={15} />
      <View className="flex-1 gap-0.5">
        <ThemedText variant="bodyMedium">
          {t(`present.field.${field.field}`)}
        </ThemedText>
        <ThemedText variant="caption" tone="tertiary" numberOfLines={1}>
          {field.values.join(' · ')}
        </ThemedText>
      </View>
      <Switch
        accessibilityLabel={t(`present.field.${field.field}`)}
        value={field.selected}
        onValueChange={onValueChange}
        trackColor={{ false: colors.divider, true: colors.primaryMauve }}
        thumbColor={colors.cardBg}
      />
    </ThemedSurface>
  );
}

function SectionHeading({ title }: { readonly title: string }): ReactNode {
  return (
    <ThemedText accessibilityRole="header" variant="label" tone="tertiary">
      {title}
    </ThemedText>
  );
}

function fieldIcon(field: PresentCardOnlyField['field']): SFSymbol {
  switch (field) {
    case 'title': return 'briefcase';
    case 'company': return 'building.2';
    case 'email': return 'envelope';
    case 'phone': return 'phone';
    case 'socialNetworks': return 'link';
    case 'skills': return 'star';
  }
}
