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
 * (VisionKit on iOS, ML Kit Text Recognition on Android). The
 * frame-processor worklet calls `getMrzOcr().scanFrame(frame)` every
 * 4th frame and ships the recognised lines back to the JS thread via
 * `scheduleOnRN`. JS parses them with the `mrz` package + an N-frame
 * consensus aggregator before lighting up the confirmation card.
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

import { getMrzOcr, type MrzOcr, type RecognizedLines } from '@solidarity/nitro-mrz-ocr';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  PassportSketch,
  type PassportSketchState,
} from '@/components/scan/PassportSketch';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  countMrzCandidates,
  MrzFrameConsensus,
  parseMrzLines,
} from '@/passport/mrzOcr';
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
 * Target a 720p frame for OCR instead of the negotiated default (often
 * 1080p+). MRZ OCR-B characters at 720p are still ~30-50px tall — plenty
 * for both VisionKit `.accurate` and ML Kit's bundled Latin recognizer —
 * but the smaller buffer cuts iOS OCR latency by ~3-4×. Combined with
 * the no-throttle cadence above, time-to-accept on a steady hand-held
 * shot ends up faster than the Swift port (which ran 1080p with no ROI).
 */
/**
 * Camera output resolution fed to the OCR plugin. VGA_4_3 (480×640)
 * is ~5× fewer pixels than HD_16_9 (720×1280) and matches sensor-
 * native 4:3 so the camera path skips a 16:9 crop. Combined with the
 * Android-side bottom-band crop (`MRZ_BAND_FRAC = 0.55` in
 * HybridMrzOcr.kt) it brings per-frame ML Kit work from ~150ms to
 * ~40-60ms on a Snapdragon 865. MRZ at 480px-wide is ~10-11 px per
 * glyph which still clears ML Kit's text-height floor, but bumping
 * back to HD_4_3 (768×1024) is the obvious dial if accuracy regresses.
 */
const FRAME_OUTPUT_RESOLUTION = CommonResolutions.VGA_4_3;

/** Hold the current non-idle phase for this long after the last positive
 *  ingest so a one-frame OCR miss doesn't flicker the affordance back to
 *  white. ~1s feels stable in hand-held shots without lagging the user. */
const PHASE_HOLD_MS = 1000;

/** Consecutive parse-failed-with-MRZ-shape readings before we flip the
 *  sketch from green to amber and surface a recovery hint. With OCR
 *  running continuously, 3 parse fails ≈ 300-450ms on iOS, ~240ms on
 *  Android — still long enough that a single misread frame doesn't
 *  trigger the warning. */
const STRUGGLE_THRESHOLD = 3;

/**
 * Delay between a valid MRZ acceptance and auto-advancing to the next
 * onboarding step. Long enough for the user to read the brief flash of
 * the confirmation card + see the `confirmed` checkmark animation,
 * short enough that they don't reach to dismiss before nav fires.
 */
const AUTO_ADVANCE_DELAY_MS = 800;

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

  // Live scan phase, driven from `ingestLines`. Decouples user-facing
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

  // Frame counter lives on the worklet thread (SharedValue) so it never
  // trips a React re-render.
  const frameTick = useSharedValue<number>(0);

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
  // `useBarcodeScanner` in react-native-vision-camera-barcode-scanner).
  const mrzOcr = useMemo<MrzOcr>(() => getMrzOcr(), []);

  // Consensus state is JS-side and stable across re-renders — instantiate
  // once and hold via ref so `handleRescan` can reset() without touching
  // it from the worklet.
  const consensusRef = useRef<MrzFrameConsensus | null>(null);
  if (consensusRef.current === null) {
    consensusRef.current = new MrzFrameConsensus();
  }

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

  // JS-thread sink for parsed lines: parse → consensus → setDraft, and
  // update the live phase. Returning early on null preserves the idle
  // affordance (rule 8). Logs include call #, native OCR latency, frame
  // dimensions (so resolution-bias takedown is verifiable), and per-stage
  // outcome — COUNTS only, never MRZ content (no PII).
  const ingestLines = useCallback(
    (
      lines: readonly string[],
      ocrDurationMs: number,
      frameWidth: number,
      frameHeight: number,
    ) => {
      const consensus = consensusRef.current;
      if (consensus === null) return;

      ocrCallCountRef.current += 1;
      // Keep a rolling window of the last 10 OCR durations for the
      // "ACCEPT after" summary.
      const durations = ocrDurationsRef.current;
      durations.push(ocrDurationMs);
      if (durations.length > 10) durations.shift();

      const candidates = countMrzCandidates(lines);
      const parsed = parseMrzLines(lines);
      const accepted = consensus.ingest(parsed);

      // Per-frame log was always counts-only (no MRZ content), but
      // tightening anyway: the only signal we ever needed was
      // "did the parser ever succeed?" which the ACCEPT line already
      // covers. Dropping the chatty per-frame line keeps logcat clean
      // and removes any chance of someone tailing pre-release builds
      // and inferring scan progress from frame metadata. The
      // surrounding arrow function already accepts these args so
      // they're not unused at the language level — leaving them
      // referenced via void-cast keeps Sonar / no-unused-vars happy
      // without re-introducing the log.
      void frameWidth;
      void frameHeight;
      void ocrDurationMs;

      if (accepted !== null) {
        const totalMs = Date.now() - mountTimeRef.current;
        const avgMs =
          durations.reduce((s, v) => s + v, 0) / Math.max(1, durations.length);
        console.log(
          `[MRZ] ACCEPT after ${String(totalMs)}ms / ${String(ocrCallCountRef.current)} ocr calls (avg ${String(Math.round(avgMs))}ms/call)`,
        );
        failureStreakRef.current = 0;
        moveToPhase('confirmed');
        setDraft(accepted);
        // Auto-advance — the legacy flow required a "Use This" tap on
        // the confirmation card, but the consensus aggregator + every-
        // check-digit-valid gate already guarantee the draft is real.
        // Forcing a manual tap stranded users staring at a card they
        // had no reason to second-guess. Tiny delay lets the
        // `confirmed` phase render its checkmark animation first so
        // the transition isn't jarring.
        autoAdvanceTimerRef.current = setTimeout(() => {
          onScanned(accepted);
        }, AUTO_ADVANCE_DELAY_MS);
        return;
      }

      if (candidates >= 2 && parsed === null) {
        failureStreakRef.current += 1;
        moveToPhase(
          failureStreakRef.current >= STRUGGLE_THRESHOLD
            ? 'struggling'
            : 'detecting',
        );
        return;
      }

      if (candidates >= 1) {
        // Partial / in-flight read — don't count as a failure yet.
        failureStreakRef.current = 0;
        moveToPhase('detecting');
        return;
      }

      // No candidates this frame — leave the phase alone and let the
      // debounce timer drop us back to idle if the dry spell persists.
      failureStreakRef.current = 0;
    },
    [moveToPhase],
  );

  const logOcrError = useCallback((message: string) => {
    console.warn(`[MRZ] scanFrame threw: ${message}`);
  }, []);

  const onFrame = useMemo(() => {
    return (frame: Frame): void => {
      'worklet';
      try {
        const tick = frameTick.value + 1;
        frameTick.value = tick;
        if (tick % FRAME_THROTTLE !== 0) return;

        try {
          const startedAt = Date.now();
          const result: RecognizedLines = mrzOcr.scanFrame(frame);
          const durationMs = Date.now() - startedAt;
          // Copy into a plain array so the value is safe to ship across
          // the worklet → JS bridge.
          const lines: string[] = [];
          for (const line of result.lines) lines.push(line);
          scheduleOnRN(
            ingestLines,
            lines,
            durationMs,
            result.frameWidth,
            result.frameHeight,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          scheduleOnRN(logOcrError, message);
        }
      } finally {
        frame.dispose();
      }
    };
  }, [frameTick, ingestLines, logOcrError, mrzOcr]);

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    targetResolution: FRAME_OUTPUT_RESOLUTION,
    onFrame,
  });

  // Bias the negotiated session toward the frame output's target — this
  // is what actually pulls the camera down from its native 1080p/4K
  // default to the 720p we asked for. Without it `targetResolution` is
  // only a hint and the Camera can still pick higher.
  const cameraConstraints = useMemo(
    () => [{ resolutionBias: frameOutput }],
    [frameOutput],
  );

  const handleRescan = useCallback(() => {
    console.log('[MRZ] rescan — resetting consensus, counters, timer');
    consensusRef.current?.reset();
    frameTick.value = 0;
    if (phaseTimerRef.current !== null) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    failureStreakRef.current = 0;
    phaseRef.current = 'idle';
    setPhase('idle');
    setDraft(null);
    // Reset diagnostics so the next ACCEPT log measures from rescan.
    mountTimeRef.current = Date.now();
    ocrCallCountRef.current = 0;
    ocrDurationsRef.current = [];
  }, [frameTick]);

  const handleUseThis = useCallback(() => {
    if (draft) onScanned(draft);
  }, [draft, onScanned]);

  useEffect(() => {
    console.log(
      `[MRZ] mount — target=${String(FRAME_OUTPUT_RESOLUTION.width)}x${String(FRAME_OUTPUT_RESOLUTION.height)} throttle=${String(FRAME_THROTTLE)} struggle=${String(STRUGGLE_THRESHOLD)} hold=${String(PHASE_HOLD_MS)}ms`,
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
