/**
 * QR scanner — mirrors Swift QRCodeManager.startScanning.
 *
 * Chunked frames (sqc1 prefix) are routed into the shared QR reassembler
 * automatically; the consumer's onResult fires once with the reassembled
 * payload.
 */
import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, type BarcodeScanningResult } from 'expo-camera';

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
  const reassembler = useMemo(() => new QrChunkReassembler(), []);
  const lastValue = useRef<string | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);

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

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (result.data) handleValue(result.data);
    },
    [handleValue]
  );

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
  if (mountError) {
    return (
      <View style={styles.fill} className="items-center justify-center bg-pageBg">
        <ThemedText tone="secondary">{mountError}</ThemedText>
      </View>
    );
  }

  return (
    <CameraView
      style={styles.fill}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={handleBarcodeScanned}
      onMountError={({ message }) => {
        setMountError(message || 'No camera available');
      }}
    />
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
