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
  useCameraDevice,
  useFrameOutput,
  type Frame,
} from 'react-native-vision-camera';
import { scheduleOnRN } from 'react-native-worklets';

import { getMrzOcr, type MrzOcr, type RecognizedLines } from '@solidarity/nitro-mrz-ocr';

import { SfIcon } from '@/components/icons/SfIcon';
import { PassportSketch } from '@/components/scan/PassportSketch';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import {
  hasMrzCandidate,
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

/** Run OCR every Nth frame so the worklet doesn't choke the pipeline. */
const FRAME_THROTTLE = 4;

/** Hold the "detecting" sketch frame for this long after the last hit so a
 *  one-frame OCR miss doesn't flicker the user's affordance back to white. */
const DETECTING_HOLD_MS = 800;

export function MRZCameraStep({
  onScanned,
  onCancel,
  onSwitchToManual,
}: MRZCameraStepProps): ReactNode {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const [draft, setDraft] = useState<PassportMRZDraft | null>(null);

  // `detecting` flips on as soon as OCR sees an MRZ-shaped line; flips off
  // DETECTING_HOLD_MS after the last hit. Decoupling this from the
  // 3-frame check-digit consensus gives the user real-time "I see your
  // passport" feedback instead of staring at a static white frame.
  const [detecting, setDetecting] = useState(false);
  const detectingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Frame counter lives on the worklet thread (SharedValue) so the
  // throttle doesn't trip a React re-render every frame.
  const frameTick = useSharedValue<number>(0);

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

  // JS-thread sink for parsed lines: parse → consensus → setDraft. Also
  // updates the live "detecting" affordance the moment any MRZ-shaped row
  // appears, well before check-digit consensus.
  // Returning early on null preserves "Looking for MRZ..." (rule 8).
  // Debug logs print COUNTS only — never the recognised text content.
  const ingestLines = useCallback((lines: readonly string[]) => {
    const consensus = consensusRef.current;
    if (consensus === null) return;

    if (hasMrzCandidate(lines)) {
      setDetecting(true);
      if (detectingTimerRef.current !== null) {
        clearTimeout(detectingTimerRef.current);
      }
      detectingTimerRef.current = setTimeout(() => {
        setDetecting(false);
        detectingTimerRef.current = null;
      }, DETECTING_HOLD_MS);
    }

    const parsed = parseMrzLines(lines);
    const accepted = consensus.ingest(parsed);
    if (lines.length > 0) {
      console.log(
        `[MRZ] lines=${String(lines.length)} parsed=${String(parsed !== null)} accepted=${String(accepted !== null)}`,
      );
    }
    if (accepted !== null) setDraft(accepted);
  }, []);

  // Worklet → JS bridge for OCR diagnostics. Logs the rolling call count
  // and the recognised line count every ~10 OCR calls so a quiet pipeline
  // is visible in Metro without spamming.
  const logOcrTick = useCallback((callCount: number, lineCount: number) => {
    console.log(`[MRZ] ocr call #${String(callCount)} lines=${String(lineCount)}`);
  }, []);
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
          const result: RecognizedLines = mrzOcr.scanFrame(frame);
          // Copy into a plain array so the value is safe to ship across
          // the worklet → JS bridge.
          const lines: string[] = [];
          for (const line of result.lines) lines.push(line);
          scheduleOnRN(ingestLines, lines);
          const ocrCallCount = tick / FRAME_THROTTLE;
          if (ocrCallCount % 10 === 0) {
            scheduleOnRN(logOcrTick, ocrCallCount, lines.length);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          scheduleOnRN(logOcrError, message);
        }
      } finally {
        frame.dispose();
      }
    };
  }, [frameTick, ingestLines, logOcrError, logOcrTick, mrzOcr]);

  const frameOutput = useFrameOutput({
    pixelFormat: 'yuv',
    onFrame,
  });

  const handleRescan = useCallback(() => {
    consensusRef.current?.reset();
    frameTick.value = 0;
    if (detectingTimerRef.current !== null) {
      clearTimeout(detectingTimerRef.current);
      detectingTimerRef.current = null;
    }
    setDetecting(false);
    setDraft(null);
  }, [frameTick]);

  const handleUseThis = useCallback(() => {
    if (draft) onScanned(draft);
  }, [draft, onScanned]);

  useEffect(() => {
    return () => {
      if (detectingTimerRef.current !== null) {
        clearTimeout(detectingTimerRef.current);
        detectingTimerRef.current = null;
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
      />

      <NavBar onCancel={onCancel} onSwitchToManual={onSwitchToManual} />

      <View style={styles.overlayContainer}>
        <PassportSketch active={detecting || draft !== null} />
        {!draft ? (
          <Text style={styles.alignLabel}>
            {detecting ? 'Hold steady…' : 'Align passport MRZ here'}
          </Text>
        ) : null}
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
        Live MRZ recognition lands when the native plugin ships.
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
  alignLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
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
