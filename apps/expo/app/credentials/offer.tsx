/**
 * Receive Credential — port of
 * solidarity/Views/ScanViews/CredentialImportFlowSheet.swift.
 *
 * Mirrors the OID4VCI inbound flow with the same six-step state machine:
 *   loading → review(offer) → pinEntry(offer) → fetching →
 *   success(message) | error(message)
 *
 * Token exchange + credential request are stubbed — the real
 * CredentialIssuanceService is not ported yet. "Accept & Import"
 * transitions to fetching, then to success after 700 ms so the UI flow is
 * exercisable. Replace `startIssuance` with the real call once
 * `src/oidc/credentialIssuance.ts` lands.
 */
import { router, useLocalSearchParams } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// MARK: - Parsed offer

interface ParsedOffer {
  readonly credentialIssuer: string;
  readonly credentialConfigurationIds: readonly string[];
  readonly preAuthorizedCode?: string;
  readonly userPinRequired: boolean;
}

interface RawOffer {
  readonly credential_issuer?: string;
  readonly credential_configuration_ids?: readonly string[];
  readonly grants?: Readonly<
    Record<
      string,
      {
        readonly ['pre-authorized_code']?: string;
        readonly user_pin_required?: boolean;
      }
    >
  >;
}

function parseOfferQuery(query: string): ParsedOffer | null {
  try {
    let raw = query;
    if (query.includes('credential_offer=')) {
      const p = new URLSearchParams(query).get('credential_offer');
      if (p) raw = p;
    }
    const obj = JSON.parse(raw) as RawOffer;
    const grant = obj.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code'];
    return {
      credentialIssuer: obj.credential_issuer ?? 'unknown',
      credentialConfigurationIds: obj.credential_configuration_ids ?? [],
      preAuthorizedCode: grant?.['pre-authorized_code'],
      userPinRequired: grant?.user_pin_required === true,
    };
  } catch {
    return null;
  }
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
  return (
    <Text style={{ fontFamily: MONO, fontSize: size, color, fontWeight: weight ?? '400' }}>
      {text}
    </Text>
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
        <Text className="text-text2 text-[14px] text-center" style={{ paddingHorizontal: 16 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

// MARK: - Step views

function LoadingView() {
  return (
    <View className="flex-1 items-center justify-center gap-5">
      <ActivityIndicator size="large" color={Colors.terminalGreen} />
      <Text style={{ fontFamily: MONO, fontSize: 14, color: Colors.text2 }}>
        Parsing credential offer...
      </Text>
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
  return (
    <View className="flex-1 gap-4">
      <View
        style={{
          backgroundColor: Colors.searchBg,
          borderWidth: 1,
          borderColor: Colors.divider,
          padding: 16,
          gap: 12,
        }}
      >
        <MonoText text="— ISSUER" size={11} color={Colors.text2} weight="700" />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SfIcon name="building.2" size={16} color={Colors.terminalGreen} />
          <Text
            style={{
              fontFamily: MONO,
              fontSize: 16,
              fontWeight: '600',
              color: Colors.terminalGreen,
              flex: 1,
            }}
            numberOfLines={1}
          >
            {issuerDisplayName(offer)}
          </Text>
        </View>

        <Divider />
        <MonoText text="— CREDENTIALS OFFERED" size={11} color={Colors.text2} weight="700" />
        {offer.credentialConfigurationIds.map((credType) => (
          <View
            key={credType}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <SfIcon name="doc.badge.plus" size={14} color={Colors.text1} />
            <Text className="text-text1 text-[14px] flex-1">
              {credType.replace(/Credential/g, ' Credential')}
            </Text>
          </View>
        ))}

        {offer.preAuthorizedCode !== undefined ? (
          <>
            <Divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <SfIcon name="checkmark.shield.fill" size={12} color={Colors.terminalGreen} />
              <MonoText
                text="Pre-authorized"
                size={12}
                color={Colors.terminalGreen}
                weight="700"
              />
            </View>
          </>
        ) : null}
      </View>

      <View className="flex-1" />

      <ThemedButton label="Accept & Import" fullWidth onPress={onAccept} />
      <Pressable
        onPress={onDecline}
        accessibilityRole="button"
        accessibilityLabel="Decline"
        className="self-center px-2 py-3 active:opacity-60"
      >
        <MonoText text="Decline" size={14} color={Colors.text2} weight="700" />
      </Pressable>
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
  return (
    <View className="flex-1 items-center justify-center gap-5">
      <SfIcon name="lock.rectangle" size={48} color={Colors.terminalGreen} />
      <MonoText
        text="Issuer requires a PIN"
        size={18}
        color={Colors.text1}
        weight="700"
      />
      <TextInput
        value={userPin}
        onChangeText={onChangePin}
        placeholder="Enter PIN"
        placeholderTextColor={Colors.text3}
        keyboardType="number-pad"
        style={{
          maxWidth: 200,
          alignSelf: 'stretch',
          borderWidth: 1,
          borderColor: Colors.divider,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 10,
          color: Colors.text1,
          fontSize: 16,
          textAlign: 'center',
        }}
      />
      <View className="flex-1" />
      <ThemedButton
        label="Submit"
        fullWidth
        disabled={userPin.length === 0}
        onPress={onSubmit}
      />
    </View>
  );
}

function FetchingView() {
  return (
    <View className="flex-1 items-center justify-center gap-5">
      <ActivityIndicator size="large" color={Colors.terminalGreen} />
      <MonoText
        text="Fetching Credential"
        size={18}
        color={Colors.text1}
        weight="700"
      />
      <Text className="text-text2 text-[13px] text-center" style={{ paddingHorizontal: 16 }}>
        Authenticating and downloading from issuer.
      </Text>
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
  return (
    <View className="flex-1 gap-4">
      <CenteredStatus
        icon="checkmark.seal.fill"
        iconColor={Colors.terminalGreen}
        title="Credential Received"
        subtitle={message}
      />
      <ThemedButton label="Done" fullWidth onPress={onDone} />
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
  return (
    <View className="flex-1 gap-4">
      <CenteredStatus
        icon="xmark.seal"
        iconColor={Colors.destructive}
        title="Import Failed"
        subtitle={message}
      />
      <ThemedButton label="Retry" fullWidth onPress={onRetry} />
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="self-center px-2 py-3 active:opacity-60"
      >
        <MonoText text="Close" size={14} color={Colors.text2} weight="700" />
      </Pressable>
    </View>
  );
}

// MARK: - Screen

export default function ReceiveCredentialScreen() {
  const insets = useSafeAreaInsets();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [userPin, setUserPin] = useState('');

  const parseOffer = useMemo(
    () => () => {
      if (!q) {
        setStep({ kind: 'error', message: 'No credential offer provided.' });
        return;
      }
      const parsed = parseOfferQuery(q);
      if (!parsed) {
        setStep({ kind: 'error', message: 'Invalid credential offer.' });
        return;
      }
      setStep({ kind: 'review', offer: parsed });
    },
    [q]
  );

  useEffect(() => {
    setStep({ kind: 'loading' });
    const t = setTimeout(parseOffer, 150);
    return () => { clearTimeout(t); };
  }, [parseOffer]);

  const startIssuance = (offer: ParsedOffer) => {
    setStep({ kind: 'fetching' });
    setTimeout(() => {
      const typeName = offer.credentialConfigurationIds[0] ?? 'Credential';
      setStep({
        kind: 'success',
        message: `Stored ${typeName} from ${issuerDisplayName(offer)}`,
      });
    }, 700);
  };

  const onAccept = (offer: ParsedOffer) => {
    if (offer.userPinRequired) {
      setStep({ kind: 'pinEntry', offer });
    } else {
      startIssuance(offer);
    }
  };

  const onDismiss = () => { router.back(); };

  return (
    <View className="flex-1 bg-pageBg">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={{ paddingTop: insets.top }} className="bg-pageBg">
          <View className="h-11 flex-row items-center px-4">
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Close"
              className="px-1 py-1 active:opacity-60"
            >
              <Text className="text-text1 text-[17px]">Close</Text>
            </Pressable>
            <View className="flex-1 items-center">
              <Text className="text-text1 text-[17px] font-semibold">
                Receive Credential
              </Text>
            </View>
            <View style={{ width: 50 }} />
          </View>
        </View>

        <View className="flex-1 p-4">
          {step.kind === 'loading' ? <LoadingView /> : null}
          {step.kind === 'review' ? (
            <ReviewView
              offer={step.offer}
              onAccept={() => { onAccept(step.offer); }}
              onDecline={onDismiss}
            />
          ) : null}
          {step.kind === 'pinEntry' ? (
            <PinEntryView
              userPin={userPin}
              onChangePin={setUserPin}
              onSubmit={() => { startIssuance(step.offer); }}
            />
          ) : null}
          {step.kind === 'fetching' ? <FetchingView /> : null}
          {step.kind === 'success' ? (
            <SuccessView message={step.message} onDone={onDismiss} />
          ) : null}
          {step.kind === 'error' ? (
            <ErrorView
              message={step.message}
              onRetry={parseOffer}
              onClose={onDismiss}
            />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
