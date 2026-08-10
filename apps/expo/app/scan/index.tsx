/**
 * Scan screen — 1:1 port of Swift ScanTabView. Full-screen camera preview
 * with a dimmed-mask ScanWindowOverlay (centred square cut-out + four
 * green corner brackets), nav bar "Scan" inline + trailing `qrcode`
 * (open proof-request QR), and concise human-facing scan guidance.
 *
 * Capture feedback: when a payload is decoded we play a short shutter-style
 * animation (corner brackets pulse + a brief white flash overlay) on the
 * Reanimated UI thread, then route after ~280ms so the user sees the
 * "got it" moment instead of an instant cut.
 *
 * Decoded payload is routed by `classifyPayload`:
 *   - `openid4vp://present?…` and similar request URLs → ProofPresentationFlowSheet
 *   - `openid4vp://verify?…` (vp_token in the URL) → VerifierResultSheet
 *   - unrecognised payloads resume scanning with a concise error; their raw
 *     diagnostic view is available only in Developer Mode.
 */
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { PressableScale } from '@/components/common/PressableScale';
import { SfIcon } from '@/components/icons/SfIcon';
import { PassportShowChallengeSheet } from '@/components/scan/PassportShowChallengeSheet';
import { ProofPresentationFlowSheet } from '@/components/scan/ProofPresentationFlowSheet';
import { ScanWindowOverlay } from '@/components/scan/ScanWindowOverlay';
import {
  VerifierResultSheet,
  type VerifierResult,
} from '@/components/scan/VerifierResultSheet';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { presentReceivedCard } from '@/cards/receivedCard';
import { haptic } from '@/feedback/haptics';
import { SCALE } from '@/feedback/motion';
import { pushToast } from '@/feedback/toast';
import { PASSPORT_SHOW_LINK_SCOPE } from '@/passport/showPresentation';
import { issuePassportShowChallenge } from '@/passport/showVerifier';
import { resolveProfileByHandle } from '@/handles/resolveProfile';
import { resolveProfileByNpub } from '@/nostr/resolveProfile';
import { QrScanner } from '@/scan/QrScanner';
import { credentialOfferRouteFromScan } from '@/scan/credentialOfferRoute';
import { handleScannedPayload } from '@/scan/envelopeHandler';
import { passportShowVerifierResult } from '@/scan/passportShowResult';
import { classifyVerifiedPagePayload, verifyFragment } from '@/scan/verifiedPageHandler';
import { presentVerifiedPageResolving, presentVerifiedPageResult } from '@/scan/verifiedPageResult';
import { presentWebSignEntry } from '@/websign/pendingRequest';
import { classifyWebSignScan } from '@/websign/transport';
import { verifyVpToken } from '@/oidc';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';
import { isDeveloperOnlyScanPayload } from '@/scan/technicalFlowGate';

const SCAN_WINDOW_SIZE = 260;

type ScanRoute =
  | { kind: 'proof'; payload: string }
  | { kind: 'verifier'; result: VerifierResult; developerOnly?: boolean }
  | { kind: 'raw'; payload: string };

export default function ScanScreen() {
  const { t } = useTranslation();
  const developerMode = usePreferences((state) => state.developerMode);
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<ScanRoute | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [isScanning, setIsScanning] = useState(true);
  // Verifier challenge for passport show presentations. The nonce lives in
  // the outstanding-challenge store (TTL-bound); this state only drives the
  // sheet showing the QR.
  const [showChallenge, setShowChallenge] = useState<string | null>(null);

  // Capture animation lives on the UI thread — bracketScale pulses the
  // ScanWindowOverlay corners and flashOpacity blinks a white shutter.
  // Both stay 0 / 1 unless a payload is decoded.
  const bracketScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const capturing = useRef(false);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  const reset = useCallback(() => {
    setRoute(null);
    setIsScanning(true);
    capturing.current = false;
  }, []);

  // `finalize` keeps normal users out of the raw route, but keep this guard
  // at the state boundary too. A future scanner path must not turn an
  // unrecognised URL, token, or arbitrary text into a visible diagnostic.
  useEffect(() => {
    if (!developerMode && route?.kind === 'raw') {
      pushToast(t('scan.couldNotRead'), 'error');
      reset();
    }
  }, [developerMode, reset, route?.kind, t]);

  const finalize = useCallback((payload: string) => {
    setProgress(null);
    setIsScanning(false);
    capturing.current = false;

    // Protocol QR codes launch proof, issuance, or web-sign ceremonies. They
    // are a Developer Options surface, not part of the ordinary Scan flow.
    // Treat them exactly like every other unreadable QR for regular users so
    // no pairwise identifier, signed token, or proof sheet can be mounted.
    if (!developerMode && isDeveloperOnlyScanPayload(payload)) {
      pushToast(t('scan.couldNotRead'), 'error');
      setRoute(null);
      setIsScanning(true);
      return;
    }

    // App↔Web per-action signing request (research §4, G3) — an explicit
    // `solidarity://websign?req=` / `/websign#req=` wrapper only, tried BEFORE
    // the envelope handler so a request JWS is never mis-parsed as a card
    // credential. Routes to the consent review screen (verify + per-field diff
    // + Face ID); the web session signature does NOT prove origin.
    const webSignReq = classifyWebSignScan(payload);
    if (webSignReq !== null) {
      presentWebSignEntry(webSignReq);
      router.push('/websign/review');
      return;
    }

    // OID4VCI offers have their own issuance ceremony. Keep the scanned wire
    // byte-for-byte in `q`: the offer screen accepts the full URI and parses
    // its `credential_offer` payload there.
    const credentialOfferRoute = credentialOfferRouteFromScan(payload);
    if (credentialOfferRoute !== null) {
      router.push(credentialOfferRoute);
      return;
    }

    // Verified Page fragment QR (1.3.3 Task A2.3, US-11) — tried first as a
    // cheap, self-contained format sniff. Returns `null` for anything that
    // isn't a verified-page payload at all (old exchange-QR wire formats,
    // OIDC URLs, ...), so every existing format below is completely
    // unaffected. A non-null result (verified OR a structured invalid
    // reason) routes into VerifiedPageResultSheet, mounted in `_layout.tsx`.
    const verifiedPageForm = classifyVerifiedPagePayload(payload);
    if (verifiedPageForm !== null) {
      if (verifiedPageForm.kind === 'fragment') {
        // Self-contained offline blob — verified locally in this tick.
        presentVerifiedPageResult(verifyFragment(verifiedPageForm.fragment));
      } else if (verifiedPageForm.kind === 'pointer') {
        // `#nostr:<npub>` short pointer — open the loading state, then swap
        // in the resolved verdict once relays answer. resolveProfileByNpub
        // never throws (structured invalid on any failure).
        presentVerifiedPageResolving();
        void resolveProfileByNpub(verifiedPageForm.npub).then(presentVerifiedPageResult);
      } else {
        presentVerifiedPageResolving();
        void resolveProfileByHandle(verifiedPageForm.handle).then(presentVerifiedPageResult);
      }
      safeBack();
      return;
    }

    // Try the envelope pipeline next — plaintext / zkProof / didSigned
    // payloads route into the ReceivedCardSheet mounted in `_layout.tsx`.
    // Everything else (OIDC URLs, deep links, raw JWTs that aren't cards)
    // falls through to the legacy `classifyPayload` router.
    void (async () => {
      const outcome = await handleScannedPayload(payload);
      if (outcome.kind === 'card' && outcome.card) {
        if (outcome.verificationStatus === undefined) {
          pushToast(t('scan.couldNotRead'), 'error');
          setIsScanning(true);
          return;
        }
        presentReceivedCard({
          card: outcome.card,
          verificationStatus: outcome.verificationStatus,
          source: 'QR Code',
          sealedRoute: outcome.sealedRoute,
        });
        safeBack();
        return;
      }
      if (outcome.kind === 'error') {
        pushToast(t('scan.couldNotRead'), 'error');
        setRoute(null);
        setIsScanning(true);
        return;
      }
      if (outcome.kind === 'passport-show' && outcome.passportShow) {
        setRoute({
          kind: 'verifier',
          result: passportShowVerifierResult(outcome.passportShow, t),
        });
        return;
      }
      const classifiedRoute = await classifyPayload(payload, t);
      if (!developerMode && classifiedRoute.kind === 'raw') {
        pushToast(t('scan.couldNotRead'), 'error');
        setRoute(null);
        setIsScanning(true);
        return;
      }
      setRoute(classifiedRoute);
    })();
  }, [developerMode, t]);

  const onResult = useCallback(
    (payload: string) => {
      if (capturing.current) return;
      capturing.current = true;
      // Tactile "got it" the instant a code resolves — fires with the bracket
      // pulse + shutter flash so the capture lands on three senses at once.
      haptic('success');
      bracketScale.value = withSequence(
        withTiming(1.18, { duration: 140 }),
        withTiming(1, { duration: 120 }),
      );
      flashOpacity.value = withSequence(
        withTiming(1, { duration: 80 }),
        withTiming(0, { duration: 180 }, (finished) => {
          'worklet';
          if (finished) scheduleOnRN(finalize, payload);
        }),
      );
    },
    [bracketScale, flashOpacity, finalize],
  );

  const onProgress = useCallback((received: number, total: number) => {
    setProgress({ received, total });
  }, []);

  if (developerMode && route?.kind === 'raw') {
    return <ScannedResultView result={route.payload} onClear={reset} />;
  }

  return (
    <View className="flex-1 bg-pageBg">
      <View style={{ position: 'absolute', inset: 0 }}>
        <QrScanner onResult={onResult} onProgress={onProgress} />
      </View>

      <ScanWindowOverlay size={SCAN_WINDOW_SIZE} bracketScale={bracketScale} />

      <View
        className="flex-row items-center justify-between px-4"
        style={{ height: 44, paddingTop: insets.top }}
      >
        <Pressable
          onPress={() => { safeBack(); }}
          accessibilityRole="button"
          style={{ width: 60, height: 44, justifyContent: 'center' }}
        >
          <Text className="text-text1 text-[15px]">{t('scan.close')}</Text>
        </Pressable>
        <Text className="text-text1 text-[17px] font-semibold">{t('scan.title')}</Text>
        {developerMode ? (
          <PressableScale
            haptic="tap"
            scaleTo={SCALE.icon}
            accessibilityRole="button"
            accessibilityLabel={t('scan.proofRequestQr')}
            onPress={() => { router.push('/share/qr'); }}
            style={{ width: 60, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}
          >
            <SfIcon name="qrcode" size={20} color={Colors.text1} />
          </PressableScale>
        ) : (
          <View style={{ width: 60, height: 44 }} />
        )}
      </View>

      <View style={{ flex: 1 }} />

      <View
        style={{ paddingBottom: insets.bottom + 16, paddingHorizontal: 16, gap: 8 }}
      >
        {progress ? (
          <View
            className="rounded-xl bg-mutedSurface px-4 py-3 items-center"
          >
            <Text className="text-text2 text-[13px]">
              {t('scan.receiving', {
                received: progress.received,
                total: progress.total,
              })}
            </Text>
          </View>
        ) : (
          <ThemedSurface variant="elevated" padded className="items-center gap-2">
            <SfIcon name="qrcode.viewfinder" size={24} color={Colors.terminalGreen} />
            <ThemedText variant="label">{t('scan.readyTitle')}</ThemedText>
            <ThemedText variant="bodySmall" tone="secondary" style={{ textAlign: 'center' }}>
              {t('scan.readyHint')}
            </ThemedText>
          </ThemedSurface>
        )}
        <ThemedButton
          variant="secondary"
          label={t('passportShow.verifyEntry')}
          fullWidth
          onPress={() => {
            const issued = issuePassportShowChallenge({
              scope: PASSPORT_SHOW_LINK_SCOPE,
              ageThreshold: 18,
              requestAge: true,
              requestNationality: false,
            });
            setShowChallenge(issued.challengeJson);
          }}
        />
        {isScanning ? (
          <View className="flex-row items-center justify-center gap-1.5">
            <ActivityIndicator size="small" />
            <Text className="text-text2 text-[12px]">{t('scan.scanning')}</Text>
          </View>
        ) : null}
      </View>

      {developerMode ? (
        <ProofPresentationFlowSheet
          visible={route?.kind === 'proof'}
          requestPayload={route?.kind === 'proof' ? route.payload : ''}
          onClose={reset}
        />
      ) : null}

      <VerifierResultSheet
        visible={
          route?.kind === 'verifier' && (developerMode || !route.developerOnly)
        }
        result={route?.kind === 'verifier' ? route.result : null}
        onClose={reset}
      />

      <PassportShowChallengeSheet
        visible={showChallenge !== null}
        challengeJson={showChallenge}
        onClose={() => { setShowChallenge(null); }}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: Colors.scanFlash },
          flashStyle,
        ]}
      />
    </View>
  );
}

function ScannedResultView({
  result,
  onClear,
}: {
  result: string;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-pageBg p-6 justify-between"
      style={{ paddingTop: insets.top + 16 }}
    >
      <View>
        <Text className="text-text1 text-[24px] font-medium">{t('scan.resultTitle')}</Text>
        <View className="mt-4 rounded-xl bg-mutedSurface p-4">
          <Text
            selectable
            numberOfLines={6}
            className="text-text2 text-[13px]"
            style={{ fontFamily: 'Menlo' }}
          >
            {result}
          </Text>
        </View>
      </View>
      <View className="gap-2" style={{ paddingBottom: insets.bottom }}>
        <ThemedButton label={t('scan.scanAnother')} fullWidth onPress={onClear} />
        <ThemedButton variant="secondary" label={t('scan.close')} fullWidth onPress={() => { safeBack(); }} />
      </View>
    </View>
  );
}

async function classifyPayload(payload: string, t: TFunction): Promise<ScanRoute> {
  let url: URL;
  try {
    url = new URL(payload);
  } catch {
    return { kind: 'raw', payload };
  }

  const isOidc = url.protocol === 'openid4vp:' || url.protocol === 'openid-vp:';
  if (!isOidc) return { kind: 'raw', payload };

  const vpToken = url.searchParams.get('vp_token');
  const presentationSubmission = url.searchParams.get('presentation_submission');
  if (vpToken && presentationSubmission) {
    // REAL verification — never rubber-stamp a scanned presentation as valid.
    // verifyVpToken throws unless the holder VP signature, expiry, AND every
    // embedded credential verify (fail closed), matching Swift
    // ProofVerifierService.verifyVpToken.
    try {
      const vp = await verifyVpToken(vpToken);
      return {
        kind: 'verifier',
        result: {
          valid: true,
          title: t('scan.proof.verifiedTitle'),
          reason: t('scan.proof.verifiedSummary', {
            count: vp.credentials.length,
            source: url.host || url.protocol,
          }),
          details: [
            t('scan.proof.presentedBy', { value: vp.holderDid }),
            ...vp.credentials.map(
              (c, i) => t('scan.proof.issuedBy', {
                index: i + 1,
                value: c.issuerDid,
              })
            ),
          ],
        },
        developerOnly: true,
      };
    } catch {
      return {
        kind: 'verifier',
        result: {
          valid: false,
          title: t('scan.proof.failedTitle'),
          reason: t('scan.proof.failedReason'),
          details: [t('scan.proof.failedBody')],
        },
        developerOnly: true,
      };
    }
  }
  return { kind: 'proof', payload };
}
