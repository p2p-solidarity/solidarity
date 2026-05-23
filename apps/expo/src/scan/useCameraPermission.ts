/**
 * Camera permission helper for the QR scanner. Centralised so the
 * "request → check → guard" dance lives in one place; callers just
 * read `granted`.
 */
import { useEffect, useState } from 'react';
import { Camera } from 'react-native-vision-camera';

export type CameraPermissionState = 'pending' | 'granted' | 'denied';

export function useCameraPermission(): CameraPermissionState {
  const [state, setState] = useState<CameraPermissionState>('pending');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = Camera.getCameraPermissionStatus();
      if (current === 'granted') {
        if (!cancelled) setState('granted');
        return;
      }
      const next = await Camera.requestCameraPermission();
      if (cancelled) return;
      setState(next === 'granted' ? 'granted' : 'denied');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
