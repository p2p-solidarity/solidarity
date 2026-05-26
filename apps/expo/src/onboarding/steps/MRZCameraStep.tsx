/**
 * MRZCameraStep — 1:1 visual port of Swift MRZCameraView.swift.
 *
 * Layout (top → bottom):
 *   1. Live camera feed (fullscreen, black backdrop) — same on iOS + Android.
 *   2. PassportSketch overlay (open-passport SVG with photo + field lines +
 *      a 320×60 MRZ alignment band at the bottom). The MRZ band stroke
 *      flips from white to terminalGreen once a draft is captured.
 *   3. Footer:
 *      - Before scan: "Looking for MRZ..." (progress) or error label.
 *      - After scan : "MRZ Detected" confirmation card with passport
 *                     number, nationality, DOB, expiry; Rescan + Use This.
 *   4. NavBar with Cancel button (left).
 *
 * MRZ recognition runs through the `@solidarity/nitro-mrz-ocr` plugin
 * (Vision on iOS, ML Kit Text Recognition on Android). Native now
 * returns a TD3 draft only after ICAO 9303 check-digit validation; JS only
 * drives transient scan phase UI and advances once a draft appears.
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

import { getMrzOcr, type MrzOcr, type MrzScanResult } from '@solidarity/nitro-mrz-ocr';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  PassportSketch,
  type PassportSketchState,
} from '@/components/scan/PassportSketch';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { evaluateNativeMrzScan } from '@/passport/mrzOcr';
import { useCameraPermission } from '@/scan/useCameraPermission';

export interface PassportMRZDraft {
  readonly passportNumber: string;
  readonly nationalityCode: string;
  /** YYMMDD per ICAO 9303. */
  readonly dateOfBirth: string;
  /** YYMMDD per ICAO 9303. */
  readonly expiryDate: string;
}

export interface MRZCameraStepProps {
  readonly onScanned: (draft: PassportMRZDraft) => void;
  readonly onCancel: () => void;
  readonly onSwitchToManual: () => void;
}

/**
 * Run OCR on every frame VisionCamera dispatches (no JS-side throttle).
 *
 * The original SwiftUI `MRZScannerService` runs OCR back-to-back via an
 * `_isProcessingFrame` lock + `alwaysDiscardsLateVideoFrames = true` — as
 * soon as one Vision call returns, the next available frame is OCR'd.
 * No artificial gating.
 *
 * In VisionCamera v5 the frame-processor worklet is synchronous, so OCR
 * already blocks the worklet thread for its full duration (~100-150ms on
 * 720p `.accurate`) and the camera drops frames at the native layer for
 * us. Adding a JS-side `tick % N` gate on top of that was costing one
 * extra ~33ms frame cycle per OCR round for no gain — the throttle never
 * activated when OCR was the bottleneck (always true on iOS Vision), and
 * on Android ML Kit (fast — ~80ms) it just halved attempts/sec.
 *
 * Keeping the constant + tick counter as a future knob (e.g. for thermal
 * back-off) — `1` means "run every frame, match Swift's cadence".
 */
const FRAME_THROTTLE = 1;

/**
 * HD_4_3 keeps enough vertical detail for OCR-B glyphs while preserving
 * a sensor-native 4:3 path. The native OCR currently reads the full frame
 * for reliability; ROI/crop can come back only after first-hit rate is
 * stable on real passports.
 */
const FRAME_OUTPUT_RESOLUTION = CommonResolutions.HD_4_3;

/** Hold the current non-idle phase for this long after the last positive
 *  ingest so a one-frame OCR miss doesn't flicker the affordance back to
 *  white. Keep this short: phase is decorative, not part of validation. */
const PHASE_HOLD_MS = 250;

/** Consecutive native-parse-missed-with-MRZ-shape readings before we flip the
 *  sketch from green to amber and surface a recovery hint. With OCR
 *  running continuously. */
const STRUGGLE_THRESHOLD = 6;

/**
 * Briefly lets the confirmed state render before advancing. Validation has
 * already happened in native; this is only visual continuity.
 */
const AUTO_ADVANCE_DELAY_MS = 120;

type ScanPhase = 'idle' | 'detecting' | 'struggling' | 'confirmed';

interface PhaseCopy {
  readonly primary: string;
  readonly secondary?: string;
}

const PHASE_COPY: Record<ScanPhase, PhaseCopy> = {
  idle: {
    primary: 'Align passport MRZ here',
    secondary: 'Photo page facing the camera',
  },
  detecting: {
    primary: 'Reading MRZ — hold steady',
  },
  struggling: {
    primary: 'MRZ unclear',
    secondary: 'Move closer, improve lighting, or hold steadier',
  },
  confirmed: {
    primary: 'MRZ verified',
  },
};

const PHASE_TO_SKETCH_STATE: Record<ScanPhase, PassportSketchState> = {
  idle: 'idle',
  detecting: 'detecting',
  struggling: 'warning',
  confirmed: 'confirmed',
};

export function MRZCameraStep({
  onScanned,
  onCancel,
  onSwitchToManual,
}: MRZCameraStepProps): ReactNode {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const [draft, setDraft] = useState<PassportMRZDraft | null>(null);

  // Live scan phase, driven from `ingestResult`. Decouples user-facing
  // affordances from the actual draft acceptance — users need to know the
  // moment OCR sees their MRZ, AND when it's struggling to parse it, so
  // they can react (move closer, improve lighting) instead of staring at
  // a static green frame.
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const phaseRef = useRef<ScanPhase>('idle');
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Consecutive parse-failed reads while ≥2 MRZ rows visible. */
  const failureStreakRef = useRef(0);
  /**
   * One-shot timer for auto-advance after MRZ acceptance. Held in a ref
   * so the unmount cleanup can clear it (avoiding a navigate-back race
   * where the user taps Cancel between phase-confirmed and the timer
   * firing) and so `handleRescan` can defuse a pending advance.
   */
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAcceptedRef = useRef(false);

  // Frame counter lives on the worklet thread (SharedValue) so it never
  // trips a React re-render.
  const frameTick = useSharedValue<number>(0);
  const scanAccepted = useSharedValue<boolean>(false);

  // Diagnostics — wall-clock timestamp of mount, OCR call counter, and a
  // rolling average of the last few OCR durations. All JS-side so the
  // worklet stays cheap. `mountTimeRef.current` doubles as the "time
  // since session start" anchor for the accept log line.
  const mountTimeRef = useRef<number>(Date.now());
  const ocrCallCountRef = useRef<number>(0);
  const ocrDurationsRef = useRef<number[]>([]);

  // Resolve the Nitro HybridObject once on the JS thread. Worklets can't
  // call non-worklet JS functions like `getMrzOcr()` synchronously, but
  // once we have the HybridObject in hand it IS worklet-safe (the methods
  // are Nitro proxies backed by native code — same pattern as
  // VisionCamera frame outputs).
  const mrzOcr = useMemo<MrzOcr>(() => getMrzOcr(), []);

  /**
   * Move to a new phase. Idle is the resting state and only kicks in via
   * the debounce timer; everything else applies immediately and refreshes
   * the timer so a one-frame OCR drop doesn't downgrade the affordance.
   */
  const moveToPhase = useCallback((next: ScanPhase) => {
    if (next === 'idle') {
      if (phaseRef.current === 'idle') return;
      console.log(`[MRZ] phase: ${phaseRef.current} → idle`);
      phaseRef.current = 'idle';
      setPhase('idle');
      return;
    }
    if (phaseRef.current !== next) {
      console.log(`[MRZ] phase: ${phaseRef.current} → ${next}`);
      phaseRef.current = next;
      setPhase(next);
    }
    if (phaseTimerRef.current !== null) clearTimeout(phaseTimerRef.current);
    if (next === 'confirmed') return; // confirmed stays until rescan
    phaseTimerRef.current = setTimeout(() => {
      console.log(`[MRZ] phase: ${phaseRef.current} → idle (timeout)`);
      phaseRef.current = 'idle';
      setPhase('idle');
      phaseTimerRef.current = null;
    }, PHASE_HOLD_MS);
  }, []);

  // JS-thread sink for native OCR results. Native already performs TD3
  // check-digit validation before returning `draft`, so this function only
  // updates phase/counters and accepts the draft immediately.
  const ingestResult = useCallback(
    (result: MrzScanResult, ocrDurationMs: number) => {
      ocrCallCountRef.current += 1;
      // Keep a rolling window of the last 10 OCR durations for the
      // "ACCEPT after" summary.
      const durations = ocrDurationsRef.current;
      durations.push(ocrDurationMs);
      if (durations.length > 10) durations.shift();

      if (
        typeof __DEV__ !== 'undefined'
        && __DEV__
        && (ocrCallCountRef.current <= 5 || ocrCallCountRef.current % 30 === 0)
      ) {
        console.log(
          `[MRZ] OCR #${String(ocrCallCountRef.current)}: candidates=${String(result.candidateCount)} draft=${result.draft == null ? 'no' : 'yes'} duration=${String(Math.round(ocrDurationMs))}ms frame=${String(result.frameWidth)}x${String(result.frameHeight)} conf=${result.confidence.toFixed(2)}`,
        );
      }

      const evaluation = evaluateNativeMrzScan(result, {
        failureStreak: failureStreakRef.current,
        struggleThreshold: STRUGGLE_THRESHOLD,
      });

      void result.frameWidth;
      void result.frameHeight;
      void ocrDurationMs;

      if (evaluation.acceptedDraft !== null) {
        if (hasAcceptedRef.current) return;
        hasAcceptedRef.current = true;
        const accepted = evaluation.acceptedDraft;
        const totalMs = Date.now() - mountTimeRef.current;
        const avgMs =
          durations.reduce((s, v) => s + v, 0) / Math.max(1, durations.length);
        console.log(
          `[MRZ] ACCEPT after ${String(totalMs)}ms / ${String(ocrCallCountRef.current)} ocr calls (avg ${String(Math.round(avgMs))}ms/call)`,
        );
        failureStreakRef.current = 0;
        moveToPhase('confirmed');
        setDraft(accepted);
        // Tiny delay lets the `confirmed` phase render once before the
        // modal closes and the pipeline moves to NFC.
        autoAdvanceTimerRef.current = setTimeout(() => {
          onScanned(accepted);
        }, AUTO_ADVANCE_DELAY_MS);
        return;
      }

      failureStreakRef.current = evaluation.nextFailureStreak;
      if (evaluation.phase !== null) {
        moveToPhase(evaluation.phase);
        return;
      }

      // No candidates this frame — leave the phase alone and let the
      // debounce timer drop us back to idle if the dry spell persists.
    },
    [moveToPhase, onScanned],
  );

  const logOcrError = useCallback((message: string) => {
    console.warn(`[MRZ] scanFrame threw: ${message}`);
  }, []);

  const onFrame = useMemo(() => {
    return (frame: Frame): void => {
      'worklet';
      if (scanAccepted.value) {
        frame.dispose();
        return;
      }

      const tick = frameTick.value + 1;
      frameTick.value = tick;
      if (tick % FRAME_THROTTLE !== 0) {
        frame.dispose();
        return;
      }

      try {
        const startedAt = Date.now();
        const result: MrzScanResult = mrzOcr.scanFrame(frame);
        const durationMs = Date.now() - startedAt;

        const draft = result.draft == null
          ? undefined
          : {
              passportNumber: result.draft.passportNumber,
              nationalityCode: result.draft.nationalityCode,
              dateOfBirth: result.draft.dateOfBirth,
              expiryDate: result.draft.expiryDate,
            };
        if (draft != null) scanAccepted.value = true;
        const plainResult: MrzScanResult = {
          draft,
          candidateCount: result.candidateCount,
          confidence: result.confidence,
          frameWidth: result.frameWidth,
          frameHeight: result.frameHeight,
        };
        scheduleOnRN(ingestResult, plainResult, durationMs);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        scheduleOnRN(logOcrError, message);
      } finally {
        frame.dispose();
      }
    };
  }, [frameTick, ingestResult, logOcrError, mrzOcr, scanAccepted]);

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    targetResolution: FRAME_OUTPUT_RESOLUTION,
    onFrame,
  });

  // Bias the negotiated session toward a steady 30 FPS and the frame
  // output's target resolution. VisionCamera v5 expresses FPS through
  // constraints, not a Camera `fps` prop.
  const cameraConstraints = useMemo(
    () => [{ fps: 30 }, { resolutionBias: frameOutput }],
    [frameOutput],
  );

  const handleRescan = useCallback(() => {
    console.log('[MRZ] rescan — resetting counters and timers');
    frameTick.value = 0;
    scanAccepted.value = false;
    if (phaseTimerRef.current !== null) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    failureStreakRef.current = 0;
    hasAcceptedRef.current = false;
    phaseRef.current = 'idle';
    setPhase('idle');
    setDraft(null);
    // Reset diagnostics so the next ACCEPT log measures from rescan.
    mountTimeRef.current = Date.now();
    ocrCallCountRef.current = 0;
    ocrDurationsRef.current = [];
  }, [frameTick, scanAccepted]);

  const handleUseThis = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (draft) onScanned(draft);
  }, [draft, onScanned]);

  useEffect(() => {
    console.log(
      `[MRZ] mount — target=${String(FRAME_OUTPUT_RESOLUTION.width)}x${String(FRAME_OUTPUT_RESOLUTION.height)} fps=30 throttle=${String(FRAME_THROTTLE)} struggle=${String(STRUGGLE_THRESHOLD)} hold=${String(PHASE_HOLD_MS)}ms advance=${String(AUTO_ADVANCE_DELAY_MS)}ms nativeDraft=true`,
    );
    mountTimeRef.current = Date.now();
    return () => {
      console.log(
        `[MRZ] unmount after ${String(Date.now() - mountTimeRef.current)}ms / ${String(ocrCallCountRef.current)} ocr calls`,
      );
      if (phaseTimerRef.current !== null) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
      if (autoAdvanceTimerRef.current !== null) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, []);

  if (permission !== 'granted') {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.permissionText}>
          {permission === 'pending' ? 'Requesting camera…' : 'Camera permission required.'}
        </Text>
        <View style={{ marginTop: 16 }}>
          <ThemedButton label="Enter Manually" variant="inverted" onPress={onSwitchToManual} />
        </View>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.permissionText}>No camera available.</Text>
        <View style={{ marginTop: 16 }}>
          <ThemedButton label="Enter Manually" variant="inverted" onPress={onSwitchToManual} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={draft === null}
        outputs={[frameOutput]}
        constraints={cameraConstraints}
      />

      <NavBar onCancel={onCancel} onSwitchToManual={onSwitchToManual} />

      <View style={styles.overlayContainer}>
        <PassportSketch state={PHASE_TO_SKETCH_STATE[phase]} />
        {draft === null ? <ScanStatus phase={phase} /> : null}
      </View>

      <View style={styles.footer}>
        {draft ? (
          <ConfirmationCard draft={draft} onRescan={handleRescan} onUseThis={handleUseThis} />
        ) : (
          <InstructionFooter onSwitchToManual={onSwitchToManual} />
        )}
      </View>
    </View>
  );
}

function ScanStatus({ phase }: { phase: ScanPhase }) {
  const copy = PHASE_COPY[phase];
  const tone: 'warning' | 'normal' = phase === 'struggling' ? 'warning' : 'normal';
  return (
    <View style={styles.statusGroup} pointerEvents="none">
      <Text
        style={[
          styles.statusPrimary,
          tone === 'warning' ? styles.statusPrimaryWarning : null,
        ]}
      >
        {copy.primary}
      </Text>
      {copy.secondary ? (
        <Text
          style={[
            styles.statusSecondary,
            tone === 'warning' ? styles.statusSecondaryWarning : null,
          ]}
        >
          {copy.secondary}
        </Text>
      ) : null}
    </View>
  );
}

function NavBar({
  onCancel,
  onSwitchToManual,
}: {
  onCancel: () => void;
  onSwitchToManual: () => void;
}) {
  return (
    <View style={styles.navBar}>
      <Pressable onPress={onCancel} accessibilityRole="button" style={styles.navBarButton}>
        <Text style={styles.navBarText}>Cancel</Text>
      </Pressable>
      <Text style={styles.navBarTitle}>Scan Passport</Text>
      <Pressable
        onPress={onSwitchToManual}
        accessibilityRole="button"
        accessibilityLabel="Enter passport MRZ manually"
        style={[styles.navBarButton, { alignItems: 'flex-end' }]}
      >
        <Text style={styles.navBarText}>Manual</Text>
      </Pressable>
    </View>
  );
}

function InstructionFooter({ onSwitchToManual }: { onSwitchToManual: () => void }) {
  return (
    <View style={{ gap: 12, alignItems: 'center' }}>
      <Text style={styles.instructionLabel}>
        Or type the MRZ from the passport's photo page.
      </Text>
      <ThemedButton
        label="Enter Manually"
        variant="inverted"
        onPress={onSwitchToManual}
      />
    </View>
  );
}

function ConfirmationCard({
  draft,
  onRescan,
  onUseThis,
}: {
  draft: PassportMRZDraft;
  onRescan: () => void;
  onUseThis: () => void;
}) {
  return (
    <View style={styles.confirmationCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SfIcon name="checkmark.seal.fill" size={18} color={Colors.terminalGreen} />
        <Text style={styles.confirmationTitle}>MRZ Detected</Text>
      </View>

      <View style={{ gap: 6 }}>
        <InfoRow label="Passport" value={draft.passportNumber} />
        <InfoRow label="Nationality" value={draft.nationalityCode} />
        <InfoRow label="Date of Birth" value={formatYyMmDd(draft.dateOfBirth)} />
        <InfoRow label="Expiry" value={formatYyMmDd(draft.expiryDate)} />
      </View>

      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 4 }}>
        <View style={{ flex: 1 }}>
          <ThemedButton label="Rescan" variant="secondary" fullWidth onPress={onRescan} />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedButton label="Use This" variant="primary" fullWidth onPress={onUseThis} />
        </View>
      </View>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatYyMmDd(s: string): string {
  if (s.length !== 6) return s;
  const yy = s.slice(0, 2);
  const mm = s.slice(2, 4);
  const dd = s.slice(4, 6);
  const yyNum = Number(yy);
  const fullYear = yyNum >= 30 ? 1900 + yyNum : 2000 + yyNum;
  return `${dd}/${mm}/${String(fullYear)}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 48,
    paddingBottom: 12,
  },
  navBarButton: { width: 80, height: 44, justifyContent: 'center' },
  navBarText: { color: '#FFFFFF', fontSize: 15 },
  navBarTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  overlayContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  statusGroup: { alignItems: 'center', gap: 4, paddingHorizontal: 24 },
  statusPrimary: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  statusPrimaryWarning: { color: Colors.warning },
  statusSecondary: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    textAlign: 'center',
  },
  statusSecondaryWarning: { color: Colors.warning },
  footer: { padding: 16, paddingBottom: 40 },
  instructionLabel: { color: '#FFFFFF', fontSize: 12, textAlign: 'center' },
  confirmationCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  confirmationTitle: { color: Colors.text1, fontSize: 17, fontWeight: '600' },
  infoLabel: { color: Colors.text3, fontSize: 12, fontWeight: '600', width: 100 },
  infoValue: { color: Colors.text1, fontSize: 12, fontFamily: 'Menlo' },
  permissionScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    paddingHorizontal: 24,
  },
  permissionText: { color: '#FFFFFF', fontSize: 15, textAlign: 'center' },
});
