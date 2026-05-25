/**
 * Vision-camera v5 QR scanner — mirrors Swift QRCodeManager.startScanning.
 *
 * v5 moved barcode detection out of core into
 * `react-native-vision-camera-barcode-scanner` (MLKit on both platforms).
 * We attach a `useBarcodeScannerOutput` to the Camera's `outputs={[…]}`
 * array; the JS callback fires only when a new code is decoded, so there
 * is no per-frame churn.
 *
 * Chunked frames (sqc1 prefix) are routed into the shared QR reassembler
 * automatically; the consumer's onResult fires once with the reassembled
 * payload.
 */
import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import { useBarcodeScannerOutput } from 'react-native-vision-camera-barcode-scanner';

import { ThemedSurface, ThemedText } from '@/components/themed';
import { useCameraPermission } from './useCameraPermission';
import {
  isChunkFrame,
  QrChunkError,
  QrChunkReassembler,
} from '@solidarity/shared';

export interface QrScannerProps {
  /** Fires once per decoded payload (single-frame or reassembled chunked). */
  readonly onResult: (payload: string) => void;
  /** Fires when a chunked burst progresses (received/total). */
  readonly onProgress?: (received: number, total: number) => void;
}

export function QrScanner({ onResult, onProgress }: QrScannerProps): ReactNode {
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const reassembler = useMemo(() => new QrChunkReassembler(), []);
  const lastValue = useRef<string | null>(null);

  const handleValue = useCallback(
    (value: string) => {
      if (value === lastValue.current) return; // de-dupe consecutive duplicates
      lastValue.current = value;

      if (!isChunkFrame(value)) {
        onResult(value);
        return;
      }
      try {
        const r = reassembler.ingest(value);
        switch (r.kind) {
          case 'complete':
            onResult(r.payload);
            lastValue.current = null;
            break;
          case 'incomplete':
            onProgress?.(r.progress.receivedCount, r.progress.totalCount);
            break;
          case 'staleReset':
            if (r.next.kind === 'complete') {
              onResult(r.next.payload);
              lastValue.current = null;
            } else if (r.next.kind === 'incomplete') {
              onProgress?.(r.next.progress.receivedCount, r.next.progress.totalCount);
            }
            break;
          case 'conflict':
          case 'corrupt':
          case 'unsupportedVersion':
            // Recoverable — reassembler already cleared its state where
            // appropriate; clear our scanner-level de-dupe so the next frame
            // (even an identical one) is re-evaluated.
            lastValue.current = null;
            break;
        }
      } catch (err) {
        if (err instanceof QrChunkError) reassembler.reset();
      }
    },
    [onProgress, onResult, reassembler]
  );

  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats: ['qr-code'],
    onBarcodeScanned: (codes) => {
      for (const c of codes) {
        if (c.rawValue) handleValue(c.rawValue);
      }
    },
    onError: () => {
      // Reassembler state isn't tied to scan errors — keep silent so a
      // transient MLKit hiccup doesn't blank a partial chunked burst.
    },
  });

  if (permission === 'pending') {
    return (
      <View style={styles.fill} className="items-center justify-center bg-pageBg">
        <ThemedText tone="secondary">Requesting camera…</ThemedText>
      </View>
    );
  }
  if (permission === 'denied') {
    return (
      <View style={styles.fill} className="items-center justify-center bg-pageBg p-6">
        <ThemedSurface variant="outlined" padded>
          <ThemedText variant="titleMedium">Camera permission required</ThemedText>
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-2">
            Enable Camera in Settings to scan QR codes.
          </ThemedText>
        </ThemedSurface>
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.fill} className="items-center justify-center bg-pageBg">
        <ThemedText tone="secondary">No camera available</ThemedText>
      </View>
    );
  }

  return (
    <Camera
      style={styles.fill}
      device={device}
      isActive
      outputs={[barcodeOutput]}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
