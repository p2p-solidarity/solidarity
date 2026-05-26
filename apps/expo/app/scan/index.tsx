/**
 * Scan screen — 1:1 port of Swift ScanTabView. Full-screen camera preview
 * with a dimmed-mask ScanWindowOverlay (centred square cut-out + four
 * green corner brackets), nav bar "Scan" inline + trailing `qrcode`
 * (open self-QR), and a footer SolidarityPlaceholderCard "Protocol
 * Router" showing supported flows.
 *
 * Capture feedback: when a payload is decoded we play a short shutter-style
 * animation (corner brackets pulse + a brief white flash overlay) on the
 * Reanimated UI thread, then route after ~280ms so the user sees the
 * "got it" moment instead of an instant cut.
 *
 * Decoded payload is routed by `classifyPayload`:
 *   - `openid4vp://present?…` and similar request URLs → ProofPresentationFlowSheet
 *   - `openid4vp://verify?…` (vp_token in the URL) → VerifierResultSheet
 *   - anything else falls back to the raw "Scanned" diagnostic view used
 *     in Wave 1.
 */
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { SfIcon } from '@/components/icons/SfIcon';
import { ProofPresentationFlowSheet } from '@/components/scan/ProofPresentationFlowSheet';
import { ScanWindowOverlay } from '@/components/scan/ScanWindowOverlay';
import {
  VerifierResultSheet,
  type VerifierResult,
} from '@/components/scan/VerifierResultSheet';
import { SolidarityPlaceholderCard } from '@/components/passport/SolidarityPlaceholderCard';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { presentReceivedCard } from '@/cards/receivedCard';
import { pushToast } from '@/feedback/toast';
import { QrScanner } from '@/scan/QrScanner';
import { handleScannedPayload } from '@/scan/envelopeHandler';

const SCAN_WINDOW_SIZE = 260;

type ScanRoute =
  | { kind: 'proof'; payload: string }
  | { kind: 'verifier'; result: VerifierResult }
  | { kind: 'raw'; payload: string };

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<ScanRoute | null>(null);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [isScanning, setIsScanning] = useState(true);

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

  const finalize = useCallback((payload: string) => {
    setProgress(null);
    setIsScanning(false);
    capturing.current = false;
    // Try the envelope pipeline first — plaintext / zkProof / didSigned
    // payloads route into the ReceivedCardSheet mounted in `_layout.tsx`.
    // Everything else (OIDC URLs, deep links, raw JWTs that aren't cards)
    // falls through to the legacy `classifyPayload` router.
    void (async () => {
      const outcome = await handleScannedPayload(payload);
      if (outcome.kind === 'card' && outcome.card) {
        presentReceivedCard(outcome.card, outcome.verificationStatus);
        router.back();
        return;
      }
      if (outcome.kind === 'error') {
        pushToast(outcome.errorMessage ?? 'Scan failed', 'error');
        setRoute(null);
        setIsScanning(true);
        return;
      }
      setRoute(classifyPayload(payload));
    })();
  }, []);

  const onResult = useCallback(
    (payload: string) => {
      if (capturing.current) return;
      capturing.current = true;
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

  if (route?.kind === 'raw') {
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
          onPress={() => router.back()}
          accessibilityRole="button"
          style={{ width: 60, height: 44, justifyContent: 'center' }}
        >
          <Text className="text-text1 text-[15px]">Close</Text>
        </Pressable>
        <Text className="text-text1 text-[17px] font-semibold">Scan</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="My QR"
          onPress={() => { router.push('/share/qr'); }}
          style={{ width: 60, height: 44, alignItems: 'flex-end', justifyContent: 'center' }}
          className="active:opacity-60"
        >
          <SfIcon name="qrcode" size={20} color={Colors.text1} />
        </Pressable>
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
              {`Receiving ${String(progress.received)} / ${String(progress.total)}…`}
            </Text>
          </View>
        ) : (
          <SolidarityPlaceholderCard
            screenID="SCAN-1"
            title="Protocol Router"
            subtitle="Supports OID4VP request, vp_token verify, credential offers, and SIOPv2."
          />
        )}
        {isScanning ? (
          <View className="flex-row items-center justify-center gap-1.5">
            <ActivityIndicator size="small" />
            <Text className="text-text2 text-[12px]">Scanning...</Text>
          </View>
        ) : null}
      </View>

      <ProofPresentationFlowSheet
        visible={route?.kind === 'proof'}
        requestPayload={route?.kind === 'proof' ? route.payload : ''}
        onClose={reset}
      />

      <VerifierResultSheet
        visible={route?.kind === 'verifier'}
        result={route?.kind === 'verifier' ? route.result : null}
        onClose={reset}
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
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 bg-pageBg p-6 justify-between"
      style={{ paddingTop: insets.top + 16 }}
    >
      <View>
        <Text className="text-text1 text-[24px] font-medium">Scanned</Text>
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
        <ThemedButton label="Scan another" fullWidth onPress={onClear} />
        <ThemedButton variant="secondary" label="Close" fullWidth onPress={() => router.back()} />
      </View>
    </View>
  );
}

function classifyPayload(payload: string): ScanRoute {
  let url: URL;
  try {
    url = new URL(payload);
  } catch {
    return { kind: 'raw', payload };
  }

  const isOidc =
    url.protocol === 'openid4vp:' ||
    url.protocol === 'openid-vp:' ||
    url.protocol === 'openid-credential-offer:';
  if (!isOidc) return { kind: 'raw', payload };

  const vpToken = url.searchParams.get('vp_token');
  const presentationSubmission = url.searchParams.get('presentation_submission');
  if (vpToken && presentationSubmission) {
    return {
      kind: 'verifier',
      result: {
        valid: true,
        title: 'Presentation received',
        reason: `vp_token from ${url.host || url.protocol}`,
        details: [
          `Token length: ${String(vpToken.length)} chars`,
          'Signature verification lands next iteration.',
        ],
      },
    };
  }
  return { kind: 'proof', payload };
}
