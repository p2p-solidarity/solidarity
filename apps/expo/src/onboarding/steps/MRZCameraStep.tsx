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
  useAsyncRunner,
  useCameraDevice,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';

import { getMrzOcr, type MrzOcr, type MrzScanResult } from '@solidarity/nitro-mrz-ocr';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  PassportSketch,
  type PassportSketchState,
} from '@/components/scan/PassportSketch';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
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
  /** Defaults to product-safe copy for onboarding and other existing callers. */
  readonly developerMode?: boolean;
}

/**
 * No JS-side frame gate (`1` = consider every frame).
 *
 * The original SwiftUI `MRZScannerService` runs OCR back-to-back via an
 * `_isProcessingFrame` lock + `alwaysDiscardsLateVideoFrames = true` — as
 * soon as one Vision call returns, the next available frame is OCR'd.
 *
 * We get the same "one in flight, drop the rest" cadence from VisionCamera's
 * `useAsyncRunner` (see `onFrame`): the heavy `.accurate` OCR runs on a
 * dedicated worklet runtime and `runAsync` rejects new frames while one is in
 * flight, so the capture thread is NEVER blocked and the bounded buffer pool
 * never backs up. (Running OCR synchronously on the frame-output worklet —
 * the previous design — blocked that thread for ~100-300ms at 1080p and
 * accumulated pixel-buffer + Vision scratch memory until iOS jetsammed the
 * app mid-scan.) A JS-side `tick % N` gate on top of that backpressure buys
 * nothing, so this stays `1`. Keep the constant as a future thermal knob.
 */
const FRAME_THROTTLE = 1;

/**
 * Match the native Swift scanner's capture resolution EXACTLY.
 *
 * On iOS both paths run the identical recognizer (Apple Vision
 * `VNRecognizeTextRequest(.accurate)`), so the recognizer was never the
 * reason this was "far slower than native / scanned many times" — pixel
 * starvation was. `MRZScannerService.swift` captures at
 * `AVCaptureSession.Preset.hd1920x1080` (1920×1080) and reads the full
 * frame; this step was feeding Vision `HD_4_3` = **768×1024** (the library
 * literally labels it a "low-resolution 4:3 target"). That gives ~16 px per
 * OCR-B glyph vs native's ~30. Below ~20 px/char Vision routinely confuses
 * 0/O · 1/I · 5/S · 8/B, an ICAO 9303 check digit fails, `parseTD3` returns
 * nil, and the user re-tries frame after frame instead of locking on the
 * first one.
 *
 * `FHD_16_9` resolves to a 1920×1080 buffer — byte-for-byte the same as
 * native — so the first or second frame validates and the flow advances in
 * <1s.
 *
 * DO NOT lower this for "per-frame speed" (git history shows VGA_4_3 / 720p
 * / HD_4_3 regressions that all chased the wrong metric): time-to-FIRST-
 * VALID-DRAFT is what the user feels, and low res destroys it even though it
 * makes each individual OCR call faster. If first-hit ever needs more
 * vertical framing slack, step UP to `FHD_4_3` (1440×1920), never down.
 */
const FRAME_OUTPUT_RESOLUTION = CommonResolutions.FHD_16_9;

/** Hold the current non-idle phase for this long after the last positive
 *  ingest so a one-frame OCR miss doesn't flicker the affordance back to
 *  white. Keep this short: phase is decorative, not part of validation. */
const PHASE_HOLD_MS = 250;

/** How long both MRZ rows can stay visible WITHOUT a check-digit-valid parse
 *  before we flip the sketch amber and surface a recovery hint. Time-based
 *  (not frame-count) because the worklet now only wakes JS on a coarse-bucket
 *  CHANGE, so there is no per-frame streak to count. Decorative only — never
 *  part of validation. */
const STRUGGLE_MS = 1500;

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

/** Product-facing translation keys for the normal scan flow. */
const PHASE_COPY: Record<ScanPhase, PhaseCopy> = {
  idle: {
    primary: 'passportSetup.camera.align',
    secondary: 'passportSetup.camera.photoPage',
  },
  detecting: {
    primary: 'passportSetup.camera.reading',
  },
  struggling: {
    primary: 'passportSetup.camera.unclear',
    secondary: 'passportSetup.camera.recovery',
  },
  confirmed: {
    primary: 'passportSetup.camera.confirmed',
  },
};

/** Raw scanner diagnostics remain available only under the global Developer Mode. */
const DEVELOPER_PHASE_COPY: Record<ScanPhase, PhaseCopy> = {
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
  developerMode = false,
}: MRZCameraStepProps): ReactNode {
  const { t } = useTranslation();
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
  /** Decay-to-idle timer, armed when the MRZ leaves view (bucket 0). */
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Fires the amber "MRZ unclear" hint when both rows stay visible without
   *  a valid parse for STRUGGLE_MS. Edge-armed in `reportBucket`. */
  const struggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * One-shot timer for auto-advance after MRZ acceptance. Held in a ref
   * so the unmount cleanup can clear it (avoiding a navigate-back race
   * where the user taps Cancel between phase-confirmed and the timer
   * firing) and so `handleRescan` can defuse a pending advance.
   */
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAcceptedRef = useRef(false);

  // All high-frequency scan state lives on the worklet thread as
  // SharedValues, so a steady scan triggers ZERO React re-renders and zero
  // per-frame JS-thread hops (CLAUDE.md rule 9). JS is woken only when the
  // coarse candidate bucket changes, or once on accept.
  const frameTick = useSharedValue<number>(0);
  const scanAccepted = useSharedValue<boolean>(false);
  /** Last coarse candidate bucket reported to JS: 0 none · 1 one row · 2 both
   *  rows. `-1` forces the first frame to report. */
  const lastBucket = useSharedValue<number>(-1);
  /** OCR diagnostics, accumulated worklet-side and read once on accept for
   *  the "ACCEPT after …" summary — no per-frame hop needed. */
  const ocrCount = useSharedValue<number>(0);
  const ocrDurationSum = useSharedValue<number>(0);

  // Async-runner → JS hand-off channel. The OCR worklet runs on VisionCamera's
  // async-runner runtime, which has NONE of react-native-worklets' JS-scheduling
  // globals — so `scheduleOnRN` AND `console.log` are unavailable there and
  // THROW (that throw, re-thrown from the worklet's own catch, was the 閃退).
  // SharedValues are the one channel that crosses that runtime boundary, so the
  // worklet publishes here and the JS poll below drains it. A monotonic seq
  // counter signals "new value"; the payload rides alongside.
  const acceptedDraft = useSharedValue<PassportMRZDraft | null>(null);
  const acceptSeq = useSharedValue<number>(0);
  const errorMsg = useSharedValue<string | null>(null);
  const errorSeq = useSharedValue<number>(0);

  // Wall-clock anchor for the accept log line (time since mount / rescan).
  const mountTimeRef = useRef<number>(Date.now());

  // Resolve the Nitro HybridObject once on the JS thread. Worklets can't
  // call non-worklet JS functions like `getMrzOcr()` synchronously, but
  // once we have the HybridObject in hand it IS worklet-safe (the methods
  // are Nitro proxies backed by native code — same pattern as
  // VisionCamera frame outputs).
  const mrzOcr = useMemo<MrzOcr>(() => getMrzOcr(), []);

  // Dedicated worklet runtime for the heavy Vision OCR. `runAsync` keeps a
  // single task in flight and rejects frames while busy, so the camera's
  // frame-output thread is never blocked and its bounded buffer pool never
  // backs up (the previous synchronous design starved both → mid-scan jetsam
  // crash on device).
  const asyncRunner = useAsyncRunner();

  /** Set the React-visible phase, guarding against a redundant setState so a
   *  repeated signal never re-renders. */
  const setPhaseTo = useCallback((next: ScanPhase) => {
    if (phaseRef.current === next) return;
    console.log(`[MRZ] phase: ${phaseRef.current} → ${next}`);
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearPhaseTimers = useCallback(() => {
    if (phaseTimerRef.current !== null) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (struggleTimerRef.current !== null) {
      clearTimeout(struggleTimerRef.current);
      struggleTimerRef.current = null;
    }
  }, []);

  // Critical path: native already ran full ICAO 9303 check-digit validation
  // before populating `draft`, so the worklet flips `scanAccepted` and hops
  // here exactly once. Log the timing summary, show the confirmed state, and
  // auto-advance. Kept deliberately close to the previous accept branch.
  const acceptDraft = useCallback(
    (accepted: PassportMRZDraft, calls: number, avgMs: number) => {
      if (hasAcceptedRef.current) return;
      hasAcceptedRef.current = true;
      const totalMs = Date.now() - mountTimeRef.current;
      console.log(
        `[MRZ] ACCEPT after ${String(totalMs)}ms / ${String(calls)} ocr calls (avg ${String(avgMs)}ms/call)`,
      );
      clearPhaseTimers();
      setPhaseTo('confirmed');
      setDraft(accepted);
      // Tiny delay lets the `confirmed` phase render once before the modal
      // closes and the pipeline moves to NFC.
      autoAdvanceTimerRef.current = setTimeout(() => {
        onScanned(accepted);
      }, AUTO_ADVANCE_DELAY_MS);
    },
    [clearPhaseTimers, setPhaseTo, onScanned],
  );

  // Cosmetic affordance sink. Called only when the worklet sees the coarse
  // candidate bucket CHANGE (not every frame), so it runs a handful of times
  // per session. Drives the 4-phase sketch/text; it never gates acceptance —
  // that is `draft != null`, handled in `acceptDraft`.
  const reportBucket = useCallback(
    (bucket: number) => {
      clearPhaseTimers();
      if (bucket >= 1) {
        setPhaseTo('detecting');
        if (bucket >= 2) {
          // Both rows on screen but no valid parse yet — if it stays that
          // way, nudge the user (lighting / distance / steadiness).
          struggleTimerRef.current = setTimeout(() => {
            setPhaseTo('struggling');
            struggleTimerRef.current = null;
          }, STRUGGLE_MS);
        }
        return;
      }
      // bucket 0 — no MRZ-shaped rows. Hold the current affordance briefly so
      // a one-frame drop doesn't flicker, then decay to idle.
      phaseTimerRef.current = setTimeout(() => {
        setPhaseTo('idle');
        phaseTimerRef.current = null;
      }, PHASE_HOLD_MS);
    },
    [clearPhaseTimers, setPhaseTo],
  );

  const logOcrError = useCallback((message: string) => {
    console.warn(`[MRZ] scanFrame threw: ${message}`);
  }, []);

  const onFrame = useMemo(() => {
    return (frame: Frame): void => {
      'worklet';
      // Cheap synchronous gates stay on the capture thread and dispose at once.
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

      // Offload the heavy Vision `.accurate` OCR to the async runtime. While
      // one OCR is in flight `runAsync` returns false for every new frame, so
      // the capture thread keeps flowing and only ONE frame's worth of pixel
      // buffer + Vision scratch memory is ever alive — the backpressure that
      // keeps this off iOS's jetsam radar. We own the frame until the task
      // finishes, so it is disposed INSIDE the callback; the outer worklet only
      // disposes the frames the runner rejects.
      const queued = asyncRunner.runAsync(() => {
        'worklet';
        // Runs on VisionCamera's async-runner runtime. NOTHING may escape this
        // worklet: an uncaught throw out of `runAsync` unwinds past Nitro's
        // dispatch block and `std::terminate`s the whole app (this was the
        // 閃退). `scheduleOnRN` / `console.log` are unavailable on this runtime
        // and throw, so we hand everything to JS via SharedValues and the catch/
        // finally only write SharedValues or swallow — they can never throw.
        try {
          const startedAt = Date.now();
          const result: MrzScanResult = mrzOcr.scanFrame(frame);
          ocrCount.value += 1;
          ocrDurationSum.value += Date.now() - startedAt;

          if (result.draft != null) {
            // Validated in native — accept exactly once. Publish the draft, then
            // gate further frames on the worklet thread so no late frame
            // double-fires. The JS poll reads `acceptedDraft` when `acceptSeq`
            // advances.
            acceptedDraft.value = {
              passportNumber: result.draft.passportNumber,
              nationalityCode: result.draft.nationalityCode,
              dateOfBirth: result.draft.dateOfBirth,
              expiryDate: result.draft.expiryDate,
            };
            scanAccepted.value = true;
            acceptSeq.value = acceptSeq.value + 1;
            return;
          }

          // No draft — publish the coarse candidate bucket. The JS poll only
          // reacts when it CHANGES, so steady scanning does zero React work.
          const bucket =
            result.candidateCount >= 2 ? 2 : result.candidateCount >= 1 ? 1 : 0;
          if (bucket !== lastBucket.value) {
            lastBucket.value = bucket;
          }
        } catch (e) {
          // Must not throw. Stash a best-effort message (extraction itself is
          // guarded) for the JS poll to surface via `logOcrError`.
          let message = 'scanFrame worklet error';
          try {
            message = e instanceof Error ? e.message : String(e);
          } catch {}
          errorMsg.value = message;
          errorSeq.value = errorSeq.value + 1;
        } finally {
          // `dispose` is a native call; guard it so a late / double dispose can
          // never escape the worklet either.
          try {
            frame.dispose();
          } catch {}
        }
      });

      // Runner busy → drop this frame immediately so the pipeline never stalls.
      if (!queued) frame.dispose();
    };
  }, [
    asyncRunner,
    frameTick,
    scanAccepted,
    lastBucket,
    ocrCount,
    ocrDurationSum,
    mrzOcr,
    acceptedDraft,
    acceptSeq,
    errorMsg,
    errorSeq,
  ]);

  // Drain the async-runner SharedValue channel on the JS thread. The OCR
  // worklet can't call back into JS directly (see onFrame), so it publishes to
  // SharedValues; reading `.value` here on the JS thread sees those cross-
  // runtime writes. We dispatch only when a seq counter advances, so a steady
  // scan does no React work. 100 ms is imperceptible for phase / accept and far
  // safer than the per-frame JS hop that was terminating the app.
  useEffect(() => {
    let seenAccept = 0;
    let seenError = 0;
    let seenBucket = -1;
    const id = setInterval(() => {
      const accept = acceptSeq.value;
      if (accept !== seenAccept) {
        seenAccept = accept;
        const captured = acceptedDraft.value;
        if (captured != null) {
          const calls = ocrCount.value;
          const avgMs = Math.round(ocrDurationSum.value / Math.max(1, calls));
          acceptDraft(captured, calls, avgMs);
        }
      }
      const bucket = lastBucket.value;
      if (bucket !== seenBucket) {
        seenBucket = bucket;
        if (bucket >= 0) reportBucket(bucket);
      }
      const error = errorSeq.value;
      if (error !== seenError) {
        seenError = error;
        logOcrError(errorMsg.value ?? 'unknown worklet error');
      }
    }, 100);
    return () => clearInterval(id);
  }, [
    acceptSeq,
    acceptedDraft,
    ocrCount,
    ocrDurationSum,
    acceptDraft,
    lastBucket,
    reportBucket,
    errorSeq,
    errorMsg,
    logOcrError,
  ]);

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
    lastBucket.value = -1;
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    clearPhaseTimers();
    hasAcceptedRef.current = false;
    phaseRef.current = 'idle';
    setPhase('idle');
    setDraft(null);
    // Reset diagnostics so the next ACCEPT log measures from rescan.
    mountTimeRef.current = Date.now();
    ocrCount.value = 0;
    ocrDurationSum.value = 0;
  }, [
    frameTick,
    scanAccepted,
    lastBucket,
    ocrCount,
    ocrDurationSum,
    clearPhaseTimers,
  ]);

  const handleUseThis = useCallback(() => {
    if (autoAdvanceTimerRef.current !== null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (draft) onScanned(draft);
  }, [draft, onScanned]);

  useEffect(() => {
    console.log(
      `[MRZ] mount — target=${String(FRAME_OUTPUT_RESOLUTION.width)}x${String(FRAME_OUTPUT_RESOLUTION.height)} fps=30 throttle=${String(FRAME_THROTTLE)} struggleMs=${String(STRUGGLE_MS)} hold=${String(PHASE_HOLD_MS)}ms advance=${String(AUTO_ADVANCE_DELAY_MS)}ms nativeDraft=true`,
    );
    mountTimeRef.current = Date.now();
    return () => {
      console.log(
        `[MRZ] unmount after ${String(Date.now() - mountTimeRef.current)}ms / ${String(ocrCount.value)} ocr calls`,
      );
      if (phaseTimerRef.current !== null) {
        clearTimeout(phaseTimerRef.current);
        phaseTimerRef.current = null;
      }
      if (struggleTimerRef.current !== null) {
        clearTimeout(struggleTimerRef.current);
        struggleTimerRef.current = null;
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
          {developerMode
            ? permission === 'pending'
              ? 'Requesting camera…'
              : 'Camera permission required.'
            : permission === 'pending'
              ? t('passportSetup.camera.permissionRequesting')
              : t('passportSetup.camera.permissionRequired')}
        </Text>
        <View style={{ marginTop: 16 }}>
          <ThemedButton
            label={developerMode ? 'Enter Manually' : t('passportSetup.camera.enterManual')}
            variant="inverted"
            onPress={onSwitchToManual}
          />
        </View>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionScreen}>
        <Text style={styles.permissionText}>
          {developerMode ? 'No camera available.' : t('passportSetup.camera.noCamera')}
        </Text>
        <View style={{ marginTop: 16 }}>
          <ThemedButton
            label={developerMode ? 'Enter Manually' : t('passportSetup.camera.enterManual')}
            variant="inverted"
            onPress={onSwitchToManual}
          />
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

      <NavBar
        developerMode={developerMode}
        onCancel={onCancel}
        onSwitchToManual={onSwitchToManual}
      />

      <View style={styles.overlayContainer}>
        <PassportSketch state={PHASE_TO_SKETCH_STATE[phase]} />
        {draft === null ? <ScanStatus phase={phase} developerMode={developerMode} /> : null}
      </View>

      <View style={styles.footer}>
        {draft ? (
          <ConfirmationCard
            developerMode={developerMode}
            draft={draft}
            onRescan={handleRescan}
            onUseThis={handleUseThis}
          />
        ) : (
          <InstructionFooter
            developerMode={developerMode}
            onSwitchToManual={onSwitchToManual}
          />
        )}
      </View>
    </View>
  );
}

function ScanStatus({
  phase,
  developerMode,
}: {
  phase: ScanPhase;
  developerMode: boolean;
}) {
  const { t } = useTranslation();
  const configuredCopy = developerMode ? DEVELOPER_PHASE_COPY[phase] : PHASE_COPY[phase];
  const copy = developerMode
    ? configuredCopy
    : {
        primary: t(configuredCopy.primary),
        ...(configuredCopy.secondary
          ? { secondary: t(configuredCopy.secondary) }
          : {}),
      };
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
  developerMode,
  onCancel,
  onSwitchToManual,
}: {
  developerMode: boolean;
  onCancel: () => void;
  onSwitchToManual: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.navBar}>
      <Pressable onPress={onCancel} accessibilityRole="button" style={styles.navBarButton}>
        <Text style={styles.navBarText}>
          {developerMode ? 'Cancel' : t('passportSetup.camera.cancel')}
        </Text>
      </Pressable>
      <Text style={styles.navBarTitle}>
        {developerMode ? 'Scan Passport' : t('passportSetup.camera.title')}
      </Text>
      <Pressable
        onPress={onSwitchToManual}
        accessibilityRole="button"
        accessibilityLabel={
          developerMode
            ? 'Enter passport MRZ manually'
            : t('passportSetup.camera.manualA11y')
        }
        style={[styles.navBarButton, { alignItems: 'flex-end' }]}
      >
        <Text style={styles.navBarText}>
          {developerMode ? 'Manual' : t('passportSetup.camera.manual')}
        </Text>
      </Pressable>
    </View>
  );
}

function InstructionFooter({
  developerMode,
  onSwitchToManual,
}: {
  developerMode: boolean;
  onSwitchToManual: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: 12, alignItems: 'center' }}>
      <Text style={styles.instructionLabel}>
        {developerMode
          ? "Or type the MRZ from the passport's photo page."
          : t('passportSetup.camera.footer')}
      </Text>
      <ThemedButton
        label={developerMode ? 'Enter Manually' : t('passportSetup.camera.enterManual')}
        variant="inverted"
        onPress={onSwitchToManual}
      />
    </View>
  );
}

function ConfirmationCard({
  developerMode,
  draft,
  onRescan,
  onUseThis,
}: {
  developerMode: boolean;
  draft: PassportMRZDraft;
  onRescan: () => void;
  onUseThis: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.confirmationCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SfIcon name="checkmark.seal.fill" size={18} color={Colors.terminalGreen} />
        <Text style={styles.confirmationTitle}>
          {developerMode ? 'MRZ Detected' : t('passportSetup.camera.confirmed')}
        </Text>
      </View>

      <View style={{ gap: 6 }}>
        <InfoRow
          label={developerMode ? 'Passport' : t('passportSetup.details.passportNumber')}
          value={draft.passportNumber}
        />
        <InfoRow
          label={developerMode ? 'Nationality' : t('passportSetup.camera.nationality')}
          value={draft.nationalityCode}
        />
        <InfoRow
          label={developerMode ? 'Date of Birth' : t('passportSetup.camera.birthDate')}
          value={formatYyMmDd(draft.dateOfBirth)}
        />
        <InfoRow
          label={developerMode ? 'Expiry' : t('passportSetup.camera.expiry')}
          value={formatYyMmDd(draft.expiryDate)}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 12, paddingTop: 4 }}>
        <View style={{ flex: 1 }}>
          <ThemedButton
            label={developerMode ? 'Rescan' : t('passportSetup.camera.rescan')}
            variant="secondary"
            fullWidth
            onPress={onRescan}
          />
        </View>
        <View style={{ flex: 1 }}>
          <ThemedButton
            label={developerMode ? 'Use This' : t('passportSetup.camera.useThis')}
            variant="primary"
            fullWidth
            onPress={onUseThis}
          />
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
