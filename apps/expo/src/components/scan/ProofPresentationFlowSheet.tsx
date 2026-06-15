/**
 * ProofPresentationFlowSheet — 1:1 port of
 * solidarity/Views/ScanViews/ProofPresentationFlowSheet.swift.
 *
 * Multi-step modal driven by the OID4VP request scanned from a verifier
 * QR. Steps: parse → review (verifier + requested claims) → sign → done.
 *
 * Wired to the real signing pipeline: the submit step runs the
 * `presentProof` biometric gate, then builds + signs the VP token via
 * `buildVpToken` (Secure-Enclave-backed ES256 signature) and submits the
 * token to the verifier's `response_uri` / `redirect_uri` via
 * `submitAuthorizationResponse` — matching Swift's BiometricGatekeeper →
 * VCService → OID4VPPresentationService.wrapCredentialsAsVP →
 * submitVpToken chain.
 */
import { type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import { useActiveDid, useIdentityData } from '@/identity';
import { requireSensitiveAction } from '@/keychain';
import { parseOidcRequest, type ParsedOidcRequest } from '@/oidc';
import { buildVpToken } from '@/oidc/presenter';
import { submitAuthorizationResponse } from '@/oidc/submitResponse';

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
  const activeDid = useActiveDid();

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
    void runPresentation(parseState.parsed, activeDid, {
      setStep,
      setSubmittedToken,
    });
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

interface PresentationCallbacks {
  readonly setStep: (step: Step) => void;
  readonly setSubmittedToken: (token: string) => void;
}

/**
 * Drive the OID4VP presentation: biometric gate → buildVpToken (signs the
 * VP envelope with the Secure-Enclave-backed ES256 key) → optional POST to
 * the verifier `response_uri` / `redirect_uri`. Mirrors Swift's
 * `BiometricGatekeeper.authorizeIfRequired(.presentProof)` → VCService →
 * OID4VPPresentationService.wrapCredentialsAsVP → submitVpToken chain.
 *
 * Failure modes (each surfaces a toast and returns the UI to `review` so
 * the user can retry without re-scanning):
 *   - biometric cancelled / locked-out / unavailable / policy-disabled
 *   - no provable claims available for presentation
 *   - signing throws (key gone, hardware fault)
 *   - verifier POST non-2xx / network error
 */
async function runPresentation(
  parsed: ParsedOidcRequest,
  activeDid: string | null,
  cb: PresentationCallbacks
): Promise<void> {
  cb.setStep('signing');

  const gate = await requireSensitiveAction(
    'presentProof',
    'Authorize signing your proof presentation'
  );
  if (!gate.success) {
    pushToast(biometricErrorMessage(gate.reason), 'error');
    cb.setStep('review');
    return;
  }

  // Collect the provable-claim ids the verifier asked for. When the
  // request omits a presentation_definition (or has zero input
  // descriptors), Swift falls back to "best effort: include everything
  // the holder can present" — match that so a bare openid4vp:// request
  // still completes against a default verifier.
  const selectedClaimIds = resolveSelectedClaimIds(parsed);
  if (selectedClaimIds.length === 0) {
    pushToast('No credentials available to present.', 'error');
    cb.setStep('review');
    return;
  }

  // Holder DID for the VP binding. `buildVpToken` re-derives the canonical
  // `did:key` from the active signing key anyway, but pass the cached value
  // so the request audit log matches IdentityCoordinator's view of "who I
  // am right now". Falls back to an empty string — presenter ignores the
  // input and uses its derived value.
  const holderDid = activeDid ?? '';

  const vpResult = await buildVpToken({
    request: parsed,
    selectedClaimIds,
    holderDid,
  });
  if (!vpResult.ok) {
    pushToast(vpResult.error.message, 'error');
    cb.setStep('review');
    return;
  }

  const { vpJwt, presentationSubmission } = vpResult.value;
  const req = parsed.request;
  const hasSubmissionTarget =
    Boolean(req.response_uri) || Boolean(req.redirect_uri);

  // No verifier callback URL — Swift treats this as "verifier scanned the
  // QR back from us out-of-band" and stays on the success screen with the
  // signed JWT shown for the user to relay manually. Match that behaviour.
  if (!hasSubmissionTarget) {
    cb.setSubmittedToken(vpJwt);
    cb.setStep('submitted');
    pushToast('Proof signed', 'success');
    return;
  }

  const submitResult = await submitAuthorizationResponse({
    request: parsed,
    vpJwt,
    presentationSubmission,
  });
  if (!submitResult.ok) {
    pushToast(submitResult.error.message, 'error');
    cb.setStep('review');
    return;
  }

  cb.setSubmittedToken(vpJwt);
  cb.setStep('submitted');
  pushToast('Proof submitted', 'success');

  // Follow any post-submission redirect (verifier "thanks" page or
  // back-to-app deep link). Failure to open the URL is non-fatal — the
  // signed token already landed.
  const redirectTo = submitResult.value.redirectTo;
  if (redirectTo) {
    try {
      await Linking.openURL(redirectTo);
    } catch {
      // Swallow — caller already saw the success state.
    }
  }
}

function biometricErrorMessage(
  reason: 'cancelled' | 'lockedOut' | 'unavailable' | 'policyDisabled'
): string {
  if (reason === 'lockedOut') return 'Biometric is locked. Try again later.';
  if (reason === 'unavailable') {
    return 'Biometric is unavailable. Enable Face ID / fingerprint to present proofs.';
  }
  if (reason === 'policyDisabled') return 'Presentation gate is disabled.';
  return 'Biometric authorization cancelled.';
}

/**
 * Map `presentation_definition.input_descriptors` to provable-claim ids
 * from the local identity store. Matches by descriptor `id` first
 * (canonical OID4VP path), then falls back to matching the descriptor
 * `name` against the claim's `claimType` (Swift exposes claim types as
 * the user-facing name on the verifier side too). When no descriptors are
 * present, returns every presentable claim id so the verifier still gets
 * the holder's full attested set.
 */
function resolveSelectedClaimIds(parsed: ParsedOidcRequest): readonly string[] {
  const provableClaims = useIdentityData.getState().provableClaims;
  const presentable = provableClaims.filter((c) => c.isPresentable);
  if (presentable.length === 0) return [];

  // Collect every identifier the verifier asked for — from a
  // presentation_definition AND/OR a DCQL query. We deliberately gather both
  // so an OID4VP 1.0 DCQL-only request scopes disclosure correctly instead of
  // being treated as "unspecified".
  const requested = new Set<string>();
  for (const d of parsed.request.presentation_definition?.input_descriptors ?? []) {
    requested.add(d.id);
    if (d.name) requested.add(d.name);
  }
  for (const cq of parsed.request.dcql_query?.credentials ?? []) {
    requested.add(cq.id);
    for (const claim of cq.claims ?? []) {
      if (claim.id) requested.add(claim.id);
      // The last path segment is the claim name (e.g. ["...","age_over_18"]).
      const tail = claim.path?.filter((p): p is string => typeof p === 'string').at(-1);
      if (tail) requested.add(tail);
    }
  }

  // FAIL CLOSED — never present everything. If the verifier specified no
  // disclosure target at all (no PD, no DCQL — e.g. an unrecognised or
  // request_uri-only request we can't resolve), disclose NOTHING rather than
  // dumping every claim we hold (the previous behaviour was a real
  // over-disclosure leak). Our own requests always carry a presentation
  // definition, so this only affects external/unspecified requests.
  if (requested.size === 0) return [];

  const matched = new Set<string>();
  for (const c of presentable) {
    if (requested.has(c.id) || requested.has(c.claimType)) {
      matched.add(c.id);
    }
  }
  // The verifier asked for specific claims we don't hold → present nothing
  // (fail closed). Presenting unrelated claims to satisfy a mismatch would
  // over-disclose; the verifier rejects on its end if a mandatory claim is
  // missing, which is the correct, privacy-preserving outcome.
  return Array.from(matched);
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
  const req = parseState.parsed.request;
  const names: string[] = [];
  for (const d of req.presentation_definition?.input_descriptors ?? []) {
    const label = d.name ?? d.purpose ?? d.id;
    if (label.length > 0) names.push(label);
  }
  // Surface DCQL-requested claims too, so the consent UI shows exactly what an
  // OID4VP 1.0 verifier asked for (not a blank "no claims" list).
  for (const cq of req.dcql_query?.credentials ?? []) {
    for (const claim of cq.claims ?? []) {
      const tail = claim.path?.filter((p): p is string => typeof p === 'string').at(-1);
      const label = claim.id ?? tail ?? cq.id;
      if (label.length > 0) names.push(label);
    }
    if ((cq.claims ?? []).length === 0) names.push(cq.id);
  }
  return names;
}
