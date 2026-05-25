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
 * MRZ recognition: production MRZ detection requires a native
 * frame-processor plugin (ML Kit Text Recognition on Android, VisionKit on
 * iOS) + the `mrz` parser. Until that lands as a Nitro module the camera
 * shows the live preview + sketch + an explicit "Enter Manually" CTA —
 * honest about the missing capability per CLAUDE.md rule 8. Both platforms
 * paint the same screen so the day the plugin lands it's a one-prop change
 * to start receiving drafts.
 */
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  useCameraDevice,
} from 'react-native-vision-camera';

import { SfIcon } from '@/components/icons/SfIcon';
import { PassportSketch } from '@/components/scan/PassportSketch';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
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

export function MRZCameraStep({
  onScanned,
  onCancel,
  onSwitchToManual,
}: MRZCameraStepProps): ReactNode {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const [draft, setDraft] = useState<PassportMRZDraft | null>(null);

  const handleRescan = useCallback(() => {
    setDraft(null);
  }, []);

  const handleUseThis = useCallback(() => {
    if (draft) onScanned(draft);
  }, [draft, onScanned]);

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
      />

      <NavBar onCancel={onCancel} onSwitchToManual={onSwitchToManual} />

      <View style={styles.overlayContainer}>
        <PassportSketch active={draft !== null} />
        {!draft ? <Text style={styles.alignLabel}>Align passport MRZ here</Text> : null}
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
