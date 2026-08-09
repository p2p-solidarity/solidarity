/**
 * Camera permission helper for the QR scanner. Centralised so the
 * "request → check → guard" dance lives in one place; callers just
 * read `granted`.
 *
 * Vision Camera v5 exposes permission state through a hook. We keep the
 * consumer-facing `'pending' | 'granted' | 'denied'` contract and translate
 * at the edge so callers don't have to learn the camera library shape.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  useCameraPermission as useVisionCameraPermission,
} from 'react-native-vision-camera';

export type CameraPermissionState = 'prompt' | 'pending' | 'granted' | 'denied';

export interface CameraPermissionControl {
  readonly state: CameraPermissionState;
  readonly request: () => Promise<void>;
}

/**
 * Persists ACROSS scanner mounts (module scope, not `useState`): once we have
 * auto-requested the OS permission exactly once and it did not result in a
 * grant, we must NOT auto-request again on every subsequent scanner mount
 * (R26 — the permission loop). The OS won't re-prompt after a denial anyway;
 * recovery is via the denied state's "Open Settings" CTA, not another
 * silent request. A later grant flips `hasPermission` true and we short-
 * circuit to 'granted' regardless of this flag.
 */
let hasAutoRequested = false;

export function useCameraPermissionControl(
  autoRequest = false,
): CameraPermissionControl {
  const [state, setState] = useState<CameraPermissionState>('pending');
  const { hasPermission, requestPermission } = useVisionCameraPermission();

  const request = useCallback(async (): Promise<void> => {
    setState('pending');
    hasAutoRequested = true;
    const granted = await requestPermission().catch(() => false);
    setState(granted ? 'granted' : 'denied');
  }, [requestPermission]);

  useEffect(() => {
    if (hasPermission) {
      hasAutoRequested = true;
      setState('granted');
      return;
    }
    if (hasAutoRequested) {
      setState('denied');
      return;
    }
    if (autoRequest) {
      void request();
      return;
    }
    setState('prompt');
  }, [autoRequest, hasPermission, request]);

  return { state, request };
}

export function useCameraPermission(): CameraPermissionState {
  return useCameraPermissionControl(true).state;
}
