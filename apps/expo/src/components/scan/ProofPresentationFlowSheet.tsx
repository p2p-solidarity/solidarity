/**
 * ProofPresentationFlowSheet — 1:1 port of
 * solidarity/Views/ScanViews/ProofPresentationFlowSheet.swift.
 *
 * Multi-step modal driven by the OID4VP request scanned from a verifier
 * QR. Steps: parse → review (verifier + requested claims) → sign → done.
 *
 * The actual signing pipeline (BiometricGatekeeper + VCService +
 * OID4VPPresentationService) is not yet wired in apps/expo, so the
 * sign step emits a placeholder vp_token derived from the request nonce
 * and surfaces a toast — keeping the UI parity-complete while the
 * crypto layer lands.
 */
import { type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { parseOidcRequest, type ParsedOidcRequest } from '@/oidc';

type Step = 'review' | 'signing' | 'submitted';
type ParseState =
  | { kind: 'loading' }
  | { kind: 'ready'; parsed: ParsedOidcRequest }
  | { kind: 'failed'; message: string };

export interface ProofPresentationFlowSheetProps {
  readonly visible: boolean;
  readonly requestPayload: string;
  readonly onClose: () => void;
}

export function ProofPresentationFlowSheet({
  visible,
  requestPayload,
  onClose,
}: ProofPresentationFlowSheetProps): ReactNode {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={onClose}
    >
      <FlowBody requestPayload={requestPayload} onClose={onClose} />
    </Modal>
  );
}

function FlowBody({
  requestPayload,
  onClose,
}: {
  readonly requestPayload: string;
  readonly onClose: () => void;
}): ReactNode {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('review');
  const [parseState, setParseState] = useState<ParseState>({ kind: 'loading' });
  const [submittedToken, setSubmittedToken] = useState('');

  useEffect(() => {
    try {
      const parsed = parseOidcRequest(requestPayload);
      setParseState({ kind: 'ready', parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse request.';
      setParseState({ kind: 'failed', message });
    }
  }, [requestPayload]);

  const verifierDomain = resolveVerifierDomain(parseState, requestPayload);
  const requestedClaims = resolveRequestedClaims(parseState);

  const submit = (): void => {
    if (parseState.kind !== 'ready') {
      const reason =
        parseState.kind === 'failed'
          ? parseState.message
          : 'Authorization request is still loading.';
      pushToast(reason, 'warning');
      return;
    }
    setStep('signing');
    // Placeholder for the real biometric-gated VP signing pipeline.
    // The Swift app calls BiometricGatekeeper + VCService here; the Expo
    // crypto layer lands in a later wave. We mimic the latency so the
    // UI transitions feel native instead of jumping straight to success.
    setTimeout(() => {
      const token = `vp_token_${parseState.parsed.request.nonce ?? 'pending'}`;
      setSubmittedToken(token);
      setStep('submitted');
      pushToast('Proof signing lands next iteration.', 'warning');
    }, 800);
  };

  return (
    <View
      style={{ flex: 1, backgroundColor: Colors.pageBg, paddingTop: insets.top }}
    >
      <Toolbar onClose={onClose} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {step === 'review' ? (
          <ReviewStep
            parseState={parseState}
            verifierDomain={verifierDomain}
            requestedClaims={requestedClaims}
            onSubmit={submit}
          />
        ) : null}
        {step === 'signing' ? <SigningStep /> : null}
        {step === 'submitted' ? (
          <SubmittedStep
            verifierDomain={verifierDomain}
            submittedToken={submittedToken}
            onClose={onClose}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

function Toolbar({ onClose }: { readonly onClose: () => void }): ReactNode {
  return (
    <View
      className="flex-row items-center justify-between"
      style={{ paddingHorizontal: 16, height: 44 }}
    >
      <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
        <ThemedText variant="bodyLarge">Close</ThemedText>
      </Pressable>
      <ThemedText variant="titleMedium">Present Proof</ThemedText>
      <View style={{ width: 60 }} />
    </View>
  );
}

function ReviewStep({
  parseState,
  verifierDomain,
  requestedClaims,
  onSubmit,
}: {
  readonly parseState: ParseState;
  readonly verifierDomain: string;
  readonly requestedClaims: readonly string[];
  readonly onSubmit: () => void;
}): ReactNode {
  const isLoading = parseState.kind === 'loading';
  const isReady = parseState.kind === 'ready';

  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          gap: 12,
          padding: 16,
          backgroundColor: Colors.searchBg,
          borderWidth: 1,
          borderColor: Colors.divider,
        }}
      >
        <ThemedText
          variant="caption"
          tone="secondary"
          style={{ fontFamily: 'Menlo', fontWeight: '700' }}
        >
          — VERIFIER
        </ThemedText>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <SfIcon name="building.2" size={16} color={Colors.terminalGreen} />
          <ThemedText
            variant="titleMedium"
            style={{ color: Colors.terminalGreen, fontFamily: 'Menlo' }}
            numberOfLines={1}
          >
            {verifierDomain}
          </ThemedText>
        </View>

        {requestedClaims.length > 0 ? (
          <>
            <View style={{ height: 1, backgroundColor: Colors.divider }} />
            <ThemedText
              variant="caption"
              tone="secondary"
              style={{ fontFamily: 'Menlo', fontWeight: '700' }}
            >
              — REQUESTED CLAIMS
            </ThemedText>
            {requestedClaims.map((claim, idx) => (
              <View
                key={`${String(idx)}-${claim}`}
                className="flex-row items-center"
                style={{ gap: 8 }}
              >
                <SfIcon name="checkmark.shield" size={14} color={Colors.text1} />
                <ThemedText variant="bodyMedium">{claim}</ThemedText>
              </View>
            ))}
          </>
        ) : null}

        {parseState.kind === 'failed' ? (
          <>
            <View style={{ height: 1, backgroundColor: Colors.divider }} />
            <ThemedText variant="caption" tone="error">
              {parseState.message}
            </ThemedText>
          </>
        ) : null}
      </View>

      <ThemedButton
        fullWidth
        label={submitButtonLabel(parseState)}
        disabled={!isReady}
        onPress={onSubmit}
      />

      {isLoading ? (
        <View className="flex-row items-center justify-center" style={{ gap: 8 }}>
          <ActivityIndicator color={Colors.featureAccent} />
          <ThemedText variant="caption" tone="secondary">
            Parsing request…
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function SigningStep(): ReactNode {
  return (
    <View style={{ alignItems: 'center', gap: 14, paddingVertical: 40 }}>
      <ActivityIndicator size="large" color={Colors.terminalGreen} />
      <ThemedText
        variant="titleMedium"
        style={{ fontFamily: 'Menlo' }}
      >
        Signing Proof
      </ThemedText>
      <ThemedText
        variant="bodySmall"
        tone="secondary"
        style={{ textAlign: 'center', paddingHorizontal: 16 }}
      >
        Applying pairwise DID and biometric gate.
      </ThemedText>
    </View>
  );
}

function SubmittedStep({
  verifierDomain,
  submittedToken,
  onClose,
}: {
  readonly verifierDomain: string;
  readonly submittedToken: string;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <View style={{ alignItems: 'center', gap: 14, paddingVertical: 24 }}>
      <SfIcon name="checkmark.seal.fill" size={48} color={Colors.terminalGreen} />
      <ThemedText
        variant="titleLarge"
        style={{ fontFamily: 'Menlo' }}
      >
        Proof Submitted
      </ThemedText>
      <ThemedText variant="bodyMedium" tone="secondary">
        {`Submitted to ${verifierDomain}`}
      </ThemedText>
      <ThemedText
        variant="caption"
        tone="tertiary"
        style={{ fontFamily: 'Menlo', textAlign: 'center', paddingHorizontal: 12 }}
        numberOfLines={2}
      >
        {`${submittedToken.slice(0, 80)}…`}
      </ThemedText>
      <View style={{ height: 12 }} />
      <ThemedButton fullWidth label="Done" onPress={onClose} />
    </View>
  );
}

function submitButtonLabel(parseState: ParseState): string {
  if (parseState.kind === 'loading') return 'Loading request…';
  if (parseState.kind === 'failed') return 'Request invalid';
  return 'Sign & Submit';
}

function resolveVerifierDomain(parseState: ParseState, payload: string): string {
  if (parseState.kind === 'ready') {
    const target =
      parseState.parsed.request.redirect_uri ?? parseState.parsed.request.client_id;
    try {
      return new URL(target).host || target;
    } catch {
      // Fall through.
    }
  }
  try {
    return new URL(payload).host || 'Unknown verifier';
  } catch {
    return 'Unknown verifier';
  }
}

function resolveRequestedClaims(parseState: ParseState): readonly string[] {
  if (parseState.kind !== 'ready') return [];
  const pd = parseState.parsed.request.presentation_definition;
  if (!pd) return [];
  return pd.input_descriptors
    .map((d) => d.name ?? d.purpose ?? d.id)
    .filter((s): s is string => Boolean(s) && s.length > 0);
}
