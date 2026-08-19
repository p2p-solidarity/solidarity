import { router } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProfileRecord } from '@solidarity/shared';
import { useCardStore, useMyCardDetail } from '@/cards/cardManager';
import { PressableScale } from '@/components/common/PressableScale';
import { BrandIcon } from '@/components/icons/BrandIcon';
import { PageHeaderAction } from '@/components/me/PageHeaderAction';
import { PageSectionLabel } from '@/components/me/PageSectionLabel';
import { ROW_RADIUS, blockRowStyle } from '@/components/me/pageRowStyles';
import { PresentAttestationsMode as AttestationsMode } from '@/components/present/PresentAttestations';
import { PresentCard, PresentCardWithPageUrl } from '@/components/present/PresentCard';
import type { PublicPageShareSource } from '@/components/me/meProfileModel';
import {
  ThemedButton,
  ThemedSurface,
  ThemedText,
} from '@/components/themed';
import { Colors } from '@/constants/Colors';
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
import { brandIconForLink } from '@/profile/linkPresentation';
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
  const publicPage: PublicPageShareSource | null = published
    ? { record: published.record, jws: published.jws }
    : null;
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
          gap: 16,
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
            publicPage={publicPage}
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

/** `.phead` — centred screen title with the scan action pinned right, the
 *  same 34pt outlined square the Page tab's header actions use. */
function PresentHeader({ onScan }: { readonly onScan: () => void }): ReactNode {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center px-4" style={{ minHeight: 56 }}>
      <ThemedText
        accessibilityRole="header"
        variant="titleLarge"
        style={{ flex: 1, textAlign: 'center' }}
      >
        {t('present.title')}
      </ThemedText>
      <View style={{ position: 'absolute', right: 16 }}>
        <PageHeaderAction
          icon="qrcode.viewfinder"
          label={t('present.scanSomeone')}
          onPress={onScan}
        />
      </View>
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
      className="flex-row"
      style={{ borderRadius: ROW_RADIUS, padding: 4 }}
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
              backgroundColor: selected ? colors.invertedButtonBg : 'transparent',
              borderRadius: ROW_RADIUS,
            }}
          >
            <ThemedText
              variant="label"
              style={{ color: selected ? colors.invertedButtonText : colors.text2 }}
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
  publicPage,
  nostrShortUrlReady,
  onRetry,
  onSetPreference,
}: {
  readonly model: PresentModel;
  readonly ownerName: string | null;
  readonly shareRecord: ProfileRecord | null;
  readonly shareJws: string | null;
  readonly publicPage: PublicPageShareSource | null;
  readonly nostrShortUrlReady: boolean;
  readonly onRetry: () => void;
  readonly onSetPreference: (
    key: PresentCardOnlyField['preferenceKey'],
    value: boolean
  ) => void;
}): ReactNode {
  return (
    <View className="gap-5">
      {model.cardState.kind === 'ready' ? (
        shareRecord !== null && shareJws !== null ? (
          <PresentCardWithPageUrl
            model={model}
            ownerName={ownerName}
            shareRecord={shareRecord}
            shareJws={shareJws}
            publicPage={publicPage}
            nostrShortUrlReady={nostrShortUrlReady}
          />
        ) : (
          <PresentCard model={model} ownerName={ownerName} page={null} />
        )
      ) : null}
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
      <PageSectionLabel title={t('present.publicPage')} />
      {model.publicLinks.length === 0 ? (
        <ThemedSurface variant="outlined" padded className="rounded-none">
          <ThemedText variant="bodyMedium" tone="tertiary">
            {t('present.noPublicLinks')}
          </ThemedText>
        </ThemedSurface>
      ) : (
        <PublicLinkGroup links={model.publicLinks} />
      )}
    </View>
  );
}

/**
 * `.xfixed` — the public-page fields, drawn as ONE grouped block with hairline
 * separators and no controls at all. The mock's rule: a public field is always
 * given, so it must not look like something you can switch off ("沒有控制項
 * 就是不能調").
 */
function PublicLinkGroup({
  links,
}: {
  readonly links: PresentModel['publicLinks'];
}): ReactNode {
  const colors = useThemeColors();
  return (
    <View style={{ borderRadius: ROW_RADIUS, overflow: 'hidden', backgroundColor: colors.mutedSurface }}>
      {links.map(({ link, sourceIndex }, index) => (
        <View
          key={`${String(sourceIndex)}-${link.label}-${link.url}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: colors.divider,
          }}
        >
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.chipSurface,
            }}
          >
            <BrandIcon
              name={brandIconForLink(link.label, link.url)}
              size={15}
              color={Colors.primaryBlue}
            />
          </View>
          {link.label.trim().length > 0 ? (
            <ThemedText variant="label" numberOfLines={1}>
              {link.label}
            </ThemedText>
          ) : null}
          <ThemedText
            variant="caption"
            tone="secondary"
            numberOfLines={1}
            ellipsizeMode="middle"
            style={{ marginLeft: 'auto', maxWidth: '52%', fontFamily: 'Menlo' }}
          >
            {link.url}
          </ThemedText>
        </View>
      ))}
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
      <PageSectionLabel title={t('present.cardOnly')} />
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
          {/* No row for the name. It is always on the card and cannot be
              switched off, so listing it among switches reads as a toggle
              that is stuck — the mock keeps this list purely optional
              fields and lets the card itself show the name. */}
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

/** `.tglrow` — label, the value you are about to hand over, and the switch.
 *  No leading icon: the mock's toggle rows carry none. */
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
    <View style={blockRowStyle(colors.mutedSurface)}>
      <View className="flex-1" style={{ gap: 1 }}>
        <ThemedText variant="bodyMedium">
          {t(`present.field.${field.field}`)}
        </ThemedText>
        <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
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
    </View>
  );
}
