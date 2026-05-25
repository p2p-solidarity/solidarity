/**
 * Camera permission helper for the QR scanner. Centralised so the
 * "request → check → guard" dance lives in one place; callers just
 * read `granted`.
 *
 * Vision Camera v5 exposes permission state through a hook. We keep the
 * consumer-facing `'pending' | 'granted' | 'denied'` contract and translate
 * at the edge so callers don't have to learn the camera library shape.
 */
import { useEffect, useState } from 'react';
import {
  useCameraPermission as useVisionCameraPermission,
} from 'react-native-vision-camera';

export type CameraPermissionState = 'pending' | 'granted' | 'denied';

export function useCameraPermission(): CameraPermissionState {
  const [state, setState] = useState<CameraPermissionState>('pending');
  const { hasPermission, requestPermission } = useVisionCameraPermission();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (hasPermission) {
        if (!cancelled) setState('granted');
        return;
      }
      const granted = await requestPermission().catch(() => false);
      if (cancelled) return;
      setState(granted ? 'granted' : 'denied');
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPermission, requestPermission]);

  return state;
}
