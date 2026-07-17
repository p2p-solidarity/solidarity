/**
 * Receive Credential — port of
 * solidarity/Views/ScanViews/CredentialImportFlowSheet.swift.
 *
 * Mirrors the OID4VCI inbound flow with the same six-step state machine:
 *   loading → review(offer) → pinEntry(offer) → fetching →
 *   success(message) | error(message)
 *
 * Issuance now drives the real CredentialIssuanceService (token exchange +
 * proof-of-possession + credential request + persistence). The success
 * step routes to `/credentials/[id]` so the user can immediately review
 * the newly stored VC.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { PressableScale } from '@/components/common/PressableScale';
import { ThemedButton, ThemedSurface, ThemedText, ThemedTextInput } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useActiveDid } from '@/identity';
import {
  fetchIssuerMetadata,
  parseCredentialOffer,
  requestCredential,
  type CredentialOffer,
} from '@/oidc/credentialIssuance';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// MARK: - Parsed offer

interface ParsedOffer {
  readonly credentialIssuer: string;
  readonly credentialConfigurationIds: readonly string[];
  readonly preAuthorizedCode?: string;
  readonly userPinRequired: boolean;
  readonly raw: CredentialOffer;
}

function parseOfferQuery(query: string): ParsedOffer | null {
  const candidates: string[] = [];
  candidates.push(query);
  try {
    const usp = new URLSearchParams(query);
    const inline = usp.get('credential_offer');
    if (inline) candidates.push(inline);
  } catch {
    // not URL-encoded; fall through with raw query
  }
  for (const candidate of candidates) {
    const result = parseCredentialOffer(candidate);
    if (result.ok) {
      const offer = result.value;
      return {
        credentialIssuer: offer.credentialIssuer,
        credentialConfigurationIds: offer.credentialConfigurationIds,
        ...(offer.preAuthorizedCode !== undefined
          ? { preAuthorizedCode: offer.preAuthorizedCode }
          : {}),
        userPinRequired: offer.txCode !== undefined,
        raw: offer,
      };
    }
  }
  return null;
}

function issuerDisplayName(offer: ParsedOffer): string {
  try {
    return new URL(offer.credentialIssuer).host;
  } catch {
    return offer.credentialIssuer;
  }
}

// MARK: - Step state

type Step =
  | { readonly kind: 'loading' }
  | { readonly kind: 'review'; readonly offer: ParsedOffer }
  | { readonly kind: 'pinEntry'; readonly offer: ParsedOffer }
  | { readonly kind: 'fetching' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

// MARK: - Atoms

function MonoText({
  text,
  size,
  color,
  weight,
}: {
  readonly text: string;
  readonly size: number;
  readonly color: string;
  readonly weight?: '400' | '500' | '600' | '700';
}) {
  const variant =
    size >= 18 ? 'titleLarge' : size >= 16 ? 'titleMedium' : size >= 14 ? 'bodySmall' : 'caption';
  return (
    <ThemedText variant={variant} style={{ fontFamily: MONO, color, fontWeight: weight ?? '400' }}>
      {text}
    </ThemedText>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.divider }} />;
}

function CenteredStatus({
  icon,
  iconColor,
  title,
  subtitle,
}: {
  readonly icon: SFSymbol;
  readonly iconColor: string;
  readonly title: string;
  readonly subtitle?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4">
      <SfIcon name={icon} size={48} color={iconColor} />
      <MonoText text={title} size={20} color={Colors.text1} weight="700" />
      {subtitle ? (
        <ThemedText
          variant="bodySmall"
          tone="secondary"
          style={{ paddingHorizontal: 16, textAlign: 'center' }}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

// MARK: - Step views

function LoadingView() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center gap-5">
      <ActivityIndicator size="large" color={Colors.terminalGreen} />
      <ThemedText variant="bodySmall" tone="secondary" style={{ fontFamily: MONO }}>
        {t('receiveCred.parsing')}
      </ThemedText>
    </View>
  );
}

function ReviewView({
  offer,
  onAccept,
  onDecline,
}: {
  readonly offer: ParsedOffer;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 gap-4">
      <ThemedSurface
        variant="inset"
        className="rounded-none"
        style={{
          borderWidth: 1,
          borderColor: Colors.divider,
          padding: 16,
          gap: 12,
        }}>
        <MonoText text={t('receiveCred.issuerLabel')} size={11} color={Colors.text2} weight="700" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SfIcon name="building.2" size={16} color={Colors.terminalGreen} />
          <ThemedText
            variant="titleMedium"
            style={{
              fontFamily: MONO,
              fontWeight: '600',
              color: Colors.terminalGreen,
              flex: 1,
            }}
            numberOfLines={1}>
            {issuerDisplayName(offer)}
          </ThemedText>
        </View>

        <Divider />
        <MonoText
          text={t('receiveCred.credentialsOfferedLabel')}
          size={11}
          color={Colors.text2}
          weight="700"
        />
        {offer.credentialConfigurationIds.map((credType) => (
          <View key={credType} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SfIcon name="doc.badge.plus" size={14} color={Colors.text1} />
            <ThemedText variant="bodySmall" style={{ flex: 1 }}>
              {credType.replace(/Credential/g, ' Credential')}
            </ThemedText>
          </View>
        ))}

        {offer.preAuthorizedCode !== undefined ? (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <SfIcon name="checkmark.shield.fill" size={12} color={Colors.terminalGreen} />
              <MonoText
                text={t('receiveCred.preAuthorized')}
                size={12}
                color={Colors.terminalGreen}
                weight="700"
              />
            </View>
          </>
        ) : null}
      </ThemedSurface>

      <View className="flex-1" />

      <ThemedButton label={t('receiveCred.acceptImport')} fullWidth onPress={onAccept} />
      <ThemedButton
        label={t('receiveCred.decline')}
        variant="secondary"
        fullWidth
        onPress={onDecline}
      />
    </View>
  );
}

function PinEntryView({
  userPin,
  onChangePin,
  onSubmit,
}: {
  readonly userPin: string;
  readonly onChangePin: (s: string) => void;
  readonly onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center gap-5">
      <SfIcon name="lock.rectangle" size={48} color={Colors.terminalGreen} />
      <MonoText text={t('receiveCred.pinRequired')} size={18} color={Colors.text1} weight="700" />
      <View style={{ width: '100%', maxWidth: 200 }}>
        <ThemedTextInput
          value={userPin}
          onChangeText={onChangePin}
          placeholder={t('receiveCred.pinPlaceholder')}
          keyboardType="number-pad"
        />
      </View>
      <View className="flex-1" />
      <ThemedButton
        label={t('receiveCred.submit')}
        fullWidth
        disabled={userPin.length === 0}
        onPress={onSubmit}
      />
    </View>
  );
}

function FetchingView() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center gap-5">
      <ActivityIndicator size="large" color={Colors.terminalGreen} />
      <MonoText text={t('receiveCred.fetching')} size={18} color={Colors.text1} weight="700" />
      <ThemedText
        variant="bodySmall"
        tone="secondary"
        style={{ paddingHorizontal: 16, textAlign: 'center' }}>
        {t('receiveCred.fetchingDetail')}
      </ThemedText>
    </View>
  );
}

function SuccessView({
  message,
  onDone,
}: {
  readonly message: string;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 gap-4">
      <CenteredStatus
        icon="checkmark.seal.fill"
        iconColor={Colors.terminalGreen}
        title={t('receiveCred.receivedTitle')}
        subtitle={message}
      />
      <ThemedButton label={t('receiveCred.done')} fullWidth onPress={onDone} />
    </View>
  );
}

function ErrorView({
  message,
  onRetry,
  onClose,
}: {
  readonly message: string;
  readonly onRetry: () => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 gap-4">
      <CenteredStatus
        icon="xmark.seal"
        iconColor={Colors.destructive}
        title={t('receiveCred.importFailed')}
        subtitle={message}
      />
      <ThemedButton label={t('receiveCred.retry')} fullWidth onPress={onRetry} />
      <ThemedButton
        label={t('receiveCred.close')}
        variant="secondary"
        fullWidth
        onPress={onClose}
      />
    </View>
  );
}

// MARK: - Screen

export default function ReceiveCredentialScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const activeDid = useActiveDid();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [userPin, setUserPin] = useState('');

  const parseOffer = useMemo(
    () => () => {
      if (!q) {
        setStep({ kind: 'error', message: t('receiveCred.errNoOffer') });
        return;
      }
      const parsed = parseOfferQuery(q);
      if (!parsed) {
        setStep({ kind: 'error', message: t('receiveCred.errInvalidOffer') });
        return;
      }
      setStep({ kind: 'review', offer: parsed });
    },
    [q, t]
  );

  useEffect(() => {
    setStep({ kind: 'loading' });
    const t = setTimeout(parseOffer, 150);
    return () => {
      clearTimeout(t);
    };
  }, [parseOffer]);

  const startIssuance = async (offer: ParsedOffer, pin?: string) => {
    if (!activeDid) {
      setStep({ kind: 'error', message: t('receiveCred.errNoIdentity') });
      return;
    }
    setStep({ kind: 'fetching' });
    const metadataResult = await fetchIssuerMetadata(offer.credentialIssuer);
    if (!metadataResult.ok) {
      setStep({ kind: 'error', message: metadataResult.error.message });
      return;
    }
    const credentialResult = await requestCredential({
      offer: offer.raw,
      metadata: metadataResult.value,
      holderDid: activeDid,
      ...(pin ? { userPin: pin } : {}),
    });
    if (!credentialResult.ok) {
      setStep({ kind: 'error', message: credentialResult.error.message });
      return;
    }
    const stored = credentialResult.value;
    pushToast(t('receiveCred.receivedToast'), 'success');
    setStep({
      kind: 'success',
      message: t('receiveCred.storedMessage', {
        title: stored.title,
        issuer: issuerDisplayName(offer),
      }),
    });
    setTimeout(() => {
      router.replace({ pathname: '/credentials/[id]', params: { id: stored.id } });
    }, 600);
  };

  const onAccept = (offer: ParsedOffer) => {
    if (offer.userPinRequired) {
      setStep({ kind: 'pinEntry', offer });
    } else {
      void startIssuance(offer);
    }
  };

  const onDismiss = () => {
    safeBack();
  };

  return (
    <View className="flex-1 bg-pageBg">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ paddingTop: insets.top }} className="bg-pageBg">
          <View className="h-11 flex-row items-center px-4">
            <PressableScale
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t('receiveCred.close')}
              className="px-1 py-1">
              <ThemedText variant="bodyLarge">{t('receiveCred.close')}</ThemedText>
            </PressableScale>
            <View className="flex-1 items-center">
              <ThemedText variant="titleMedium">{t('receiveCred.title')}</ThemedText>
            </View>
            <View style={{ width: 50 }} />
          </View>
        </View>

        <View className="flex-1 p-4">
          {step.kind === 'loading' ? <LoadingView /> : null}
          {step.kind === 'review' ? (
            <ReviewView
              offer={step.offer}
              onAccept={() => {
                onAccept(step.offer);
              }}
              onDecline={onDismiss}
            />
          ) : null}
          {step.kind === 'pinEntry' ? (
            <PinEntryView
              userPin={userPin}
              onChangePin={setUserPin}
              onSubmit={() => {
                void startIssuance(step.offer, userPin);
              }}
            />
          ) : null}
          {step.kind === 'fetching' ? <FetchingView /> : null}
          {step.kind === 'success' ? (
            <SuccessView message={step.message} onDone={onDismiss} />
          ) : null}
          {step.kind === 'error' ? (
            <ErrorView message={step.message} onRetry={parseOffer} onClose={onDismiss} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
